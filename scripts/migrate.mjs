import { openStorage } from "../packages/storage/dist/index.js";
const storage = openStorage({ dataDir: process.env.PATHSMITH_DATA_DIR });
try {
  console.log(`SQLite schema version ${storage.schemaVersion} is ready.`);
} finally {
  storage.close();
}
