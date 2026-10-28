import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

let doc: DynamoDBDocumentClient | undefined;

/** Shared document client. DDB_ENDPOINT points it at DynamoDB Local in tests. */
export function ddb(): DynamoDBDocumentClient {
  if (!doc) {
    const client = new DynamoDBClient(
      process.env.DDB_ENDPOINT
        ? {
            endpoint: process.env.DDB_ENDPOINT,
            region: process.env.AWS_REGION ?? "eu-central-1",
            credentials: { accessKeyId: "local", secretAccessKey: "local" }
          }
        : {}
    );
    doc = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true }
    });
  }
  return doc;
}

export function tableName(envVar: string): string {
  const v = process.env[envVar];
  if (!v) throw new Error(`Missing required env var ${envVar}`);
  return v;
}
