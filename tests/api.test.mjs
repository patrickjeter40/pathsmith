import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "../apps/api/dist/app.js";
test("Nest built API: local health, origin/host/mutation/body limits, sanitized errors", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "pathsmith-api-controls-"));
  const app = await createApi({
    port: 0,
    dataDir,
    providerConfig: { enableLive: false, apiKey: "" },
  });
  try {
    const url = await app.getUrl();
    let response = await fetch(`${url}/api/v1/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const health = await response.json();
    assert.equal(health.milestone, "M5");
    assert.equal(health.database.status, "ready");
    assert.equal(health.database.schemaVersion, 3);
    const hostile = await new Promise((resolve, reject) => {
      const req = request(
        `${url}/api/v1/health`,
        { headers: { Host: "evil.example" } },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode, body: JSON.parse(body) }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(hostile.status, 403);
    assert.equal(hostile.body.error.code, "HOST_REJECTED");
    response = await fetch(`${url}/api/v1/health`, {
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(response.status, 403);
    response = await fetch(`${url}/api/v1/health`, {
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    response = await fetch(`${url}/api/v1/health`, { method: "POST" });
    assert.equal(response.status, 403);
    assert.equal(
      (await response.json()).error.code,
      "MUTATION_HEADER_REQUIRED",
    );
    response = await fetch(`${url}/api/v1/health`, {
      method: "POST",
      headers: {
        "X-Pathsmith-Client": "local",
        "Content-Type": "application/json",
      },
      body: "{broken",
    });
    assert.equal(response.status, 400);
    response = await fetch(`${url}/api/v1/health`, {
      method: "POST",
      headers: {
        "X-Pathsmith-Client": "local",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: "x".repeat(512 * 1024) }),
    });
    assert.equal(response.status, 413);
    response = await fetch(`${url}/api/v1/providers/status`);
    const status = await response.json();
    assert.deepEqual(status.allowedModes, ["mock", "replay"]);
    assert(!JSON.stringify(status).includes("TYPESAFE_API_KEY"));
    response = await fetch(`${url}/api/v1/unknown`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: { code: "NOT_FOUND", message: "API route not found" },
    });
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
test("API refuses non-loopback binding", async () => {
  await assert.rejects(createApi({ host: "0.0.0.0", port: 0 }), /loopback/);
});
