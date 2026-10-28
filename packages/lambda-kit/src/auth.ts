import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ApiError, type MemberRole } from "@jj/shared";

/** Context injected by the customer Lambda authorizer (search service). */
export interface CustomerAuth {
  kind: "customer";
  userId: string;
  email: string;
  displayName: string;
  /** searchId -> role for every search this user is a member of. */
  memberships: Record<string, MemberRole>;
}

/** Context derived from the admin user pool JWT. */
export interface AdminAuth {
  kind: "admin";
  userId: string;
  email: string;
  displayName: string;
}

type AuthorizerBag = {
  lambda?: Record<string, unknown>;
  jwt?: { claims?: Record<string, unknown> };
};

function authorizer(event: APIGatewayProxyEventV2): AuthorizerBag {
  const rc = event.requestContext as unknown as { authorizer?: AuthorizerBag };
  return rc.authorizer ?? {};
}

export function customerAuth(event: APIGatewayProxyEventV2): CustomerAuth {
  const ctx = authorizer(event).lambda;
  if (!ctx || typeof ctx.userId !== "string") {
    throw ApiError.unauthorized();
  }
  let memberships: Record<string, MemberRole> = {};
  try {
    memberships = JSON.parse(String(ctx.memberships ?? "{}")) as Record<
      string,
      MemberRole
    >;
  } catch {
    throw ApiError.unauthorized("Malformed authorizer context");
  }
  return {
    kind: "customer",
    userId: ctx.userId,
    email: String(ctx.email ?? ""),
    displayName: String(ctx.displayName ?? "Client"),
    memberships
  };
}

/** Throws 403 unless the user is a member of the search. Returns their role. */
export function requireSearchAccess(
  auth: CustomerAuth,
  searchId: string
): MemberRole {
  const role = auth.memberships[searchId];
  if (!role) throw ApiError.forbidden("No access to this search");
  return role;
}

export function adminAuth(event: APIGatewayProxyEventV2): AdminAuth {
  const claims = authorizer(event).jwt?.claims;
  if (!claims || typeof claims.sub !== "string") {
    throw ApiError.unauthorized();
  }
  // HTTP API JWT authorizers stringify array claims, e.g. "[admin]".
  const rawGroups = claims["cognito:groups"];
  const groups = Array.isArray(rawGroups)
    ? rawGroups.map(String)
    : String(rawGroups ?? "")
        .replace(/^\[|\]$/g, "")
        .split(/[,\s]+/)
        .filter(Boolean);
  if (!groups.includes("admin")) {
    throw ApiError.forbidden("Admin group membership required");
  }
  return {
    kind: "admin",
    userId: claims.sub,
    email: String(claims.email ?? claims.username ?? ""),
    displayName: String(claims.name ?? claims.email ?? "Admin")
  };
}
