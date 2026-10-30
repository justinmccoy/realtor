export type ErrorCode =
  | "bad_request"
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "payload_too_large"
  /** A third-party site refused or failed the request (e.g. a bot wall). */
  | "upstream_blocked"
  | "internal";

/** Consistent error body returned by every endpoint. */
export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, "bad_request", message, details);
  }
  static validation(message: string, details?: unknown): ApiError {
    return new ApiError(400, "validation_error", message, details);
  }
  static unauthorized(message = "Not authenticated"): ApiError {
    return new ApiError(401, "unauthorized", message);
  }
  static forbidden(message = "Not allowed"): ApiError {
    return new ApiError(403, "forbidden", message);
  }
  static notFound(what = "Resource"): ApiError {
    return new ApiError(404, "not_found", `${what} not found`);
  }
  static conflict(message: string): ApiError {
    return new ApiError(409, "conflict", message);
  }
}
