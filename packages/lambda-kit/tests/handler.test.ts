import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { ApiError } from "@jj/shared";
import { apiHandler } from "../src/handler.js";

const ctx = { awsRequestId: "req-1" } as Context;

function event(overrides: Partial<APIGatewayProxyEventV2>): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /test",
    rawPath: "/test",
    rawQueryString: "",
    headers: {},
    requestContext: {} as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
    ...overrides
  } as APIGatewayProxyEventV2;
}

describe("apiHandler", () => {
  const handler = apiHandler({
    body: z.object({ name: z.string().min(1) }),
    fn: async ({ body }) => ({ status: 201, body: { hello: body.name } })
  });

  it("returns the handler result for valid input", async () => {
    const res = await handler(event({ body: JSON.stringify({ name: "Brian" }) }), ctx);
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body!)).toEqual({ hello: "Brian" });
  });

  it("maps zod failures to the shared 400 format", async () => {
    const res = await handler(event({ body: JSON.stringify({ name: "" }) }), ctx);
    expect(res.statusCode).toBe(400);
    const parsed = JSON.parse(res.body!);
    expect(parsed.error.code).toBe("validation_error");
    expect(parsed.error.requestId).toBe("req-1");
    expect(parsed.error.details[0].path).toBe("name");
  });

  it("rejects malformed JSON bodies", async () => {
    const res = await handler(event({ body: "{nope" }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body!).error.code).toBe("bad_request");
  });

  it("maps ApiError status and hides internals on unexpected errors", async () => {
    const boom = apiHandler({
      fn: async () => {
        throw ApiError.notFound("Listing");
      }
    });
    const res = await boom(event({}), ctx);
    expect(res.statusCode).toBe(404);

    const crash = apiHandler({
      fn: async () => {
        throw new Error("secret stack detail");
      }
    });
    const res2 = await crash(event({}), ctx);
    expect(res2.statusCode).toBe(500);
    expect(res2.body).not.toContain("secret stack detail");
  });
});
