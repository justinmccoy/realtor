import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context
} from "aws-lambda";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import { ApiError, type ErrorBody } from "@jj/shared";
import { logger } from "./logger.js";

export interface HandlerArgs<B, Q, P> {
  body: B;
  query: Q;
  path: P;
  event: APIGatewayProxyEventV2;
  requestId: string;
}

export interface HandlerResult {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ApiHandlerOptions<B, Q, P> {
  body?: ZodType<B, ZodTypeDef, unknown>;
  query?: ZodType<Q, ZodTypeDef, unknown>;
  path?: ZodType<P, ZodTypeDef, unknown>;
  fn: (args: HandlerArgs<B, Q, P>) => Promise<HandlerResult | void>;
}

function json(
  status: number,
  body: unknown,
  headers?: Record<string, string>
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: status,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? "" : JSON.stringify(body)
  };
}

/**
 * Wraps a route handler with JSON parsing, zod validation, structured
 * logging, and the shared error format.
 */
export function apiHandler<B = unknown, Q = unknown, P = unknown>(
  opts: ApiHandlerOptions<B, Q, P>
): (
  event: APIGatewayProxyEventV2,
  context: Context
) => Promise<APIGatewayProxyStructuredResultV2> {
  return async (event, context) => {
    const requestId = context.awsRequestId;
    logger.appendKeys({
      requestId,
      route: event.routeKey,
      path: event.rawPath
    });
    try {
      let body = undefined as B;
      if (opts.body) {
        let raw: unknown = undefined;
        if (event.body) {
          try {
            raw = JSON.parse(
              event.isBase64Encoded
                ? Buffer.from(event.body, "base64").toString("utf8")
                : event.body
            );
          } catch {
            throw ApiError.badRequest("Request body is not valid JSON");
          }
        }
        body = opts.body.parse(raw ?? {});
      }
      const query = opts.query
        ? opts.query.parse(event.queryStringParameters ?? {})
        : (undefined as Q);
      const path = opts.path
        ? opts.path.parse(event.pathParameters ?? {})
        : (undefined as P);

      const result = (await opts.fn({ body, query, path, event, requestId })) ?? {};
      return json(result.status ?? 200, result.body, result.headers);
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message
        }));
        logger.warn("validation failed", { details });
        const body: ErrorBody = {
          error: {
            code: "validation_error",
            message: "Request validation failed",
            requestId,
            details
          }
        };
        return json(400, body);
      }
      if (err instanceof ApiError) {
        if (err.status >= 500) logger.error("api error", err as Error);
        else logger.warn("api error", { code: err.code, message: err.message });
        const body: ErrorBody = {
          error: {
            code: err.code,
            message: err.message,
            requestId,
            ...(err.details !== undefined ? { details: err.details } : {})
          }
        };
        return json(err.status, body);
      }
      logger.error("unhandled error", err as Error);
      const body: ErrorBody = {
        error: { code: "internal", message: "Internal server error", requestId }
      };
      return json(500, body);
    } finally {
      logger.removeKeys(["requestId", "route", "path"]);
    }
  };
}
