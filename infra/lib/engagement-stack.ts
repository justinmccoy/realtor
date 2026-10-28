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

export interface EngagementStackProps extends StackProps {
  config: AppConfig;
  routes: ApiRoutes;
  bus: events.IEventBus;
  alarmTopic: sns.ITopic;
}

/** Engagement service: client ratings + threaded discussion. */
export class EngagementStack extends Stack {
  constructor(scope: Construct, id: string, props: EngagementStackProps) {
    super(scope, id, props);
    const { config, routes, bus } = props;

    const table = new ServiceTable(this, "EngagementTable", {
      config,
      tableName: "engagement",
      gsi1: true // ratings by search
    }).table;

    const common = {
      ENGAGEMENT_TABLE: table.tableName,
      EVENT_BUS_NAME: bus.eventBusName
    };

    const adminFn = new ServiceFunction(this, "AdminFn", {
      config,
      serviceName: "engagement-admin",
      entry: "services/engagement/src/handlers/admin.ts",
      description: "Engagement service: admin routes",
      environment: common
    }).fn;
    table.grantReadWriteData(adminFn);
    bus.grantPutEventsTo(adminFn);
    addFunctionAlarms(this, "Admin", adminFn, props.alarmTopic);

    const customerFn = new ServiceFunction(this, "CustomerFn", {
      config,
      serviceName: "engagement-customer",
      entry: "services/engagement/src/handlers/customer.ts",
      description: "Engagement service: customer routes",
      environment: common
    }).fn;
    table.grantReadWriteData(customerFn);
    bus.grantPutEventsTo(customerFn);
    addFunctionAlarms(this, "Customer", customerFn, props.alarmTopic);

    const eventsFn = new ServiceFunction(this, "EventsFn", {
      config,
      serviceName: "engagement-events",
      entry: "services/engagement/src/handlers/events.ts",
      description: "Engagement service: listing event consumer",
      environment: common,
      timeout: Duration.seconds(30)
    }).fn;
    table.grantReadWriteData(eventsFn);
    addFunctionAlarms(this, "Events", eventsFn, props.alarmTopic);

    new events.Rule(this, "ListingEvents", {
      eventBus: bus,
      eventPattern: {
        source: ["jj.listing"],
        detailType: [
          "listing.created",
          "listing.updated",
          "listing.published",
          "listing.unpublished",
          "listing.deleted"
        ]
      },
      targets: [new targets.LambdaFunction(eventsFn, { retryAttempts: 2 })]
    });

    const adminInt = new HttpLambdaIntegration("AdminInt", adminFn);
    const customerInt = new HttpLambdaIntegration("CustomerInt", customerFn);
    const { httpApi, adminAuthorizer, customerAuthorizer } = routes;

    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/ratings",
      methods: [HttpMethod.GET],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/listings/{listingId}/ratings/{userId}",
      methods: [HttpMethod.DELETE],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/comments",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/comments/{commentId}",
      methods: [HttpMethod.DELETE],
      integration: adminInt,
      authorizer: adminAuthorizer
    });

    httpApi.addRoutes({
      path: "/api/v1/searches/{searchId}/ratings",
      methods: [HttpMethod.GET],
      integration: customerInt,
      authorizer: customerAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/searches/{searchId}/listings/{listingId}/rating",
      methods: [HttpMethod.PUT, HttpMethod.DELETE],
      integration: customerInt,
      authorizer: customerAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/searches/{searchId}/comments",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: customerInt,
      authorizer: customerAuthorizer
    });
  }
}
