import { Stack, type StackProps } from "aws-cdk-lib";
import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type * as cognito from "aws-cdk-lib/aws-cognito";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";
import type { ApiRoutes } from "./api-stack";
import type { AppConfig } from "./config";
import { addFunctionAlarms, ServiceFunction } from "./service-construct";

export interface SearchStackProps extends StackProps {
  config: AppConfig;
  routes: ApiRoutes;
  table: dynamodb.ITable;
  bus: events.IEventBus;
  alarmTopic: sns.ITopic;
  customerPool: cognito.IUserPool;
}

/** Search service: client searches, briefs, settings, members/invites. */
export class SearchStack extends Stack {
  constructor(scope: Construct, id: string, props: SearchStackProps) {
    super(scope, id, props);
    const { config, routes, table, bus } = props;
    const common = {
      SEARCH_TABLE: table.tableName,
      EVENT_BUS_NAME: bus.eventBusName
    };

    const adminFn = new ServiceFunction(this, "AdminFn", {
      config,
      serviceName: "search-admin",
      entry: "services/search/src/handlers/admin.ts",
      description: "Search service: admin routes",
      environment: {
        ...common,
        CUSTOMER_POOL_ID: props.customerPool.userPoolId
      }
    }).fn;
    table.grantReadWriteData(adminFn);
    bus.grantPutEventsTo(adminFn);
    adminFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:AdminCreateUser", "cognito-idp:AdminGetUser"],
        resources: [props.customerPool.userPoolArn]
      })
    );
    addFunctionAlarms(this, "Admin", adminFn, props.alarmTopic);

    const customerFn = new ServiceFunction(this, "CustomerFn", {
      config,
      serviceName: "search-customer",
      entry: "services/search/src/handlers/customer.ts",
      description: "Search service: customer routes",
      environment: common
    }).fn;
    table.grantReadWriteData(customerFn); // reads + lastSeen touch
    bus.grantPutEventsTo(customerFn);
    addFunctionAlarms(this, "Customer", customerFn, props.alarmTopic);

    const adminInt = new HttpLambdaIntegration("AdminInt", adminFn);
    const customerInt = new HttpLambdaIntegration("CustomerInt", customerFn);
    const { httpApi, adminAuthorizer, customerAuthorizer } = routes;

    httpApi.addRoutes({
      path: "/api/v1/admin/searches",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}",
      methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/brief",
      methods: [HttpMethod.PUT],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/members",
      methods: [HttpMethod.POST],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/members/{userId}",
      methods: [HttpMethod.DELETE],
      integration: adminInt,
      authorizer: adminAuthorizer
    });

    httpApi.addRoutes({
      path: "/api/v1/searches",
      methods: [HttpMethod.GET],
      integration: customerInt,
      authorizer: customerAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/searches/{searchId}",
      methods: [HttpMethod.GET],
      integration: customerInt,
      authorizer: customerAuthorizer
    });
  }
}
