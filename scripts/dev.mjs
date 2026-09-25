import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const vite = fileURLToPath(
  new URL("../apps/web/node_modules/vite/bin/vite.js", import.meta.url),
);
const envArgs = existsSync(".env") ? ["--env-file=.env"] : [];
const children = [
  spawn(process.execPath, [...envArgs, "apps/api/dist/main.js"], {
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    [vite, "--config", "apps/web/vite.config.ts", "apps/web"],
    { stdio: "inherit" },
  ),
];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
for (const child of children) {
  child.on("error", () => close(1));
  child.on("exit", (code) => close(code ?? 0));
}
