import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import type { Member, MemberRole, Search } from "@jj/shared";

const repo = vi.hoisted(() => ({
  getSearch: vi.fn(),
  getMember: vi.fn(),
  putMember: vi.fn(),
  listMembers: vi.fn(),
  buildMember: vi.fn()
}));
const ensureCustomerUser = vi.hoisted(() => vi.fn());
const publishEvents = vi.hoisted(() => vi.fn());

vi.mock("../../src/repo.js", () => repo);
vi.mock("../../src/cognito.js", () => ({ ensureCustomerUser }));
vi.mock("@jj/lambda-kit", async (importActual) => {
  const actual = await importActual<typeof import("@jj/lambda-kit")>();
  return { ...actual, publishEvents };
});

import { handler } from "../../src/handlers/customer.js";

const ctx = { awsRequestId: "req-1" } as Context;
const SEARCH_ID = "01JAXXXXXXXXXXXXXXXXXXXXXX";

const search: Search = {
  id: SEARCH_ID,
  clientName: "Brian",
  status: "active",
  settings: { rate: 0, budget: 0, gre: 6, notary: 2, provision: 3.57 },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z"
};

function invite(
  role: MemberRole,
  body: unknown,
  caller = { userId: "sub-me", email: "me@example.com", displayName: "Me" }
): Promise<{ statusCode?: number; body?: string }> {
  const event = {
    version: "2.0",
    routeKey: `POST /api/v1/searches/{searchId}/members`,
    rawPath: `/api/v1/searches/${SEARCH_ID}/members`,
    rawQueryString: "",
    headers: {},
    pathParameters: { searchId: SEARCH_ID },
    body: JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: {
      authorizer: {
        lambda: { ...caller, memberships: JSON.stringify({ [SEARCH_ID]: role }) }
      }
    }
  } as unknown as APIGatewayProxyEventV2;
  return handler(event, ctx);
}

describe("POST /searches/{searchId}/members (client invite)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.getSearch.mockResolvedValue(search);
    repo.getMember.mockResolvedValue(null);
    repo.putMember.mockResolvedValue(undefined);
    repo.buildMember.mockImplementation(
      (input: Omit<Member, "invitedAt" | "lastSeenAt"> & { now: string }): Member => ({
        userId: input.userId,
        searchId: input.searchId,
        email: input.email,
        displayName: input.displayName,
        role: input.role,
        invitedAt: input.now,
        lastSeenAt: null
      })
    );
    ensureCustomerUser.mockResolvedValue({
      userId: "sub-new",
      created: true,
      invitation: "new"
    });
    publishEvents.mockResolvedValue(undefined);
  });

  it("lets a member with edit access invite a viewer", async () => {
    const res = await invite("client", {
      email: "Partner@Example.com",
      displayName: "Partner",
      role: "viewer"
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body!);
    expect(body).toMatchObject({
      userId: "sub-new",
      email: "partner@example.com",
      role: "viewer",
      accountCreated: true,
      invitation: "new"
    });
    expect(ensureCustomerUser).toHaveBeenCalledWith("partner@example.com", "Partner");
    expect(repo.putMember).toHaveBeenCalledTimes(1);
    expect(publishEvents).toHaveBeenCalledWith(
      "jj.search",
      expect.objectContaining({
        type: "member.invited",
        actorRole: "client",
        payload: expect.objectContaining({ role: "viewer", accountCreated: true })
      })
    );
  });

  it("refuses viewers", async () => {
    const res = await invite("viewer", {
      email: "x@example.com",
      displayName: "X",
      role: "viewer"
    });
    expect(res.statusCode).toBe(403);
    expect(ensureCustomerUser).not.toHaveBeenCalled();
  });

  it("refuses inviting yourself or an existing member", async () => {
    const self = await invite("client", {
      email: "ME@example.com",
      displayName: "Me",
      role: "client"
    });
    expect(self.statusCode).toBe(409);

    repo.getMember.mockResolvedValueOnce({ userId: "sub-new" });
    const dup = await invite("client", {
      email: "partner@example.com",
      displayName: "Partner",
      role: "client"
    });
    expect(dup.statusCode).toBe(409);
    expect(repo.putMember).not.toHaveBeenCalled();
  });

  it("refuses invites on archived searches", async () => {
    repo.getSearch.mockResolvedValueOnce({ ...search, status: "archived" });
    const res = await invite("client", {
      email: "x@example.com",
      displayName: "X",
      role: "viewer"
    });
    expect(res.statusCode).toBe(409);
  });
});
