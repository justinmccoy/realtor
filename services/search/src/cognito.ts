import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  UsernameExistsException,
  type AttributeType,
  type UserType
} from "@aws-sdk/client-cognito-identity-provider";
import { ApiError, type InvitationOutcome } from "@jj/shared";
import { logger } from "@jj/lambda-kit";

let client: CognitoIdentityProviderClient | undefined;
function cognito(): CognitoIdentityProviderClient {
  if (!client) client = new CognitoIdentityProviderClient({});
  return client;
}

export interface CustomerAccount {
  userId: string;
  email: string;
  name: string;
  /** confirmed | temp-password | unconfirmed | <other Cognito status> */
  status: string;
  enabled: boolean;
  createdAt: string | null;
}

/** Pure mapping from a Cognito user record (unit-tested). */
export function toCustomerAccount(user: UserType): CustomerAccount | null {
  const attr = (name: string) =>
    user.Attributes?.find((a) => a.Name === name)?.Value;
  const userId = attr("sub");
  if (!userId) return null;
  const status =
    user.UserStatus === "CONFIRMED"
      ? "confirmed"
      : user.UserStatus === "FORCE_CHANGE_PASSWORD"
        ? "temp-password"
        : user.UserStatus === "UNCONFIRMED"
          ? "unconfirmed"
          : (user.UserStatus ?? "unknown").toLowerCase();
  return {
    userId,
    email: attr("email") ?? user.Username ?? "",
    name: attr("name") ?? "",
    status,
    enabled: user.Enabled ?? true,
    createdAt: user.UserCreateDate?.toISOString() ?? null
  };
}

/** Every account in the customer pool (registered or invited), newest first. */
export async function listCustomerUsers(): Promise<CustomerAccount[]> {
  const poolId = process.env.CUSTOMER_POOL_ID;
  if (!poolId) throw new ApiError(500, "internal", "CUSTOMER_POOL_ID not set");
  const accounts: CustomerAccount[] = [];
  let paginationToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await cognito().send(
      new ListUsersCommand({
        UserPoolId: poolId,
        Limit: 60,
        PaginationToken: paginationToken
      })
    );
    for (const user of res.Users ?? []) {
      const account = toCustomerAccount(user);
      if (account) accounts.push(account);
    }
    paginationToken = res.PaginationToken;
    if (!paginationToken) break;
  }
  return accounts.sort((a, b) =>
    (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
  );
}

function sub(attrs: AttributeType[] | undefined): string {
  const v = attrs?.find((a) => a.Name === "sub")?.Value;
  if (!v) throw new ApiError(500, "internal", "Cognito user has no sub");
  return v;
}

/**
 * Create the customer-pool user for an invited client (Cognito emails the
 * temporary password), or reuse the existing account for that email. An
 * account that was invited before but never signed in gets its invitation
 * sent again with a fresh temporary password: the first email may have been
 * lost, or the password expired (they last 7 days), and silently doing
 * nothing looked like "no email arrived".
 * Returns the Cognito sub, which is the userId everywhere in the system.
 */
export async function ensureCustomerUser(
  email: string,
  displayName: string
): Promise<{ userId: string; created: boolean; invitation: InvitationOutcome }> {
  const poolId = process.env.CUSTOMER_POOL_ID;
  if (!poolId) throw new ApiError(500, "internal", "CUSTOMER_POOL_ID not set");
  try {
    const res = await cognito().send(
      new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: email,
        DesiredDeliveryMediums: ["EMAIL"],
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
          { Name: "name", Value: displayName }
        ]
      })
    );
    logger.info("invited new customer user", { email });
    return { userId: sub(res.User?.Attributes), created: true, invitation: "new" };
  } catch (err) {
    if (err instanceof UsernameExistsException) {
      const existing = await cognito().send(
        new AdminGetUserCommand({ UserPoolId: poolId, Username: email })
      );
      const userId = sub(existing.UserAttributes);
      if (existing.UserStatus === "FORCE_CHANGE_PASSWORD") {
        await cognito().send(
          new AdminCreateUserCommand({
            UserPoolId: poolId,
            Username: email,
            MessageAction: "RESEND",
            DesiredDeliveryMediums: ["EMAIL"]
          })
        );
        logger.info("re-sent customer invitation", { email });
        return { userId, created: false, invitation: "resent" };
      }
      return { userId, created: false, invitation: "existing" };
    }
    throw err;
  }
}
