import "reflect-metadata";
import {
  Catch,
  Controller,
  Get,
  HttpException,
  Module,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";

@Controller("api/v1")
class HealthController {
  @Get("health")
  health() {
    return {
      service: "pathsmith",
      status: "ready",
      milestone: "M0–M1",
      database: { status: "not_implemented", availableFrom: "M2" },
    };
  }
  @Get("providers/status")
  providers() {
    return {
      allowedModes: ["mock"],
      defaultMode: "mock",
      providers: [
        { id: "mock", configured: true, defaultModel: "mock-v1" },
        { id: "jev", configured: false, implementation: "deferred-to-M4" },
      ],
    };
  }
}
@Module({ controllers: [HealthController] })
class AppModule {}

@Catch()
class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    response
      .status(status)
      .json({
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
export async function createApi(
  options: { host?: string; port?: number } = {},
) {
  const host = options.host ?? process.env.PATHSMITH_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.PATHSMITH_PORT ?? 4310);
  if (!["127.0.0.1", "localhost", "::1"].includes(host))
    throw new Error("Pathsmith supports loopback listen addresses only");
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid local API port");
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    bodyParser: false,
  });
  const origins = new Set([
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
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
    if (Number(request.headers["content-length"] ?? 0) > 512 * 1024)
      return reject(413, "REQUEST_TOO_LARGE", "Request exceeds 512 KiB");
    next();
  });
  app.useBodyParser("json", { limit: "512kb", strict: true });
  app.use(
    (
      error: { type?: string },
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      const large = error.type === "entity.too.large";
      response
        .status(large ? 413 : 400)
        .json({
          error: {
            code: large ? "REQUEST_TOO_LARGE" : "BAD_REQUEST",
            message: large
              ? "Request exceeds 512 KiB"
              : "Malformed JSON request",
          },
        });
    },
  );
  app.useGlobalFilters(new ApiErrorFilter());
  await app.listen(port, host);
  return app;
}
