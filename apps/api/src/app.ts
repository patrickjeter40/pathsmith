import "reflect-metadata";
import {
  Catch,
  HttpException,
  Module,
  type ArgumentsHost,
  type CallHandler,
  type ExceptionFilter,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import { map } from "rxjs";
import { byteLength, inspectJson, MAX_ARTIFACT_BYTES } from "@pathsmith/contracts";
import { PathsmithError } from "@pathsmith/core";
import { StorageError } from "@pathsmith/storage";
import { ApiController } from "./controller.js";
import { LocalApplication, type ProviderConfiguration } from "./service.js";

@Module({})
class AppModule {}

@Catch()
class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof StorageError) {
      const status =
        exception.code === "NOT_FOUND"
          ? 404
          : exception.code === "INVALID_REQUEST"
            ? 400
            : 409;
      response
        .status(status)
        .json({ error: { code: exception.code, message: exception.message } });
      return;
    }
    if (exception instanceof PathsmithError) {
      response.status(422).json({
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.details ? { details: exception.details } : {}),
        },
      });
      return;
    }
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const supplied =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    if (
      supplied &&
      typeof supplied === "object" &&
      "error" in supplied &&
      supplied.error &&
      typeof supplied.error === "object" &&
      "code" in supplied.error
    ) {
      response.status(status).json(supplied);
      return;
    }
    response.status(status).json({
      error: {
        code:
          status === 404
            ? "NOT_FOUND"
            : status === 400
              ? "BAD_REQUEST"
              : "INTERNAL_ERROR",
        message:
          status === 404
            ? "API route not found"
            : status === 400
              ? "Malformed request"
              : "Internal service error",
      },
    });
  }
}
class ResponseBudget implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      map((value: unknown) => {
        if (
          value !== undefined &&
          byteLength(value, MAX_ARTIFACT_BYTES) > MAX_ARTIFACT_BYTES
        )
          throw new HttpException(
            {
              error: {
                code: "RESPONSE_TOO_LARGE",
                message: "Response exceeds 256 MiB; request a smaller page",
              },
            },
            413,
          );
        return value;
      }),
    );
  }
}
function requestBudget(request: Request): number {
  if (["/api/v1/runs", "/api/v1/runs/preflight"].includes(request.path)) return 1024 * 1024;
  if (request.path === "/api/v1/projects/import") return 9 * 1024 * 1024;
  // Import envelopes have a small allowance above the artifact's own checked limit.
  if (
    /^\/api\/v1\/(?:projects\/[^/]+\/suites|suites\/[^/]+\/draft)$/.test(
      request.path,
    )
  )
    return 9 * 1024 * 1024;
  if (
    /^\/api\/v1\/(?:projects\/[^/]+\/workflows|workflows\/[^/]+\/(?:draft|save-version))$/.test(
      request.path,
    )
  )
    return 2 * 1024 * 1024;
  return 512 * 1024;
}

export async function createApi(
  options: {
    host?: string;
    port?: number;
    dataDir?: string;
    providerConfig?: ProviderConfiguration;
  } = {},
) {
  const host = options.host ?? process.env.PATHSMITH_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.PATHSMITH_PORT ?? 4310);
  if (!["127.0.0.1", "localhost", "::1"].includes(host))
    throw new Error("Pathsmith supports loopback listen addresses only");
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid local API port");
  const local = new LocalApplication(
    options.dataDir ?? process.env.PATHSMITH_DATA_DIR,
    options.providerConfig,
  );
  let app: NestExpressApplication | undefined;
  try {
    app = await NestFactory.create<NestExpressApplication>(
      {
        module: AppModule,
        controllers: [ApiController],
        providers: [{ provide: LocalApplication, useValue: local }],
      },
      { logger: false, bodyParser: false, abortOnError: false },
    );
    const origins = new Set([
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      `http://[::1]:${port}`,
    ]);
    app.use((request: Request, response: Response, next: NextFunction) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      const reject = (status: number, code: string, message: string) =>
        response.status(status).json({ error: { code, message } });
      if (
        !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(
          request.headers.host ?? "",
        )
      )
        return reject(403, "HOST_REJECTED", "Only local hosts are allowed");
      if (request.headers.origin && !origins.has(request.headers.origin))
        return reject(403, "ORIGIN_REJECTED", "Origin is not allowed");
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        request.headers["x-pathsmith-client"] !== "local"
      )
        return reject(
          403,
          "MUTATION_HEADER_REQUIRED",
          "Mutations require X-Pathsmith-Client: local",
        );
      if (
        Number(request.headers["content-length"] ?? 0) > requestBudget(request)
      )
        return reject(
          413,
          "REQUEST_TOO_LARGE",
          "Request exceeds the route size limit",
        );
      next();
    });
    app.useBodyParser("json", { limit: "9mb", strict: true });
    app.use((request: Request, response: Response, next: NextFunction) => {
      if (
        request.body !== undefined &&
        inspectJson(request.body, 9 * 1024 * 1024).length
      ) {
        response.status(400).json({
          error: { code: "BAD_REQUEST", message: "Expected safe JSON input" },
        });
        return;
      }
      if (
        request.body !== undefined &&
        byteLength(request.body, requestBudget(request)) >
          requestBudget(request)
      ) {
        response.status(413).json({
          error: {
            code: "REQUEST_TOO_LARGE",
            message: "Request exceeds the route size limit",
          },
        });
        return;
      }
      next();
    });
    app.use(
      (
        error: { type?: string },
        _request: Request,
        response: Response,
        _next: NextFunction,
      ) => {
        const large = error.type === "entity.too.large";
        response.status(large ? 413 : 400).json({
          error: {
            code: large ? "REQUEST_TOO_LARGE" : "BAD_REQUEST",
            message: large
              ? "Request exceeds the route size limit"
              : "Malformed JSON request",
          },
        });
      },
    );
    app.useGlobalFilters(new ApiErrorFilter());
    app.useGlobalInterceptors(new ResponseBudget());
    await app.listen(port, host);
    const actualPort = new URL(await app.getUrl()).port;
    for (const hostname of ["127.0.0.1", "localhost", "[::1]"])
      origins.add(`http://${hostname}:${actualPort}`);
    return app;
  } catch (error) {
    if (app) await app.close();
    else await local.onModuleDestroy();
    throw error;
  }
}
