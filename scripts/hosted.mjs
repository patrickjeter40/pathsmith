import { createHash, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { Transform } from "node:stream";
import { fileURLToPath } from "node:url";
import { createApi } from "../apps/api/dist/app.js";
import { LocalApplication } from "../apps/api/dist/service.js";

const MAX_BODY = 9 * 1024 * 1024;
const MAX_RESPONSE = 256 * 1024 * 1024;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};
const digest = (value) => createHash("sha256").update(value).digest();

class ConfigurationError extends Error {}

export function readHostedConfiguration(env = process.env) {
  let publicUrl;
  try {
    publicUrl = new URL(env.PATHSMITH_PUBLIC_URL);
  } catch {
    throw new ConfigurationError(
      "PATHSMITH_PUBLIC_URL must be an exact HTTPS origin",
    );
  }
  if (
    publicUrl.protocol !== "https:" ||
    publicUrl.origin !== env.PATHSMITH_PUBLIC_URL
  )
    throw new ConfigurationError(
      "PATHSMITH_PUBLIC_URL must be an exact HTTPS origin",
    );
  const user = env.PATHSMITH_AUTH_USER;
  const password = env.PATHSMITH_AUTH_PASSWORD;
  if (typeof user !== "string" || !/^[\x21-\x39\x3b-\x7e]{1,128}$/.test(user))
    throw new ConfigurationError(
      "PATHSMITH_AUTH_USER must contain 1–128 printable ASCII characters without spaces or colons",
    );
  if (
    typeof password !== "string" ||
    !/^[\x20-\x7e]{16,1024}$/.test(password) ||
    !password.trim()
  )
    throw new ConfigurationError(
      "PATHSMITH_AUTH_PASSWORD must contain 16–1024 printable ASCII characters",
    );
  const port = Number(env.PORT ?? "8080");
  if (
    !/^\d+$/.test(env.PORT ?? "8080") ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new ConfigurationError("PORT must be an integer from 1 to 65535");
  return {
    origin: publicUrl.origin,
    host: publicUrl.host,
    port,
    credentialDigest: digest(`${user}:${password}`),
  };
}

function authenticated(header, expected) {
  const match =
    typeof header === "string" &&
    /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header);
  if (!match || match[1].length > 1600) return false;
  const supplied = Buffer.from(match[1], "base64");
  if (supplied.toString("base64") !== match[1]) return false;
  return timingSafeEqual(digest(supplied), expected);
}

function send(response, status, message) {
  if (response.destroyed) return;
  if (response.headersSent) return response.destroy();
  // Rejections may precede consuming a request body; never reuse that connection.
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    Connection: "close",
  });
  response.end(JSON.stringify({ error: message }));
}

function safePath(target) {
  if (
    !target ||
    target.length > 8192 ||
    !target.startsWith("/") ||
    target.startsWith("//") ||
    target.includes("#")
  )
    return null;
  try {
    const path = decodeURIComponent(target.split("?", 1)[0]);
    if (
      /[\\%]/.test(path) ||
      [...path].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) ||
      path.includes("//") ||
      path.split("/").some((part) => part.startsWith("."))
    )
      return null;
    return path;
  } catch {
    return null;
  }
}

