import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
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
      gsi1: true // sparse upcoming-viewings index
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

    const adminInt = new HttpLambdaIntegration("AdminInt", adminFn);
    const customerInt = new HttpLambdaIntegration("CustomerInt", customerFn);
    const { httpApi, adminAuthorizer, customerAuthorizer } = routes;

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
