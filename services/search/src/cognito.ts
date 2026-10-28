import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
  type AttributeType
} from "@aws-sdk/client-cognito-identity-provider";
import { ApiError } from "@jj/shared";
import { logger } from "@jj/lambda-kit";

let client: CognitoIdentityProviderClient | undefined;
function cognito(): CognitoIdentityProviderClient {
  if (!client) client = new CognitoIdentityProviderClient({});
  return client;
}

function sub(attrs: AttributeType[] | undefined): string {
  const v = attrs?.find((a) => a.Name === "sub")?.Value;
  if (!v) throw new ApiError(500, "internal", "Cognito user has no sub");
  return v;
}

/**
 * Create the customer-pool user for an invited client (Cognito emails the
 * temporary password), or reuse the existing account for that email.
 * Returns the Cognito sub, which is the userId everywhere in the system.
 */
export async function ensureCustomerUser(
  email: string,
  displayName: string
): Promise<{ userId: string; created: boolean }> {
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
    return { userId: sub(res.User?.Attributes), created: true };
  } catch (err) {
    if (err instanceof UsernameExistsException) {
      const existing = await cognito().send(
        new AdminGetUserCommand({ UserPoolId: poolId, Username: email })
      );
      return { userId: sub(existing.UserAttributes), created: false };
    }
    throw err;
  }
}
