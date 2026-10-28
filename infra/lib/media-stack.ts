import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import type * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";
import type { ApiRoutes } from "./api-stack";
import type { AppConfig } from "./config";
import {
  addFunctionAlarms,
  ServiceFunction,
  ServiceTable
} from "./service-construct";

export interface MediaStackProps extends StackProps {
  config: AppConfig;
  routes: ApiRoutes;
  bus: events.IEventBus;
  alarmTopic: sns.ITopic;
}

/** Media service: photo/floor-plan metadata + S3 storage via pre-signed URLs. */
export class MediaStack extends Stack {
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: MediaStackProps) {
    super(scope, id, props);
    const { config, routes, bus } = props;

    this.bucket = new s3.Bucket(this, "Media", {
      bucketName: `jj-media-${config.envName}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: config.removalPolicy,
      autoDeleteObjects: config.envName === "dev",
      // Browser pre-signed PUT/GET needs CORS. "*" is safe here: the bucket is
      // private and every request is authorised by its pre-signed signature;
      // CloudFront app domains aren't knowable before deployment.
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ["*"],
          allowedHeaders: ["content-type"],
          maxAge: 3600
        }
      ],
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(3) }
      ]
    });

    const table = new ServiceTable(this, "MediaTable", {
      config,
      tableName: "media",
      gsi1: true // photos by search
    }).table;

    const common = {
      MEDIA_TABLE: table.tableName,
      MEDIA_BUCKET: this.bucket.bucketName,
      EVENT_BUS_NAME: bus.eventBusName
    };

    const adminFn = new ServiceFunction(this, "AdminFn", {
      config,
      serviceName: "media-admin",
      entry: "services/media/src/handlers/admin.ts",
      description: "Media service: admin routes",
      environment: common
    }).fn;
    table.grantReadWriteData(adminFn);
    this.bucket.grantReadWrite(adminFn);
    this.bucket.grantDelete(adminFn);
    bus.grantPutEventsTo(adminFn);
    addFunctionAlarms(this, "Admin", adminFn, props.alarmTopic);

    const customerFn = new ServiceFunction(this, "CustomerFn", {
      config,
      serviceName: "media-customer",
      entry: "services/media/src/handlers/customer.ts",
      description: "Media service: customer routes",
      environment: common
    }).fn;
    table.grantReadData(customerFn);
    this.bucket.grantRead(customerFn); // signs download URLs
    addFunctionAlarms(this, "Customer", customerFn, props.alarmTopic);

    const eventsFn = new ServiceFunction(this, "EventsFn", {
      config,
      serviceName: "media-events",
      entry: "services/media/src/handlers/events.ts",
      description: "Media service: listing event consumer",
      environment: common,
      timeout: Duration.seconds(30)
    }).fn;
    table.grantReadWriteData(eventsFn);
    this.bucket.grantDelete(eventsFn);
    addFunctionAlarms(this, "Events", eventsFn, props.alarmTopic);

    new events.Rule(this, "ListingEvents", {
      eventBus: bus,
      eventPattern: {
        source: ["jj.listing"],
        detailType: ["listing.published", "listing.unpublished", "listing.deleted"]
      },
      targets: [new targets.LambdaFunction(eventsFn, { retryAttempts: 2 })]
    });

    const adminInt = new HttpLambdaIntegration("AdminInt", adminFn);
    const customerInt = new HttpLambdaIntegration("CustomerInt", customerFn);
    const { httpApi, adminAuthorizer, customerAuthorizer } = routes;

    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/photos",
      methods: [HttpMethod.GET],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/listings/{listingId}/photos/presign",
      methods: [HttpMethod.POST],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/listings/{listingId}/photos/order",
      methods: [HttpMethod.PATCH],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/listings/{listingId}/photos/{photoId}/confirm",
      methods: [HttpMethod.POST],
      integration: adminInt,
      authorizer: adminAuthorizer
    });
    httpApi.addRoutes({
      path: "/api/v1/admin/searches/{searchId}/listings/{listingId}/photos/{photoId}",
      methods: [HttpMethod.DELETE],
      integration: adminInt,
      authorizer: adminAuthorizer
    });

    httpApi.addRoutes({
      path: "/api/v1/searches/{searchId}/photos",
      methods: [HttpMethod.GET],
      integration: customerInt,
      authorizer: customerAuthorizer
    });

    new CfnOutput(this, "MediaBucketName", { value: this.bucket.bucketName });
  }
}
