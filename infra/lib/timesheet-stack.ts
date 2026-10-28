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

export interface TimesheetStackProps extends StackProps {
  config: AppConfig;
  routes: ApiRoutes;
  bus: events.IEventBus;
  alarmTopic: sns.ITopic;
}

/** Timesheet service: hours ledger, paid tracking, live timer. */
export class TimesheetStack extends Stack {
  constructor(scope: Construct, id: string, props: TimesheetStackProps) {
    super(scope, id, props);
    const { config, routes, bus } = props;

    const table = new ServiceTable(this, "TimesheetTable", {
      config,
      tableName: "timesheet"
    }).table;

    const common = {
      TIMESHEET_TABLE: table.tableName,
      EVENT_BUS_NAME: bus.eventBusName
    };

    const adminFn = new ServiceFunction(this, "AdminFn", {
      config,
      serviceName: "timesheet-admin",
      entry: "services/timesheet/src/handlers/admin.ts",
      description: "Timesheet service: admin routes",
      environment: common
    }).fn;
    table.grantReadWriteData(adminFn);
    bus.grantPutEventsTo(adminFn);
    addFunctionAlarms(this, "Admin", adminFn, props.alarmTopic);

    const customerFn = new ServiceFunction(this, "CustomerFn", {
      config,
      serviceName: "timesheet-customer",
      entry: "services/timesheet/src/handlers/customer.ts",
      description: "Timesheet service: customer routes",
      environment: common
    }).fn;
    table.grantReadData(customerFn);
    addFunctionAlarms(this, "Customer", customerFn, props.alarmTopic);

    const adminInt = new HttpLambdaIntegration("AdminInt", adminFn);
    const customerInt = new HttpLambdaIntegration("CustomerInt", customerFn);
    const { httpApi, adminAuthorizer, customerAuthorizer } = routes;

    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/hours",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/hours/pay-month",
      methods: [HttpMethod.POST],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/hours/{entryId}",
      methods: [HttpMethod.PUT, HttpMethod.DELETE],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/timer",
      methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/timer/stop",
      methods: [HttpMethod.POST],
      integration: adminInt,
      authorizer: adminAuthorizer
    });

    httpApi.addRoutes({
      path: "/api/v1/searches/{searchId}/hours",
      methods: [HttpMethod.GET],
      integration: customerInt,
      authorizer: customerAuthorizer
    });
  }
}
