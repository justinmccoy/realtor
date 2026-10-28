import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";
import type { AppConfig } from "./config";
import { ServiceTable } from "./service-construct";

export interface SearchDataStackProps extends StackProps {
  config: AppConfig;
}

/**
 * The search service's table lives in its own stack because the API stack's
 * customer authorizer needs it before the search service stack exists.
 */
export class SearchDataStack extends Stack {
  readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: SearchDataStackProps) {
    super(scope, id, props);
    this.table = new ServiceTable(this, "SearchTable", {
      config: props.config,
      tableName: "search",
      gsi1: true
    }).table;
    new CfnOutput(this, "SearchTableName", { value: this.table.tableName });
  }
}
