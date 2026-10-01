import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveWebHost } from "../scripts/dev-host.mjs";

test("development web host stays on loopback outside Docker", () => {
  assert.equal(resolveWebHost(undefined, false), "127.0.0.1");
  assert.equal(resolveWebHost("127.0.0.1", false), "127.0.0.1");
  assert.throws(() => resolveWebHost("0.0.0.0", false));
  assert.throws(() => resolveWebHost("192.168.1.10", false));
});

test("Docker can use wildcard only for its web proxy", () => {
  assert.equal(resolveWebHost("0.0.0.0", true), "0.0.0.0");
  assert.throws(() => resolveWebHost("192.168.1.10", true));
});
