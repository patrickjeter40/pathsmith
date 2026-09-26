# M2 local persistence decisions

- SQLite lives under `PATHSMITH_DATA_DIR` or `.pathsmith/`. Drizzle executes append-only numbered SQL migrations. A separate SQLite rollback-journal transaction holds an OS-released single-process lock for the data directory. Startup marks queued, running, and canceling jobs interrupted and never redispatches them.
- Every repository method takes a server-derived `WorkspaceContext`. Composite foreign keys bind related records to the same workspace and project. Browser requests accept opaque IDs, not workspace IDs or filesystem paths.
- The API exposes a fixed catalog of checked gaming and support examples and mock fixture sets. Loading is explicit; fixture IDs resolve server-side. Runs snapshot the selected workflow/suite versions, profile, limits, fixtures, and model/adapter metadata before dispatch. Exact mock matching is unchanged.
- The M2 browser uses JSON editing for scenario inputs and expectations. The server permits invalid drafts to remain editable, but publication and execution require shared-contract validation. Visual graph editing and comparison stay in M3.
- Run lists and scenario lists are paginated; full trace events and exchanges are fetched only for a selected scenario. Local data has no application-level encryption or automatic retention deletion.