async function staticFile(root, path, request, response) {
  let candidate = resolve(root, `.${path === "/" ? "/index.html" : path}`);
  try {
    const info = await stat(candidate);
    if (!info.isFile()) return send(response, 404, "Not found");
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    if (extname(path) || !request.headers.accept?.includes("text/html"))
      return send(response, 404, "Not found");
    candidate = resolve(root, "index.html");
  }
  const actual = await realpath(candidate);
  const subpath = relative(root, actual);
  if (
    !subpath ||
    subpath.startsWith(`..${sep}`) ||
    isAbsolute(subpath) ||
    subpath.split(sep).some((part) => part.startsWith("."))
  )
    return send(response, 404, "Not found");
  const type = TYPES[extname(actual)];
  if (!type) return send(response, 404, "Not found");
  const file = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    // A client can disconnect during any filesystem await, before close listeners exist.
    if (response.destroyed) return;
    if (!info.isFile() || info.size > MAX_RESPONSE)
      return send(response, 404, "Not found");
    response.writeHead(200, {
      "Content-Type": type,
      "Content-Length": info.size,
    });
    if (request.method === "HEAD") return response.end();
    const stream = file.createReadStream({ autoClose: false });
    await new Promise((finish) => {
      stream.on("error", () => response.destroy());
      response.once("close", () => {
        stream.destroy();
        finish();
      });
      stream.pipe(response);
    });
  } finally {
    await file.close();
  }
}

function proxy(request, response, apiPort) {
  // Deliberate allowlist: no credentials, cookies, forwarded headers, or caller-selected destination.
  const headers = { host: `127.0.0.1:${apiPort}` };
  for (const name of [
    "accept",
    "content-type",
    "content-length",
    "x-pathsmith-client",
  ])
    if (request.headers[name] !== undefined)
      headers[name] = request.headers[name];
  const upstream = httpRequest({
    hostname: "127.0.0.1",
    port: apiPort,
    path: request.url,
    method: request.method,
    headers,
    agent: false,
  });
  let bytes = 0;
  const bounded = new Transform({
    transform(chunk, _encoding, next) {
      bytes += chunk.length;
      if (bytes > MAX_BODY) {
        send(response, 413, "Request too large");
        upstream.destroy();
        next(new Error("Request too large"));
      } else next(null, chunk);
    },
  });
  bounded.on("error", () => {
    request.unpipe(bounded);
    request.resume();
  });
  request.on("aborted", () => upstream.destroy());
  request.on("error", () => upstream.destroy());
  response.once("close", () => {
    upstream.destroy();
    bounded.destroy();
  });
  upstream.setTimeout(60_000, () => {
    send(response, 504, "API timeout");
    upstream.destroy();
  });
  upstream.on("error", () => send(response, 502, "API unavailable"));
  upstream.on("response", (incoming) => {
    const outgoing = {};
    for (const name of ["content-type", "content-length"])
      if (incoming.headers[name] !== undefined)
        outgoing[name] = incoming.headers[name];
    response.writeHead(incoming.statusCode ?? 502, outgoing);
    let received = 0;
    incoming.on("data", (chunk) => {
      received += chunk.length;
      if (received > MAX_RESPONSE) {
        incoming.destroy();
        response.destroy();
      }
    });
    incoming.on("error", () => response.destroy());
    incoming.pipe(response);
  });
  request.pipe(bounded).pipe(upstream);
}

