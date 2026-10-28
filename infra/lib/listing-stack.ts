import { Stack, type StackProps } from "aws-cdk-lib";
import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type * as events from "aws-cdk-lib/aws-events";
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

/** Listing service: listings, pipeline, benchmark/top-5, link inbox. */
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
      environment: common,
      timeout: undefined,
      memorySize: 256
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

    const adminInt = new HttpLambdaIntegration("AdminInt", adminFn);
    const customerInt = new HttpLambdaIntegration("CustomerInt", customerFn);
    const { httpApi, adminAuthorizer, customerAuthorizer } = routes;

    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/listings",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/listings/bulk",
      methods: [HttpMethod.POST],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/listings/{listingId}",
      methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    for (const sub of ["status", "contact", "rank", "remodel", "publish"]) {
      httpApi.addRoutes({
        path: `/api/v1/admin/searches/{searchId}/listings/{listingId}/${sub}`,
        methods: [HttpMethod.PATCH],
        integration: adminInt,
        authorizer: adminAuthorizer
      });
    }
    httpApi.addRoutes({
      path: "/api/v1/admin/viewings",
      methods: [HttpMethod.GET],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/inbox",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/inbox/{sourceId}",
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
