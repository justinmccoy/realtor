import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { APIGatewayRequestSimpleAuthorizerHandlerV2WithContext } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, logger, tableName } from "@jj/lambda-kit";
import type { MemberRole } from "@jj/shared";
import { MEMBERSHIP_INDEX } from "../keys.js";

/**
 * Customer API authorizer: verifies the customer-pool access token, then
 * loads the caller's search memberships so downstream handlers get a
 * ready-made access map without touching the search table themselves.
 * Results are cached by API Gateway (keyed on the Authorization header).
 */
export interface CustomerAuthzContext {
  userId: string;
  email: string;
  displayName: string;
  /** JSON: Record<searchId, MemberRole> */
  memberships: string;
  [key: string]: string;
}

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.CUSTOMER_POOL_ID ?? "",
  tokenUse: "access",
  clientId: process.env.CUSTOMER_CLIENT_ID ?? ""
});

interface MemberItem {
  searchId: string;
  role: MemberRole;
  email?: string;
  displayName?: string;
}

export const handler: APIGatewayRequestSimpleAuthorizerHandlerV2WithContext<
  CustomerAuthzContext
> = async (event) => {
  const deny = {
    isAuthorized: false,
    context: { userId: "", email: "", displayName: "", memberships: "{}" }
  };
  try {
    const header =
      event.headers?.authorization ?? event.headers?.Authorization ?? "";
    const token = header.replace(/^Bearer\s+/i, "").trim();
    if (!token) return deny;

    const payload = await verifier.verify(token);
    const userId = payload.sub;

    const res = await ddb().send(
      new QueryCommand({
        TableName: tableName("SEARCH_TABLE"),
        IndexName: MEMBERSHIP_INDEX,
        KeyConditionExpression: "GSI1PK = :u",
        ExpressionAttributeValues: { ":u": `USER#${userId}` },
        Limit: 50
      })
    );
    const members = (res.Items ?? []) as MemberItem[];
    const memberships: Record<string, MemberRole> = {};
    for (const m of members) {
      if (m.searchId && m.role) memberships[m.searchId] = m.role;
    }
    const first = members[0];
    return {
      isAuthorized: true,
      context: {
        userId,
        email: first?.email ?? "",
        displayName: first?.displayName ?? "Client",
        memberships: JSON.stringify(memberships)
      }
    };
  } catch (err) {
    logger.warn("customer token rejected", {
      reason: err instanceof Error ? err.message : String(err)
    });
    return deny;
  }
};
