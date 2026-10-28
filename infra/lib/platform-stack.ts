import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";
import type { AppConfig } from "./config";

export interface PlatformStackProps extends StackProps {
  config: AppConfig;
}

/** Shared platform pieces: the domain event bus and the alarm topic. */
export class PlatformStack extends Stack {
  readonly bus: events.EventBus;
  readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: PlatformStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.bus = new events.EventBus(this, "Bus", {
      eventBusName: `jj-events-${config.envName}`
    });

    this.alarmTopic = new sns.Topic(this, "Alarms", {
      topicName: `jj-alarms-${config.envName}`
    });
    if (config.alarmEmail) {
      this.alarmTopic.addSubscription(
        new subs.EmailSubscription(config.alarmEmail)
      );
    }

    // In dev, mirror every domain event into a log group for debugging.
    if (config.envName === "dev") {
      const logGroup = new logs.LogGroup(this, "BusLog", {
        logGroupName: `/jj/${config.envName}/event-bus`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: config.removalPolicy
      });
      new events.Rule(this, "LogAll", {
        eventBus: this.bus,
        eventPattern: { source: [{ prefix: "jj." } as never] },
        targets: [new targets.CloudWatchLogGroup(logGroup)]
      });
    }

    new CfnOutput(this, "EventBusName", { value: this.bus.eventBusName });
  }
}
