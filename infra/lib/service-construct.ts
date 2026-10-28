import { Duration } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwactions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";
import * as path from "path";
import type { AppConfig } from "./config";

const repoRoot = path.join(__dirname, "..", "..");

export interface ServiceTableProps {
  config: AppConfig;
  tableName: string;
  /** Adds GSI1 (GSI1PK / GSI1SK). */
  gsi1?: boolean;
  /** Adds GSI2 (GSI2PK / GSI2SK). */
  gsi2?: boolean;
  timeToLiveAttribute?: string;
}

/** One DynamoDB table per service, on-demand billing, PITR in prod. */
export class ServiceTable extends Construct {
  readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: ServiceTableProps) {
    super(scope, id);
    const { config } = props;
    this.table = new dynamodb.Table(this, "Table", {
      tableName: `jj-${props.tableName}-${config.envName}`,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.envName === "prod"
      },
      removalPolicy: config.removalPolicy,
      timeToLiveAttribute: props.timeToLiveAttribute
    });
    if (props.gsi1) {
      this.table.addGlobalSecondaryIndex({
        indexName: "GSI1",
        partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
        sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING }
      });
    }
    if (props.gsi2) {
      this.table.addGlobalSecondaryIndex({
        indexName: "GSI2",
        partitionKey: { name: "GSI2PK", type: dynamodb.AttributeType.STRING },
        sortKey: { name: "GSI2SK", type: dynamodb.AttributeType.STRING }
      });
    }
  }
}

export interface ServiceFunctionProps {
  config: AppConfig;
  serviceName: string;
  /** Path relative to the repo root, e.g. "services/search/src/handlers/api.ts". */
  entry: string;
  handler?: string;
  environment?: Record<string, string>;
  memorySize?: number;
  timeout?: Duration;
  description?: string;
}

/** Opinionated Lambda: Node 22 / arm64, bundled TS, X-Ray, structured logs. */
export class ServiceFunction extends Construct {
  readonly fn: NodejsFunction;

  constructor(scope: Construct, id: string, props: ServiceFunctionProps) {
    super(scope, id);
    const { config } = props;
    this.fn = new NodejsFunction(this, "Fn", {
      entry: path.join(repoRoot, props.entry),
      handler: props.handler ?? "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: props.memorySize ?? 256,
      timeout: props.timeout ?? Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
      description: props.description,
      depsLockFilePath: path.join(repoRoot, "pnpm-lock.yaml"),
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node22"
      },
      logGroup: new logs.LogGroup(this, "Logs", {
        retention: config.logRetentionDays as logs.RetentionDays,
        removalPolicy: config.removalPolicy
      }),
      environment: {
        NODE_OPTIONS: "--enable-source-maps",
        POWERTOOLS_SERVICE_NAME: props.serviceName,
        LOG_LEVEL: config.envName === "prod" ? "INFO" : "DEBUG",
        ...props.environment
      }
    });
  }
}

/** Standard alarms: errors, throttles, slow p95. */
export function addFunctionAlarms(
  scope: Construct,
  idPrefix: string,
  fn: lambda.Function,
  topic: sns.ITopic
): void {
  const action = new cwactions.SnsAction(topic);

  const errors = new cloudwatch.Alarm(scope, `${idPrefix}Errors`, {
    metric: fn.metricErrors({ period: Duration.minutes(5) }),
    threshold: 1,
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    alarmDescription: `${fn.functionName}: invocation errors`
  });
  errors.addAlarmAction(action);

  const throttles = new cloudwatch.Alarm(scope, `${idPrefix}Throttles`, {
    metric: fn.metricThrottles({ period: Duration.minutes(5) }),
    threshold: 1,
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    alarmDescription: `${fn.functionName}: throttled invocations`
  });
  throttles.addAlarmAction(action);

  const p95 = new cloudwatch.Alarm(scope, `${idPrefix}SlowP95`, {
    metric: fn.metricDuration({
      period: Duration.minutes(5),
      statistic: "p95"
    }),
    threshold: 3000,
    evaluationPeriods: 3,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    alarmDescription: `${fn.functionName}: p95 latency above 3s`
  });
  p95.addAlarmAction(action);
}