export async function startHosted(options = {}) {
  const env = options.env ?? process.env;
  const config = readHostedConfiguration(env);
  // These programmatic overrides are useful for isolated tests; deployment always binds PORT on 0.0.0.0.
  const port = options.port ?? config.port;
  const host = options.host ?? "0.0.0.0";
  if (
    !["0.0.0.0", "127.0.0.1"].includes(host) ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535
  )
    throw new ConfigurationError("Invalid gateway listen address");
  let root;
  try {
    root = await realpath(
      options.webRoot ??
        fileURLToPath(new URL("../apps/web/dist", import.meta.url)),
    );
    const index = await realpath(resolve(root, "index.html"));
    if (dirname(index) !== root || !(await stat(index)).isFile())
      throw new Error();
  } catch {
    throw new ConfigurationError(
      "Built web assets are missing or invalid; run pnpm build",
    );
  }
  const app = await createApi({
    host: "127.0.0.1",
    port: 0,
    dataDir: options.dataDir ?? env.PATHSMITH_DATA_DIR,
    providerConfig: {
      enableLive: env.PATHSMITH_ENABLE_LIVE === "1",
      apiKey: env.TYPESAFE_API_KEY ?? "",
      defaultModel: env.TYPESAFE_MODEL ?? "jev-latest",
    },
  });
  const apiPort = Number(new URL(await app.getUrl()).port);
  const local = app.get(LocalApplication);
  let closing = false;
  let closePromise;
  let active = 0;
  let failures = 0;
  let failureWindow = Date.now();
  const server = createServer(
    { maxHeaderSize: 16 * 1024 },
    (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("X-Frame-Options", "DENY");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Strict-Transport-Security", "max-age=31536000");
      if (closing || active >= 128) return send(response, 503, "Unavailable");
      active++;
      response.once("close", () => active--);
      const counts = new Map();
      for (let i = 0; i < request.rawHeaders.length; i += 2) {
        const name = request.rawHeaders[i].toLowerCase();
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      if (
        ["host", "origin", "authorization", "x-pathsmith-client"].some(
          (name) => (counts.get(name) ?? 0) > 1,
        )
      )
        return send(response, 400, "Duplicate header");
      const path = safePath(request.url);
      if (!path) return send(response, 400, "Invalid request path");
      // Railway health probes may use their own Host, but only this exact, data-free endpoint is exempt.
      if (request.method === "GET" && request.url === "/healthz") {
        response.writeHead(local.storageFailed ? 503 : 200, {
          "Content-Type": "application/json",
        });
        response.end(
          JSON.stringify({
            status: local.storageFailed ? "unavailable" : "ready",
          }),
        );
        return;
      }
      if (request.headers.host !== config.host)
        return send(response, 403, "Host rejected");
      if (
        request.headers.origin !== undefined &&
        request.headers.origin !== config.origin
      )
        return send(response, 403, "Origin rejected");
      if (Date.now() - failureWindow >= 60_000) {
        failures = 0;
        failureWindow = Date.now();
      }
      // Global bounded admission: after 30 failures, do not verify further guesses this minute.
      if (failures >= 30) {
        response.setHeader("Retry-After", "60");
        return send(response, 429, "Too many authentication failures");
      }
      if (
        !authenticated(request.headers.authorization, config.credentialDigest)
      ) {
        failures++;
        response.setHeader(
          "WWW-Authenticate",
          'Basic realm="Pathsmith", charset="UTF-8"',
        );
        return send(response, 401, "Authentication required");
      }
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        request.headers["x-pathsmith-client"] !== "local"
      )
        return send(response, 403, "Mutation header required");
      if (Number(request.headers["content-length"] ?? 0) > MAX_BODY)
        return send(response, 413, "Request too large");
      if (path === "/api" || path.startsWith("/api/"))
        return proxy(request, response, apiPort);
      if (!["GET", "HEAD"].includes(request.method))
        return send(response, 405, "Method not allowed");
      staticFile(root, path, request, response).catch(() =>
        send(response, 404, "Not found"),
      );
    },
  );
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.maxConnections = 256;
  server.setTimeout(65_000, (socket) => socket.destroy());
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("connect", (_request, socket) => socket.destroy());
  try {
    await new Promise((done, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.removeListener("error", reject);
        done();
      });
    });
  } catch (error) {
    await app.close();
    throw error;
  }
  const close = () => {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      const timer = setTimeout(() => server.closeAllConnections(), 5_000);
      timer.unref();
      try {
        await new Promise((done) => server.close(done));
        await app.close();
      } finally {
        clearTimeout(timer);
      }
    })();
    return closePromise;
  };
  return { server, close };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const hosted = await startHosted();
    for (const signal of ["SIGTERM", "SIGINT"])
      process.once(signal, () =>
        hosted.close().catch(() => {
          process.exitCode = 1;
        }),
      );
    console.log("Pathsmith authenticated hosted gateway is ready");
  } catch (error) {
    console.error(
      error instanceof ConfigurationError
        ? error.message
        : "Pathsmith hosted startup failed; check assets, data directory, and port configuration",
    );
    process.exitCode = 1;
  }
}
