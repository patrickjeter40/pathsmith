import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

// Append migrations; historical snapshots are never rewritten.
const migrations = [
  {
    version: 1,
    statements: [
      `CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL)`,
      `CREATE TABLE projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), record TEXT NOT NULL, UNIQUE(workspace_id,id))`,
      ...["workflows", "suites"].map(
        (name) =>
          `CREATE TABLE ${name} (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 1), record TEXT NOT NULL, UNIQUE(workspace_id,project_id,id), FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id) ON DELETE CASCADE)`,
      ),
      ...[
        ["workflow_versions", "workflows"],
        ["suite_versions", "suites"],
      ].map(
        ([name, parent]) =>
          `CREATE TABLE ${name} (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, parent_id TEXT NOT NULL, record TEXT NOT NULL, UNIQUE(workspace_id,project_id,id), FOREIGN KEY(workspace_id,project_id,parent_id) REFERENCES ${parent}(workspace_id,project_id,id) ON DELETE CASCADE)`,
      ),
      `CREATE TABLE runs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, workflow_version_id TEXT NOT NULL, suite_version_id TEXT NOT NULL, source_run_id TEXT, status TEXT NOT NULL CHECK(status IN ('queued','running','canceling','completed','failed','canceled','interrupted')), created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, snapshot TEXT NOT NULL, report TEXT, error TEXT, UNIQUE(workspace_id,project_id,id), FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id) ON DELETE CASCADE, FOREIGN KEY(workspace_id,project_id,workflow_version_id) REFERENCES workflow_versions(workspace_id,project_id,id), FOREIGN KEY(workspace_id,project_id,suite_version_id) REFERENCES suite_versions(workspace_id,project_id,id), FOREIGN KEY(workspace_id,project_id,source_run_id) REFERENCES runs(workspace_id,project_id,id) ON DELETE RESTRICT)`,
      `CREATE TABLE scenario_runs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, run_id TEXT NOT NULL, scenario_id TEXT NOT NULL, position INTEGER NOT NULL, result TEXT NOT NULL, UNIQUE(run_id,scenario_id), FOREIGN KEY(workspace_id,project_id,run_id) REFERENCES runs(workspace_id,project_id,id) ON DELETE CASCADE)`,
      `CREATE TABLE node_traces (scenario_run_id TEXT NOT NULL REFERENCES scenario_runs(id) ON DELETE CASCADE, sequence INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(scenario_run_id,sequence))`,
      `CREATE TABLE provider_attempts (scenario_run_id TEXT NOT NULL REFERENCES scenario_runs(id) ON DELETE CASCADE, position INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(scenario_run_id,position))`,
      `CREATE INDEX runs_history ON runs(workspace_id,created_at)`,
      `CREATE INDEX scenarios_order ON scenario_runs(run_id,position)`,
      ...["workflow_versions", "suite_versions"].map(
        (name) =>
          `CREATE TRIGGER ${name}_immutable BEFORE UPDATE ON ${name} BEGIN SELECT RAISE(ABORT, 'Immutable version'); END`,
      ),
      `CREATE TRIGGER run_snapshot_immutable BEFORE UPDATE OF snapshot,workspace_id,project_id,workflow_version_id,suite_version_id,source_run_id,created_at ON runs BEGIN SELECT RAISE(ABORT, 'Immutable run snapshot'); END`,
    ],
  },
  {
    version: 2,
    statements: [
      // M2 stored successful logical exchanges here (including mocks), not HTTP attempts.
      // Preserve their payloads and historical snapshots without reinterpreting them.
      `ALTER TABLE provider_attempts RENAME TO provider_exchanges`,
      `CREATE TABLE provider_attempts (scenario_run_id TEXT NOT NULL REFERENCES scenario_runs(id) ON DELETE CASCADE, position INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(scenario_run_id,position))`,
    ],
  },
];

export function migrate(db: BetterSQLite3Database): number {
  db.run(
    sql`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
  );
  const applied = db
    .all<{ version: number }>(sql`SELECT version FROM schema_migrations`)
    .map((row) => row.version);
  if (
    applied.some(
      (version) => !migrations.some((item) => item.version === version),
    )
  )
    throw new Error("Database schema is newer than this application");
  for (const migration of migrations)
    if (!applied.includes(migration.version)) {
      db.transaction((tx) => {
        for (const statement of migration.statements)
          tx.run(sql.raw(statement));
        tx.run(
          sql`INSERT INTO schema_migrations VALUES (${migration.version},${new Date().toISOString()})`,
        );
      });
    }
  return migrations.at(-1)!.version;
}
