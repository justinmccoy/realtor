import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import {
  HttpJwtAuthorizer,
  HttpLambdaAuthorizer,
  HttpLambdaResponseType
} from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwactions from "aws-cdk-lib/aws-cloudwatch-actions";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";
import type { AuthStack } from "./auth-stack";
import type { AppConfig } from "./config";
import { ServiceFunction } from "./service-construct";

export interface ApiStackProps extends StackProps {
  config: AppConfig;
  auth: AuthStack;
  /** search-table: the customer authorizer queries its membership GSI. */
  searchTable: dynamodb.ITable;
  alarmTopic: sns.ITopic;
}

/** What every service stack needs to register routes. */
export interface ApiRoutes {
  httpApi: apigwv2.HttpApi;
  customerAuthorizer: apigwv2.IHttpRouteAuthorizer;
  adminAuthorizer: apigwv2.IHttpRouteAuthorizer;
}

/**
 * One HTTP API for all services. All routes live under /api/v1 so the two
 * CloudFront distributions can forward `/api/*` without path rewriting.
 *
 * Deviation from the original plan, explained: AWS WAF cannot be associated
 * with API Gateway HTTP APIs (only REST APIs, ALBs, CloudFront, …). The API
 * is therefore fronted by the CloudFront distributions, which carry the WAF
 * web ACL — browser traffic reaches the API same-origin via `/api/*`.
 */
export class ApiStack extends Stack {
  readonly httpApi: apigwv2.HttpApi;
  readonly routes: ApiRoutes;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config, auth } = props;

    const corsOrigins = [
      ...config.devOrigins,
      ...(config.domain
        ? [`https://${config.domain.customer}`, `https://${config.domain.admin}`]
        : [])
    ];

    this.httpApi = new apigwv2.HttpApi(this, "Api", {
      apiName: `jj-api-${config.envName}`,
      corsPreflight: {
        allowOrigins: corsOrigins,
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ["authorization", "content-type"],
        maxAge: Duration.hours(1)
      }
    });

    // Admin routes: JWT authorizer bound to the admin pool issuer. A customer
    // token fails here structurally (wrong issuer), before any handler runs.
    const adminAuthorizer = new HttpJwtAuthorizer(
      "AdminJwt",
      `https://cognito-idp.${this.region}.amazonaws.com/${auth.adminPool.userPoolId}`,
      { jwtAudience: [auth.adminClient.userPoolClientId] }
    );

    // Customer routes: Lambda authorizer (code owned by the search service)
    // that verifies the customer-pool token and loads search memberships.
    const authorizerFn = new ServiceFunction(this, "CustomerAuthorizerFn", {
      config,
      serviceName: "customer-authorizer",
      entry: "services/search/src/handlers/authorizer.ts",
      description: "Verifies customer JWTs and resolves search memberships",
      environment: {
        SEARCH_TABLE: props.searchTable.tableName,
        CUSTOMER_POOL_ID: auth.customerPool.userPoolId,
        CUSTOMER_CLIENT_ID: auth.customerClient.userPoolClientId
      }
    }).fn;
    // Least privilege: Query on the membership GSI only.
    authorizerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query"],
        resources: [`${props.searchTable.tableArn}/index/GSI1`]
      })
    );

    const customerAuthorizer = new HttpLambdaAuthorizer(
      "CustomerAuth",
      authorizerFn,
      {
        responseTypes: [HttpLambdaResponseType.SIMPLE],
        identitySource: ["$request.header.Authorization"],
        resultsCacheTtl: Duration.minutes(5)
      }
    );

    // Basic stage-wide throttling (per-IP protection is WAF's job at the edge).
    const stage = this.httpApi.defaultStage?.node
      .defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = {
      throttlingRateLimit: 50,
      throttlingBurstLimit: 100
    };

    const serverErrors = new cloudwatch.Alarm(this, "Api5xx", {
      metric: this.httpApi.metricServerError({ period: Duration.minutes(5) }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "API Gateway 5xx responses"
    });
    serverErrors.addAlarmAction(new cwactions.SnsAction(props.alarmTopic));

    this.routes = {
      httpApi: this.httpApi,
      customerAuthorizer,
      adminAuthorizer
    };

    new CfnOutput(this, "ApiEndpoint", { value: this.httpApi.apiEndpoint });
    new CfnOutput(this, "ApiId", { value: this.httpApi.apiId });
  }
}
