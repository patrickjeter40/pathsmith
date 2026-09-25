import { createApi } from "./app.js";
const app = await createApi();
console.log(
  `Pathsmith API: ${await app.getUrl()}/api/v1/health (M0–M1; no persistence yet)`,
);
process.once("SIGINT", () => void app.close());
process.once("SIGTERM", () => void app.close());
