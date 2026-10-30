import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";
import type { ApiRoutes } from "./api-stack";
import type { AppConfig } from "./config";
import {
  addFunctionAlarms,
  ServiceFunction,
  ServiceTable
} from "./service-construct";

export interface ListingStackProps extends StackProps {
  config: AppConfig;
  routes: ApiRoutes;
  bus: events.IEventBus;
  alarmTopic: sns.ITopic;
}

/** Listing service: global pool, per-search visibility (match + share/hide),
 *  pipeline, benchmark/top-5, link inbox. */
export class ListingStack extends Stack {
  constructor(scope: Construct, id: string, props: ListingStackProps) {
    super(scope, id, props);
    const { config, routes, bus } = props;

    const table = new ServiceTable(this, "ListingTable", {
      config,
      tableName: "listing",
      gsi1: true, // sparse upcoming-viewings index
      timeToLiveAttribute: "expiresAt" // link-import jobs only
    }).table;

    const common = {
      LISTING_TABLE: table.tableName,
      EVENT_BUS_NAME: bus.eventBusName
    };

    const adminFn = new ServiceFunction(this, "AdminFn", {
      config,
      serviceName: "listing-admin",
      entry: "services/listings/src/handlers/admin.ts",
      description: "Listing service: admin routes",
      environment: common
    }).fn;
    table.grantReadWriteData(adminFn);
    bus.grantPutEventsTo(adminFn);
    addFunctionAlarms(this, "Admin", adminFn, props.alarmTopic);

    const customerFn = new ServiceFunction(this, "CustomerFn", {
      config,
      serviceName: "listing-customer",
      entry: "services/listings/src/handlers/customer.ts",
      description: "Listing service: customer routes",
      environment: common
    }).fn;
    table.grantReadData(customerFn);
    addFunctionAlarms(this, "Customer", customerFn, props.alarmTopic);

    // Keeps per-search matching criteria current from search-service events.
    const eventsFn = new ServiceFunction(this, "EventsFn", {
      config,
      serviceName: "listing-events",
      entry: "services/listings/src/handlers/events.ts",
      description: "Listing service: search criteria consumer",
      environment: common,
      timeout: Duration.seconds(30)
    }).fn;
    table.grantReadWriteData(eventsFn);
    addFunctionAlarms(this, "Events", eventsFn, props.alarmTopic);
    new events.Rule(this, "SearchEvents", {
      eventBus: bus,
      eventPattern: {
        source: ["jj.search"],
        detailType: ["search.created", "search.updated", "search.archived"]
      },
      targets: [new targets.LambdaFunction(eventsFn, { retryAttempts: 2 })]
    });

    // Link import: fetch a portal page, extract fields (markup + AI), create a
    // draft. A link import takes longer than API Gateway's 30 s window once a
    // proxy and the AI are involved, so it runs as a job: the API Lambda
    // queues it (and reads pasted text inline), a worker Lambda with a
    // five-minute budget picks it up from the bus, and the admin app polls.
    // The AI key lives in Secrets Manager; the stack creates the secret with
    // a random placeholder and the importer treats anything that is not a
    // real key as "AI off". Store the key with
    //   aws secretsmanager put-secret-value --secret-id <name> --secret-string sk-ant-…
    const aiSecret = new secretsmanager.Secret(this, "ImportAiKey", {
      secretName: `jj/${config.envName}/listing-import/ai-api-key`,
      description: "API key for the listing importer's AI extraction",
      removalPolicy: config.removalPolicy
    });
    // Scraping-proxy API key: substituted for `{key}` in
    // listingImport.proxyUrlTemplate at runtime, so cdk.json and the Lambda
    // env only ever hold the template. Generated as a recognisable JSON
    // placeholder; the importer treats that as "no key yet". Store the real
    // one with put-secret-value — never change generateSecretString below,
    // or CloudFormation would overwrite the stored key on the next deploy.
    const proxySecret = new secretsmanager.Secret(this, "ImportProxyKey", {
      secretName: `jj/${config.envName}/listing-import/proxy-api-key`,
      description: "API key for the listing importer's scraping proxy ({key} in the URL template)",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ placeholder: true }),
        generateStringKey: "nonce"
      },
      removalPolicy: config.removalPolicy
    });
    const importEnv = {
      ...common,
      AI_SECRET_ARN: aiSecret.secretArn,
      PROXY_SECRET_ARN: proxySecret.secretArn,
      IMPORT_AI_MODEL: config.listingImport.aiModel ?? "",
      IMPORT_PROXY_URL_TEMPLATE: config.listingImport.proxyUrlTemplate ?? ""
    };
    const importFn = new ServiceFunction(this, "ImportFn", {
      config,
      serviceName: "listing-import",
      entry: "services/listings/src/handlers/import.ts",
      description: "Listing service: queue a link import / read pasted text into a draft",
      environment: importEnv,
      memorySize: 1024,
      timeout: Duration.seconds(29)
    }).fn;
    table.grantReadWriteData(importFn);
    bus.grantPutEventsTo(importFn);
    aiSecret.grantRead(importFn);
    proxySecret.grantRead(importFn);
    // A paste import legitimately takes 5–25 s, so the latency alarm is relaxed.
    addFunctionAlarms(this, "Import", importFn, props.alarmTopic, { slowP95Ms: 27_000 });

    // The time budgets in services/listings/src/import/index.ts
    // (IMPORT_BUDGETS.link) add up to well under this timeout; the worker
    // records a "timeout" failure on the job itself before Lambda cuts it off.
    const importWorkerFn = new ServiceFunction(this, "ImportWorkerFn", {
      config,
      serviceName: "listing-import-worker",
      entry: "services/listings/src/handlers/import.ts",
      handler: "worker",
      description: "Listing service: run a queued link import (page fetch + AI)",
      environment: importEnv,
      memorySize: 1024,
      // Direct 10 s + proxy 145 s + AI 90 s, plus DynamoDB/S3 work and a grace
      // period for recording a timeout on the job. Lambda allows up to 15 min.
      timeout: Duration.seconds(300)
    }).fn;
    table.grantReadWriteData(importWorkerFn);
    bus.grantPutEventsTo(importWorkerFn);
    aiSecret.grantRead(importWorkerFn);
    proxySecret.grantRead(importWorkerFn);
    addFunctionAlarms(this, "ImportWorker", importWorkerFn, props.alarmTopic, {
      slowP95Ms: 250_000
    });
    new events.Rule(this, "ImportRequested", {
      eventBus: bus,
      eventPattern: {
        source: ["jj.listing"],
        detailType: ["listing.import.requested"]
      },
      // The worker only throws on a malformed event; a failed import is
      // recorded on the job, so retries cover delivery hiccups alone.
      targets: [new targets.LambdaFunction(importWorkerFn, { retryAttempts: 1 })]
    });
    new CfnOutput(this, "ImportAiSecretName", { value: aiSecret.secretName });
    new CfnOutput(this, "ImportProxySecretName", { value: proxySecret.secretName });

    const adminInt = new HttpLambdaIntegration("AdminInt", adminFn);
    const customerInt = new HttpLambdaIntegration("CustomerInt", customerFn);
    const importInt = new HttpLambdaIntegration("ImportInt", importFn);
    const { httpApi, adminAuthorizer, customerAuthorizer } = routes;

    httpApi.addRoutes({
      path: "/api/v1/admin/import",
      methods: [HttpMethod.POST],
      integration: importInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/import/{jobId}",
      methods: [HttpMethod.GET],
      integration: importInt,
      authorizer: adminAuthorizer
    });

    httpApi.addRoutes({
      path: "/api/v1/admin/listings",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/listings/bulk",
      methods: [HttpMethod.POST],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/listings/{listingId}",
      methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    for (const sub of ["status", "contact", "rank", "remodel", "publish"]) {
      httpApi.addRoutes({
        path: `/api/v1/admin/listings/{listingId}/${sub}`,
        methods: [HttpMethod.PATCH],
        integration: adminInt,
        authorizer: adminAuthorizer
      });
    }
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/shares",
      methods: [HttpMethod.GET],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/shares/{listingId}",
      methods: [HttpMethod.PUT, HttpMethod.DELETE],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/viewings",
      methods: [HttpMethod.GET],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/inbox",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/inbox/{sourceId}",
      methods: [HttpMethod.PATCH, HttpMethod.DELETE],
      integration: adminInt,
      authorizer: adminAuthorizer
    });

    httpApi.addRoutes({
      path: "/api/v1/searches/{searchId}/listings",
      methods: [HttpMethod.GET],
      integration: customerInt,
      authorizer: customerAuthorizer
    });
  }
}
