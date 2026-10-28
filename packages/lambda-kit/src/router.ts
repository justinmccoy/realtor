import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context
} from "aws-lambda";

export type RouteHandler = (
  event: APIGatewayProxyEventV2,
  context: Context
) => Promise<APIGatewayProxyStructuredResultV2>;

/**
 * One Lambda per service + audience, dispatching on API Gateway's routeKey
 * ("POST /api/v1/admin/searches"). Keys must match the routes the service's
 * CDK stack registers.
 */
export function dispatch(routes: Record<string, RouteHandler>): RouteHandler {
  return async (event, context) => {
    const handler = routes[event.routeKey];
    if (!handler) {
      return {
        statusCode: 404,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          error: { code: "not_found", message: `No route ${event.routeKey}` }
        })
      };
    }
    return handler(event, context);
  };
}
