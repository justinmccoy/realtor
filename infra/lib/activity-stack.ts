import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import type * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import type { ApiRoutes } from "./api-stack";
import type { AppConfig } from "./config";
import {
  addFunctionAlarms,
  ServiceFunction,
  ServiceTable
} from "./service-construct";

export interface ActivityStackProps extends StackProps {
  config: AppConfig;
  routes: ApiRoutes;
  bus: events.IEventBus;
  alarmTopic: sns.ITopic;
}

/** Activity service: audit log, client activity feed, engagement rollups. */
export class ActivityStack extends Stack {
  constructor(scope: Construct, id: string, props: ActivityStackProps) {
    super(scope, id, props);
    const { config, routes, bus } = props;

    const table = new ServiceTable(this, "ActivityTable", {
      config,
      tableName: "activity",
      gsi1: true, // by actor
      gsi2: true, // global recent feed
      timeToLiveAttribute: "expiresAt" // feed items only; audit has no TTL
    }).table;

    const common = {
      ACTIVITY_TABLE: table.tableName,
      EVENT_BUS_NAME: bus.eventBusName
    };

    // The sink for every domain event — audit trail must not drop events, so
    // failures retry and then land in a DLQ that alarms.
    const eventsFn = new ServiceFunction(this, "EventsFn", {
      config,
      serviceName: "activity-events",
      entry: "services/activity/src/handlers/events.ts",
      description: "Activity service: domain event sink",
      environment: common,
      timeout: Duration.seconds(30)
    }).fn;
    table.grantReadWriteData(eventsFn);
    addFunctionAlarms(this, "Events", eventsFn, props.alarmTopic);

    const dlq = new sqs.Queue(this, "EventsDlq", {
      queueName: `jj-activity-dlq-${config.envName}`,
      retentionPeriod: Duration.days(14)
    });
    new events.Rule(this, "AllDomainEvents", {
      eventBus: bus,
      eventPattern: { source: events.Match.prefix("jj.") },
      targets: [
        new targets.LambdaFunction(eventsFn, {
          retryAttempts: 2,
          deadLetterQueue: dlq
        })
      ]
    });

    const adminFn = new ServiceFunction(this, "AdminFn", {
      config,
      serviceName: "activity-admin",
      entry: "services/activity/src/handlers/admin.ts",
      description: "Activity service: admin feed/audit/engagement",
      environment: common
    }).fn;
    table.grantReadData(adminFn);
    addFunctionAlarms(this, "Admin", adminFn, props.alarmTopic);

    const customerFn = new ServiceFunction(this, "CustomerFn", {
      config,
      serviceName: "activity-customer",
      entry: "services/activity/src/handlers/customer.ts",
      description: "Activity service: client event intake",
      environment: common
    }).fn;
    table.grantReadWriteData(customerFn);
    addFunctionAlarms(this, "Customer", customerFn, props.alarmTopic);

    const adminInt = new HttpLambdaIntegration("AdminInt", adminFn);
    const customerInt = new HttpLambdaIntegration("CustomerInt", customerFn);
    const { httpApi, adminAuthorizer, customerAuthorizer } = routes;

    httpApi.addRoutes({
      path: "/api/v1/admin/activity-summary",
      methods: [HttpMethod.GET],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/activity",
      methods: [HttpMethod.GET],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/audit",
      methods: [HttpMethod.GET],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/engagement",
      methods: [HttpMethod.GET],
      integration: adminInt,
      authorizer: adminAuthorizer
    });

    httpApi.addRoutes({
      path: "/api/v1/activity/events",
      methods: [HttpMethod.POST],
      integration: customerInt,
      authorizer: customerAuthorizer
    });
  }
}
