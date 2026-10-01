import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  readdir,
} from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { readHostedConfiguration, startHosted } from "../scripts/hosted.mjs";

const env = {
  PATHSMITH_PUBLIC_URL: "https://pathsmith.example",
  PATHSMITH_AUTH_USER: "owner",
  PATHSMITH_AUTH_PASSWORD: "offline-only-password-1234",
};
const authorization = `Basic ${Buffer.from(`${env.PATHSMITH_AUTH_USER}:${env.PATHSMITH_AUTH_PASSWORD}`).toString("base64")}`;

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), "pathsmith-hosted-"));
  const webRoot = join(directory, "dist");
  await mkdir(join(webRoot, "assets"), { recursive: true });
  await writeFile(
    join(webRoot, "index.html"),
    "<!doctype html><title>Pathsmith fixture</title>",
  );
  await writeFile(
    join(webRoot, "assets", "app.js"),
    "console.log('built asset')",
  );
  await writeFile(join(webRoot, ".env"), "private-marker");
  await writeFile(join(webRoot, "credentials.json"), "private-marker");
  await writeFile(join(directory, "outside.js"), "private-marker");
  await symlink(
    join(directory, "outside.js"),
    join(webRoot, "assets", "escape.js"),
  );
  await symlink(directory, join(webRoot, "escape"));
  const hosted = await startHosted({
    env,
    port: 0,
    host: "127.0.0.1",
    webRoot,
    dataDir: join(directory, "data"),
  });
  t.after(async () => {
    await hosted.close();
    await rm(directory, { recursive: true, force: true });
  });
  const port = hosted.server.address().port;
  const send = (path, options = {}) =>
    new Promise((done, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: options.method ?? "GET",
          headers: {
            Host: "pathsmith.example",
            ...(options.auth === false ? {} : { Authorization: authorization }),
            ...options.headers,
          },
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("error", reject);
          response.on("end", () =>
            done({
              status: response.statusCode,
              headers: response.headers,
              body,
            }),
          );
        },
      );
      req.on("error", reject);
      if (options.chunks) {
        for (const chunk of options.chunks) req.write(chunk);
        req.end();
      } else req.end(options.body);
    });
  const api = async (path, method = "GET", body) => {
    const result = await send(`/api/v1${path}`, {
      method,
      headers: {
        Origin: env.PATHSMITH_PUBLIC_URL,
        "X-Pathsmith-Client": "local",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(result.status >= 200 && result.status < 300, result.body);
    return JSON.parse(result.body);
  };
  return { ...hosted, send, api, directory, webRoot };
}

test("hosted configuration fails closed with sanitized errors", async () => {
  assert.equal(readHostedConfiguration(env).port, 8080);
  assert.equal(readHostedConfiguration({ ...env, PORT: "4317" }).port, 4317);
  for (const key of [
    "PATHSMITH_PUBLIC_URL",
    "PATHSMITH_AUTH_USER",
    "PATHSMITH_AUTH_PASSWORD",
  ]) {
    const input = { ...env };
    delete input[key];
    await assert.rejects(startHosted({ env: input }), new RegExp(key));
  }
  for (const origin of [
    "http://pathsmith.example",
    "https://pathsmith.example/",
    "https://pathsmith.example/path",
    "https://user:private-marker@pathsmith.example",
    "https://pathsmith.example?token=private-marker",
    "https://pathsmith.example#private-marker",
    "not-a-url-private-marker",
  ])
    assert.throws(
      () => readHostedConfiguration({ ...env, PATHSMITH_PUBLIC_URL: origin }),
      (error) => !error.message.includes("private-marker"),
    );
  for (const password of [
    "short",
    " ".repeat(16),
    "x".repeat(1025),
    "abcdefghijklmnop\n",
  ])
    assert.throws(
      () =>
        readHostedConfiguration({ ...env, PATHSMITH_AUTH_PASSWORD: password }),
      /PATHSMITH_AUTH_PASSWORD/,
    );
  for (const user of ["", "bad:name", "has space", "x".repeat(129)])
    assert.throws(
      () => readHostedConfiguration({ ...env, PATHSMITH_AUTH_USER: user }),
      /PATHSMITH_AUTH_USER/,
    );
  for (const port of ["0", "-1", "65536", "NaN", "1.5", " 8080"])
    assert.throws(
      () => readHostedConfiguration({ ...env, PORT: port }),
      /PORT/,
    );
  await assert.rejects(
    startHosted({ env, webRoot: "/does-not-exist-private-marker" }),
    (error) =>
      /Built web assets/.test(error.message) &&
      !error.message.includes("private-marker"),
  );
});

test("hosted frontend and API require authentication; health is minimal and narrowly exempt", async (t) => {
  const { send } = await setup(t);
  for (const path of [
    "/",
    "/assets/app.js",
    "/api/v1/projects",
    "/api/v1/health",
  ]) {
    const result = await send(path, { auth: false });
    assert.equal(result.status, 401);
    assert.match(result.headers["www-authenticate"], /^Basic /);
    assert.equal(result.headers["cache-control"], "no-store");
    assert.ok(!result.body.includes(env.PATHSMITH_AUTH_PASSWORD));
  }
  for (const value of [
    "Bearer nonsense",
    "Basic ???",
    `Basic ${Buffer.from("owner:wrong-password-1234").toString("base64")}`,
    `Basic ${Buffer.from("other:" + env.PATHSMITH_AUTH_PASSWORD).toString("base64")}`,
  ])
    assert.equal(
      (await send("/", { headers: { Authorization: value } })).status,
      401,
    );
  const healthy = await send("/healthz", {
    auth: false,
    headers: { Host: "healthcheck.railway.app" },
  });
  assert.equal(healthy.status, 200);
  assert.deepEqual(JSON.parse(healthy.body), { status: "ready" });
  for (const path of [
    "/healthz?anything",
    "/healthz/",
    "/api/v1/health",
    "/assets/app.js",
  ])
    assert.equal(
      (
        await send(path, {
          auth: false,
          headers: { Host: "healthcheck.railway.app" },
        })
      ).status,
      403,
    );
  assert.equal(
    (
      await send("/healthz", {
        method: "POST",
        auth: false,
        headers: { Host: "healthcheck.railway.app" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await send("/healthz", {
        method: "HEAD",
        auth: false,
        headers: { Host: "healthcheck.railway.app" },
      })
    ).status,
    403,
  );
});

test("hosted Host, original Origin, and mutation controls survive proxying", async (t) => {
  const { send } = await setup(t);
  for (const host of [
    "evil.example",
    "pathsmith.example.evil.test",
    "pathsmith.example:443",
    "127.0.0.1",
  ])
    assert.equal(
      (
        await send("/api/v1/health", {
          headers: { Host: host, "X-Forwarded-Host": "pathsmith.example" },
        })
      ).status,
      403,
    );
  for (const origin of [
    "https://evil.example",
    "null",
    "http://127.0.0.1:5173",
    "https://pathsmith.example.evil.test",
    "https://pathsmith.example/",
  ])
    assert.equal(
      (await send("/api/v1/health", { headers: { Origin: origin } })).status,
      403,
    );
  assert.equal(
    (
      await send("/api/v1/health", {
        headers: { Origin: [env.PATHSMITH_PUBLIC_URL, "https://evil.example"] },
      })
    ).status,
    400,
  );
  const valid = await send("/api/v1/health", {
    headers: {
      Origin: env.PATHSMITH_PUBLIC_URL,
      "X-Forwarded-Host": "evil.example",
      Cookie: "secret=private-marker",
      "Proxy-Authorization": "private-marker",
    },
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.headers["access-control-allow-origin"], undefined);
  for (const headers of [{}, { "X-Pathsmith-Client": "wrong" }])
    assert.equal(
      (await send("/api/v1/projects", { method: "POST", headers, body: "{}" }))
        .status,
      403,
    );
  assert.equal(
    (
      await send("/api/v1/projects", {
        method: "POST",
        headers: {
          "X-Pathsmith-Client": "local",
          Origin: "https://evil.example",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await send("/api/v1/projects", {
        method: "POST",
        headers: {
          "X-Pathsmith-Client": "local",
          "Content-Type": "application/json",
        },
        body: "{broken",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await send("/", {
        method: "POST",
        headers: { "X-Pathsmith-Client": "local" },
      })
    ).status,
    405,
  );
});

test("hosted serves built assets and safe SPA paths without filesystem escapes", async (t) => {
  const { send } = await setup(t);
  assert.match((await send("/")).body, /Pathsmith fixture/);
  const asset = await send("/assets/app.js");
  assert.equal(asset.status, 200);
  assert.match(asset.headers["content-type"], /javascript/);
  assert.equal((await send("/assets/app.js", { method: "HEAD" })).body, "");
  const spa = await send("/projects/example", {
    headers: { Accept: "text/html" },
  });
  assert.equal(spa.status, 200);
  assert.match(spa.body, /Pathsmith fixture/);
  for (const path of [
    "/.env",
    "/%2eenv",
    "/../outside.js",
    "/%2e%2e/outside.js",
    "/%252e%252e/outside.js",
    "/assets/..%2f..%2foutside.js",
    "/assets%5c..%5coutside.js",
    "//evil.example/",
    "http://evil.example/api/v1/projects",
    "/%00",
    "/%zz",
    "/credentials.json",
    "/assets/app.js.map",
    "/assets/escape.js",
    "/escape/outside.js",
    "/missing.js",
  ]) {
    const result = await send(path, { headers: { Accept: "text/html" } });
    assert.ok(
      result.status === 400 || result.status === 404,
      `${path}: ${result.status}`,
    );
    assert.ok(!result.body.includes("private-marker"));
  }
  assert.equal(
    (await send("/api/v1/unknown", { headers: { Accept: "text/html" } }))
      .status,
    404,
  );
});

test("authenticated hosted API persists a project and completes an exact mock run", async (t) => {
  const { api } = await setup(t);
  const providers = await api("/providers/status");
  assert.deepEqual(providers.allowedModes, ["mock", "replay"]);
  const project = await api("/projects", "POST", {
    name: "Hosted private workspace",
  });
  assert.equal(
    (await api(`/projects/${project.id}`)).name,
    "Hosted private workspace",
  );
  const example = await api("/examples/classification/load", "POST", {});
  const queued = await api("/runs", "POST", {
    workflowVersionId: example.workflowVersion.id,
    suiteVersionId: example.suiteVersion.id,
    fixtureSetId: "classification",
    mode: "mock",
  });
  let run;
  const deadline = Date.now() + 10_000;
  do {
    run = await api(`/runs/${queued.id}`);
    if (!["queued", "running", "canceling"].includes(run.status)) break;
    await delay(20);
  } while (Date.now() < deadline);
  assert.equal(run.status, "completed");
  const report = await api(`/runs/${queued.id}/classification`);
  assert.equal(report.summary.all.completed, 8);
  assert.equal(report.execution.actualHttpAttempts, 0);
});

test("hosted rejects oversized requests and stops checking credentials after the failure budget", async (t) => {
  const { send } = await setup(t);
  const headers = {
    "X-Pathsmith-Client": "local",
    "Content-Type": "application/json",
  };
  assert.equal(
    (
      await send("/api/v1/projects", {
        method: "POST",
        headers: { ...headers, "Content-Length": 10 * 1024 * 1024 },
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await send("/api/v1/projects", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "x".repeat(512 * 1024) }),
      })
    ).status,
    413,
  );
  for (let i = 0; i < 30; i++)
    assert.equal((await send("/", { auth: false })).status, 401);
  const limited = await send("/", { auth: false });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "60");
  assert.equal((await send("/")).status, 429);
  assert.equal((await send("/healthz", { auth: false })).status, 200);
});

test(
  "hosted closes static file descriptors when clients disconnect during filesystem work",
  { skip: process.platform !== "linux" },
  async (t) => {
    const { server, send } = await setup(t);
    const before = (await readdir("/proc/self/fd")).length;
    // The normal request listener starts asynchronous file lookup first; close before it resumes.
    const disconnect = (_request, response) => response.destroy();
    server.on("request", disconnect);
    for (let i = 0; i < 40; i++)
      await assert.rejects(send("/assets/app.js"), { code: "ECONNRESET" });
    server.removeListener("request", disconnect);
    await delay(100);
    const after = (await readdir("/proc/self/fd")).length;
    assert.ok(
      after <= before + 2,
      `File descriptors leaked: ${before} -> ${after}`,
    );
    assert.equal((await send("/assets/app.js")).status, 200);
  },
);

test("hosted closes idempotently, releases its port and cleans up failed startup", async (t) => {
  const instance = await setup(t);
  const port = instance.server.address().port;
  await assert.rejects(
    startHosted({
      env,
      port,
      host: "127.0.0.1",
      webRoot: instance.webRoot,
      dataDir: join(instance.directory, "other-data"),
    }),
    { code: "EADDRINUSE" },
  );
  await Promise.all([instance.close(), instance.close()]);
  assert.equal(instance.server.listening, false);
  const restarted = await startHosted({
    env,
    port,
    host: "127.0.0.1",
    webRoot: instance.webRoot,
    dataDir: join(instance.directory, "data"),
  });
  await restarted.close();
});
