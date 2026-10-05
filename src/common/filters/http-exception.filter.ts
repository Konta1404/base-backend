import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Prisma } from "../../generated/prisma/client.js";

/**
 * Every error leaves the API as `{ statusCode, message, errors? }` where
 * `message` is always a human-readable string. base-frontend shows
 * `message` to the user as-is, so never put internals in it.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exceptions");

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const requestId = http.getRequest<Request & { id?: string }>()?.id;
    const { statusCode, message, errors } = this.normalize(exception);

    const body: Record<string, unknown> = { statusCode, message };
    if (errors) body.errors = errors;
    if (statusCode >= 500) {
      // Quote this id when reporting a problem; it matches the server log line.
      if (requestId) body.requestId = requestId;
      this.logger.error(exception instanceof Error ? exception.stack : String(exception), {
        requestId,
      });
    }

    res.status(statusCode).json(body);
  }

  private normalize(exception: unknown): {
    statusCode: number;
    message: string;
    errors?: string[];
  } {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const body = exception.getResponse();
      const raw =
        typeof body === "string" ? body : (body as { message?: string | string[] }).message;
      if (Array.isArray(raw)) {
        return { statusCode, message: raw[0] ?? exception.message, errors: raw };
      }
      return { statusCode, message: raw ?? exception.message };
    }

    const bodyError = bodyParserError(exception);
    if (bodyError) return bodyError;

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2002") {
        return { statusCode: HttpStatus.CONFLICT, message: "Resource already exists." };
      }
      if (exception.code === "P2025") {
        return { statusCode: HttpStatus.NOT_FOUND, message: "Resource not found." };
      }
    }

    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: "Internal server error." };
  }
}

/**
 * Express body-parser errors (oversized body, bad encoding…) aren't HttpExceptions;
 * map them to their 4xx status instead of a 500.
 */
function bodyParserError(exception: unknown) {
  if (typeof exception !== "object" || exception === null) return undefined;
  const { status, type } = exception as { status?: unknown; type?: unknown };
  if (typeof status !== "number" || status < 400 || status >= 500 || typeof type !== "string") {
    return undefined;
  }
  const messages: Record<string, string> = {
    "entity.too.large": "Request body is too large.",
    "entity.parse.failed": "Malformed JSON body.",
    "encoding.unsupported": "Unsupported request encoding.",
    "charset.unsupported": "Unsupported request charset.",
    "request.aborted": "Request was aborted.",
  };
  return { statusCode: status, message: messages[type] ?? "Invalid request body." };
}
