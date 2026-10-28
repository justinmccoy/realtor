import { Logger } from "@aws-lambda-powertools/logger";

export const logger = new Logger({
  serviceName: process.env.POWERTOOLS_SERVICE_NAME ?? "jj",
  logLevel:
    (process.env.LOG_LEVEL as "DEBUG" | "INFO" | "WARN" | "ERROR" | undefined) ??
    "INFO"
});
