import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "../../apps/api/dist/app.js";

let app: Awaited<ReturnType<typeof createApi>>;
let dataDir: string;
let apiUrl: string;

test.beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pathsmith-browser-"));
  app = await createApi({ port: 0, dataDir });
  apiUrl = new URL(await app.getUrl()).origin;
});
test.afterAll(async () => {
  await app?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});
async function openIsolated(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/**", async (route) => {
    const source = new URL(route.request().url());
    const target = `${apiUrl}${source.pathname}${source.search}`;
    const response = await route.fetch({ url: target });
    await route.fulfill({ response });
  });
  await page.goto("/");
  await expect(page.locator(".sidebar-footer")).toContainText("API ready");
  if (await page.locator(".advanced").getAttribute("open") === null) await page.locator(".advanced > summary").click();
  return errors;
}
async function clickEditableNode(page: Page, id: string) {
  const canvas = page.locator(".workspace .canvas");
  const node = page.locator(".workspace .react-flow__node", { hasText: id }).first();
  await expect(canvas).toHaveAttribute("data-fit-ready", "true");
  await node.scrollIntoViewIfNeeded();
  await expect(canvas).toHaveAttribute("data-fit-ready", "true");
  await expect.poll(async () => {
    const [item, area] = await Promise.all([node.boundingBox(), canvas.boundingBox()]);
    return !!item && !!area && Math.min(item.x + item.width, area.x + area.width) > Math.max(item.x, area.x) && Math.min(item.y + item.height, area.y + area.height) > Math.max(item.y, area.y);
  }).toBe(true);
  await node.click();
}
async function directApi<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: method === "GET" ? undefined : { "Content-Type": "application/json", "X-Pathsmith-Client": "local" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(value));
  return value as T;
}
async function seedMinimal(caseCount: number, labeledCount: number) {
  const project = await directApi<{ id: string }>("/projects", "POST", { name: `Pagination ${caseCount} ${Date.now()}` });
  const workflow = await directApi<{ id: string; draftRevision: number }>(`/projects/${project.id}/workflows`, "POST", {
    name: "Minimal",
    definition: {
      formatVersion: "0.1", id: "minimal", name: "Minimal", description: "Minimal offline test", bindings: [],
      inputSchema: { type: "object", properties: { value: { type: "number" } }, required: ["value"], additionalProperties: false },
      outputSchema: { type: "number" },
      nodes: [{ id: "start", label: "Start", kind: "start" }, { id: "finish", label: "Finish", kind: "output", outcomeId: "done", value: { op: "ref", path: ["input", "value"] } }],
      edges: [{ id: "start_next", source: "start", port: "next", target: "finish" }],
    },
  });
  const workflowVersion = await directApi<{ id: string }>(`/workflows/${workflow.id}/versions`, "POST", { expectedRevision: workflow.draftRevision });
  const suite = await directApi<{ id: string; draftRevision: number }>(`/projects/${project.id}/suites`, "POST", {
    name: "Many cases",
    definition: {
      formatVersion: "0.1", id: "many_cases", name: "Many cases", description: "Pagination test cases",
      scenarios: Array.from({ length: caseCount }, (_, index) => ({
        id: `case_${index + 1}`, name: `Case ${index + 1}`, tags: [], input: { value: index + 1 },
        ...(index < labeledCount ? { expected: { allowedOutcomes: ["done"] } } : {}),
      })),
    },
  });
  const suiteVersion = await directApi<{ id: string }>(`/suites/${suite.id}/versions`, "POST", { expectedRevision: suite.draftRevision, workflowVersionId: workflowVersion.id });
  return { project, workflowVersion, suiteVersion };
}
async function queueMinimal(workflowVersionId: string, suiteVersionId: string, oneCase = false) {
  return directApi<{ id: string }>("/runs", "POST", { workflowVersionId, suiteVersionId, fixtureSetId: "gaming", mode: "mock", profile: { formatVersion: "0.1", bindings: {} }, ...(oneCase ? { selectedScenarioIds: ["case_1"] } : {}) });
}

test("canonical gaming preview, import, and export", async ({ page }) => {
  const errors = await openIsolated(page);
  await expect(
    page.getByRole("heading", { name: "Test how your classifier performs." }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Valid definition" }),
  ).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(10);
  await page.getByRole("button", { name: "JSON definition" }).click();
  expect(
    JSON.parse(
      await page.getByLabel("Workflow JSON", { exact: true }).inputValue(),
    ).id,
  ).toBe("gaming_content_triage");
  await page.getByLabel("Workflow JSON", { exact: true }).fill("{");
  await expect(
    page.getByRole("button", { name: "Export workflow" }),
  ).toBeDisabled();
  await page
    .getByLabel("Import workflow JSON")
    .setInputFiles("examples/support-routing/baseline.workflow.json");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workflow" }).click();
  const download = await downloadPromise;
  expect(JSON.parse(await readFile((await download.path())!, "utf8"))).toEqual(
    JSON.parse(
      await readFile("examples/support-routing/baseline.workflow.json", "utf8"),
    ),
  );
  expect(errors).toEqual([]);
});

test("guided classification imports CSV, reviews labels, and shows measured mock report", async ({ page }) => {
  const errors = await openIsolated(page);
  await page.getByRole("button", { name: "Start chat abuse example" }).click();
  await expect(page.getByRole("heading", { name: "Add messages" })).toBeVisible();
  await page.getByLabel("Import CSV").setInputFiles({ name: "messages.csv", mimeType: "text/csv", buffer: Buffer.from('\uFEFFcontent,expected_label,source,tags\r\n"A quoted,\r\nmultiline message",abusive,generated,quoted|test\r\nFriendly game,not_abusive,human,friendly\r\n') });
  await expect(page.getByText("Preview: 2 messages · 0 need attention")).toBeVisible();
  await page.getByRole("button", { name: "Add 2 to test set" }).click();
  await expect(page.getByText("10 messages. Generated answers remain provisional", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "3. Run test" }).click();
  await page.getByLabel("Test selection").selectOption("all");
  await expect(page.getByRole("button", { name: "Run 10 messages" })).toBeDisabled();
  await expect(page.getByRole("alert").filter({ hasText: "without mock fixtures" })).toBeVisible();
  await page.getByLabel("Test selection").selectOption("sample");
  await page.getByLabel("Sample size").fill("4");
  await page.getByRole("button", { name: "Run 4 messages" }).click();
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  await expect(page.locator(".guided .metric-grid")).toContainText("Missed abuse", { timeout: 20000 });
  await expect(page.locator(".guided .metric-grid")).toContainText("Harmless flagged");
  await expect(page.locator(".guided").getByRole("heading", { name: "Provisional labels" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("guided trace ignores a delayed response after another result is selected", async ({ page }) => {
  await openIsolated(page);
  await page.getByRole("button", { name: "Start chat abuse example" }).click();
  await page.getByRole("button", { name: "3. Run test" }).click();
  await page.getByRole("button", { name: "Run 8 messages" }).click();
  await expect(page.locator(".guided .metric-grid")).toContainText("Missed abuse", { timeout: 20000 });
  const runId = await page.getByLabel("Classification run").inputValue();
  const missed = await directApi<{ items: { traceId: string }[] }>(`/runs/${runId}/classification/rows?verdict=false_negative&limit=50`);
  const falseAlarms = await directApi<{ items: { traceId: string }[] }>(`/runs/${runId}/classification/rows?verdict=false_positive&limit=50`);
  expect(missed.items[0]?.traceId).toBeTruthy();
  expect(falseAlarms.items[0]?.traceId).toBeTruthy();
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const started = new Promise<void>((resolve) => { firstStarted = resolve; });
  await page.route(`**/api/v1/scenario-runs/${missed.items[0].traceId}/trace`, async (route) => {
    firstStarted(); await gate; await route.fulfill({ json: { marker: "delayed-first" } });
  });
  await page.route(`**/api/v1/scenario-runs/${falseAlarms.items[0].traceId}/trace`, async (route) => {
    await route.fulfill({ json: { marker: "current-second" } });
  });
  await page.locator(".guided .text-button").first().click();
  await started;
  await page.getByLabel("Result verdict").selectOption("false_positive");
  await expect(page.locator(".guided .text-button")).toHaveCount(1);
  await page.locator(".guided .text-button").first().click();
  await expect(page.locator(".guided .trace pre")).toContainText("current-second");
  releaseFirst();
  await expect(page.locator(".guided .trace pre")).toContainText("current-second");
  await expect(page.locator(".guided .trace pre")).not.toContainText("delayed-first");
});

test("guided run waits for the reviewed test set to be published", async ({ page }) => {
  await openIsolated(page);
  await page.getByRole("button", { name: "Start chat abuse example" }).click();
  await page.getByRole("button", { name: "3. Run test" }).click();
  await expect(page.getByRole("button", { name: "Run 8 messages" })).toBeEnabled();
  const input = page.getByLabel("Scenario input JSON");
  const value = JSON.parse(await input.inputValue());
  await input.fill(JSON.stringify({ ...value, content: "Changed message for draft" }));
  await input.blur();
  await expect(page.getByRole("button", { name: "Run 8 messages" })).toBeDisabled();
  await page.getByRole("button", { name: "Save suite draft" }).click();
  await expect(page.getByRole("button", { name: "Run 8 messages" })).toBeDisabled();
  await page.getByRole("button", { name: "Publish suite" }).click();
  await expect(page.getByRole("button", { name: "Run 8 messages" })).toBeEnabled();
});

test("load, run, reopen history, and inspect saved trace", async ({ page }) => {
  const errors = await openIsolated(page);
  await page.getByRole("button", { name: "Load checked example" }).click();
  await expect(
    page.getByText("Loaded Gaming as a persisted project."),
  ).toBeVisible();
  await expect(page.getByLabel("Saved project")).not.toHaveValue("");
  await expect(page.getByLabel("Scenario case")).toHaveValue("chat_abuse");
  await page.getByRole("button", { name: "Run selected case" }).click();
  await expect(page.locator(".run-details h3").first()).toContainText(
    "completed",
    { timeout: 15000 },
  );
  await expect(page.locator(".case-results button")).toContainText(
    "chat_abuse · completed · passed",
  );
  await page.locator(".case-results button").first().click();
  await expect(page.locator(".trace pre")).toContainText("assess_content");
  const originalInput = JSON.parse(
    await page.getByLabel("Scenario input JSON").inputValue(),
  );
  await page
    .getByLabel("Scenario input JSON")
    .fill(JSON.stringify({ ...originalInput, content: "A later draft edit" }));
  await page.getByLabel("Scenario input JSON").blur();
  await page.getByRole("button", { name: "Save suite draft" }).click();
  await expect(page.getByText(/Suite draft saved at revision/)).toBeVisible();
  await page.getByText("Immutable workflow and suite snapshot").click();
  await expect(page.locator(".run-details details pre")).toContainText(
    originalInput.content,
  );
  await expect(page.locator(".run-details details pre")).not.toContainText(
    "A later draft edit",
  );
  const projectId = await page.getByLabel("Saved project").inputValue();
  const runId = (await page.locator(".history button").first().textContent())?.match(/[a-f0-9]{8}$/)?.[0];
  await app.close();
  app = await createApi({ port: 0, dataDir });
  apiUrl = new URL(await app.getUrl()).origin;
  await page.reload();
  await expect(page.locator(".sidebar-footer")).toContainText("API ready");
  await page.getByLabel("Saved project").selectOption(projectId);
  await expect(page.locator(".history button")).toHaveCount(1);
  await expect(page.locator(".history button")).toContainText(runId!);
  await page.locator(".history button").click();
  await expect(page.locator(".case-results button")).toContainText(
    "chat_abuse · completed · passed",
  );
  await page.locator(".case-results button").first().click();
  await expect(page.locator(".trace pre")).toContainText("assess_content");
  expect(errors).toEqual([]);
});

test("malformed suite JSON remains editable and shows local diagnostics", async ({ page }) => {
  const errors = await openIsolated(page);
  await page.getByRole("button", { name: "Load checked example" }).click();
  await expect(page.getByLabel("Scenario case")).toBeVisible();
  await page.getByText("Full suite JSON").click();
  for (const malformed of ['{"scenarios":{}}', '{"scenarios":[null]}']) {
    await page.getByLabel("Suite JSON").fill(malformed);
    await expect(page.getByRole("alert")).toContainText("Suite JSON needs a scenarios array");
    await expect(page.getByLabel("Suite JSON")).toHaveValue(malformed);
    await expect(page.getByRole("button", { name: "Publish suite" })).toBeDisabled();
  }
  const projectId = await page.getByLabel("Saved project").inputValue();
  await page.getByRole("button", { name: "Save suite draft" }).click();
  await expect(page.getByText(/Suite draft saved at revision/)).toBeVisible();
  await page.reload();
  await expect(page.locator(".sidebar-footer")).toContainText("API ready");
  await page.getByLabel("Saved project").selectOption(projectId);
  await page.getByText("Full suite JSON").click();
  await expect(page.getByLabel("Suite JSON")).toHaveValue('{\n  "scenarios": [\n    null\n  ]\n}');
  await expect(page.getByRole("alert")).toContainText("Suite JSON needs a scenarios array");
  expect(errors).toEqual([]);
});

test("loads the 51st run and 101st case and distinguishes unlabeled cases", async ({ page }) => {
  const seeded = await seedMinimal(101, 1);
  const earliest = await queueMinimal(seeded.workflowVersion.id, seeded.suiteVersion.id);
  for (let index = 0; index < 50; index++) await queueMinimal(seeded.workflowVersion.id, seeded.suiteVersion.id, true);
  await openIsolated(page);
  await page.getByLabel("Saved project").selectOption(seeded.project.id);
  await expect(page.locator(".history button")).toHaveCount(50);
  await page.getByRole("button", { name: /Load more runs/ }).click();
  await expect(page.locator(".history button")).toHaveCount(51);
  await expect(page.locator(".history button").last()).toContainText(earliest.id.slice(0, 8));
  await page.locator(".history button").last().click();
  await expect(page.locator(".run-details h3").first()).toContainText("completed", { timeout: 30000 });
  await expect(page.locator(".run-details")).toContainText("1 labeled · 100 unlabeled");
  await expect(page.locator(".case-results button")).toHaveCount(100);
  await page.getByRole("button", { name: /Load more cases/ }).click();
  await expect(page.locator(".case-results button")).toHaveCount(101);
  await expect(page.locator(".case-results button").last()).toContainText("case_101");
});

test("a delayed trace cannot replace the newly selected case", async ({ page }) => {
  await openIsolated(page);
  await page.getByRole("button", { name: "Load checked example" }).click();
  await page.getByRole("button", { name: "Run full suite" }).click();
  await expect(page.locator(".run-details h3").first()).toContainText("completed", { timeout: 15000 });
  await expect(page.locator(".case-results button")).toHaveCount(9);
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let firstFulfilled!: () => void;
  const firstResponse = new Promise<void>((resolve) => { firstFulfilled = resolve; });
  let intercepted = 0;
  await page.route("**/api/v1/scenario-runs/*/trace", async (route) => {
    const order = ++intercepted;
    const source = new URL(route.request().url());
    const response = await route.fetch({ url: `${apiUrl}${source.pathname}` });
    if (order === 1) await firstGate;
    await route.fulfill({ response });
    if (order === 1) firstFulfilled();
  });
  const secondName = (await page.locator(".case-results button").nth(1).textContent())!.split(" · ")[0];
  await page.locator(".case-results button").nth(0).click();
  await page.locator(".case-results button").nth(1).click();
  await expect(page.locator(".trace pre")).toContainText(`"scenarioId": "${secondName}"`);
  releaseFirst();
  await firstResponse;
  await expect(page.locator(".trace pre")).toContainText(`"scenarioId": "${secondName}"`);
});

test("scenario edits publish as a new suite version and exact mock miss is visible", async ({
  page,
}) => {
  const errors = await openIsolated(page);
  await page.getByLabel("Example to load").selectOption("support-baseline");
  await page.getByRole("button", { name: "Load checked example" }).click();
  await expect(page.getByLabel("Exact fixture set")).toHaveValue(
    "support-routing",
  );
  const current = JSON.parse(
    await page.getByLabel("Scenario input JSON").inputValue(),
  );
  await page
    .getByLabel("Scenario input JSON")
    .fill(
      JSON.stringify({
        ...current,
        message: "An exact mock request that has no fixture",
      }),
    );
  await page.getByLabel("Scenario input JSON").blur();
  await page.getByRole("button", { name: "Save suite draft" }).click();
  await expect(page.getByText(/Suite draft saved at revision/)).toBeVisible();
  await page.getByRole("button", { name: "Publish suite" }).click();
  await expect(page.getByText(/Suite version .* published/)).toBeVisible();
  await page.getByRole("button", { name: "Run selected case" }).click();
  await expect(page.locator(".run-details h3").first()).toContainText(
    "failed",
    { timeout: 15000 },
  );
  await expect(page.locator(".case-results button")).toContainText("failed");
  await page.locator(".case-results button").first().click();
  await expect(page.locator(".trace pre")).toContainText(
    "MOCK_REQUEST_MISMATCH",
  );
  await page.getByRole("button", { name: "Cohort coverage" }).click();
  await expect(page.locator(".historical-graph")).toContainText("1 started");
  await expect(page.locator(".historical-graph")).toContainText("Partial cohort");
  expect(errors).toEqual([]);
});

test("stale suite save shows conflict and preserves local input", async ({
  page,
  context,
}) => {
  await openIsolated(page);
  await page.getByRole("button", { name: "Load checked example" }).click();
  await expect(page.getByLabel("Saved project")).not.toHaveValue("");
  const projectId = await page.getByLabel("Saved project").inputValue();
  const second = await context.newPage();
  await openIsolated(second);
  await second.getByLabel("Saved project").selectOption(projectId);
  await expect(second.getByLabel("Scenario input JSON")).toBeVisible();
  await expect(second.getByText("Draft revision 1 · saved")).toBeVisible();
  const firstInput = JSON.parse(
    await page.getByLabel("Scenario input JSON").inputValue(),
  );
  await page
    .getByLabel("Scenario input JSON")
    .fill(JSON.stringify({ ...firstInput, content: "First tab edit" }));
  await page.getByLabel("Scenario input JSON").blur();
  await page.getByRole("button", { name: "Save suite draft" }).click();
  await expect(page.getByText(/Suite draft saved at revision/)).toBeVisible();
  const secondInput = JSON.parse(
    await second.getByLabel("Scenario input JSON").inputValue(),
  );
  await second
    .getByLabel("Scenario input JSON")
    .fill(JSON.stringify({ ...secondInput, content: "Second tab local edit" }));
  await second.getByLabel("Scenario input JSON").blur();
  await second.getByRole("button", { name: "Save suite draft" }).click();
  await expect(second.getByRole("alert")).toContainText("Suite save conflict");
  expect(await second.getByLabel("Scenario input JSON").inputValue()).toContain(
    "Second tab local edit",
  );
});

test("small viewport keeps controls usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openIsolated(page);
  await expect(
    page.getByRole("button", { name: "Load checked example" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("Advanced workspace stays open after reload", async ({ page }) => {
  await openIsolated(page);
  await expect(page.locator(".advanced")).toHaveAttribute("open", "");
  await page.reload();
  await expect(page.locator(".advanced")).toHaveAttribute("open", "");
  await expect(page.getByLabel("Saved project", { exact: true })).toBeVisible();
});

test("branch threshold edit compares two regressions and one improvement", async ({ page }) => {
  const errors = await openIsolated(page);
  await page.getByLabel("Example to load").selectOption("support-baseline");
  await page.getByRole("button", { name: "Load checked example" }).click();
  await page.getByRole("button", { name: "Run full suite" }).click();
  await expect(page.locator(".run-details h3").first()).toContainText("completed", { timeout: 20000 });
  await expect(page.getByLabel("Baseline run").locator("option").nth(1)).toContainText("Support request routing");
  const baselineId = await page.getByLabel("Baseline run").locator("option").nth(1).getAttribute("value");
  await clickEditableNode(page, "confidence_gate");
  await expect(page.getByLabel("Case 1 literal value")).toHaveValue("0.7");
  await page.getByLabel("Case 1 literal value").fill("0.8");
  await page.getByRole("button", { name: "Save workflow draft" }).click();
  await expect(page.getByText(/Workflow draft saved at revision/)).toBeVisible();
  await page.getByRole("button", { name: "Publish workflow" }).click();
  await expect(page.getByText(/Workflow version .* published/)).toBeVisible();
  await page.getByRole("button", { name: "Run full suite" }).click();
  await expect(page.locator(".run-details h3").first()).toContainText("completed", { timeout: 20000 });
  await expect(page.getByLabel("Candidate run").locator("option").nth(1)).toContainText("Support request routing");
  const candidateId = await page.getByLabel("Candidate run").locator("option").nth(1).getAttribute("value");
  expect(candidateId).not.toBe(baselineId);
  await page.getByLabel("Baseline run").selectOption(baselineId!);
  await page.getByLabel("Candidate run").selectOption(candidateId!);
  await page.getByRole("button", { name: "Compare runs" }).click();
  await expect(page.locator(".comparison-report h3").first()).toContainText("Gate: fail");
  await expect(page.locator(".comparison-metrics")).toContainText("2 new assertion regressions");
  await expect(page.locator(".comparison-metrics")).toContainText("1 assertion improvements");
  await page.getByLabel("Comparison case filter").selectOption("regression");
  await expect(page.locator(".comparison-cases button")).toHaveCount(2);
  await page.locator(".comparison-cases button").first().click();
  await expect(page.locator(".case-comparison")).toContainText("First observed divergence:");
  await expect(page.locator(".case-comparison pre").first()).toContainText("scenarioId");
  await page.getByLabel("Strict gate: any candidate assertion failure fails").check();
  await expect(page.locator(".comparison-report")).toHaveCount(0);
  await page.getByRole("button", { name: "Compare runs" }).click();
  await expect(page.locator(".comparison-report")).toContainText(`Run IDs: ${baselineId} → ${candidateId} · Strict gate: true`);
  let releaseResponse!: () => void;
  let requestSeen!: () => void;
  let responseFulfilled!: () => void;
  const held = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const seen = new Promise<void>((resolve) => { requestSeen = resolve; });
  const fulfilled = new Promise<void>((resolve) => { responseFulfilled = resolve; });
  await page.route("**/api/v1/comparisons", async (route) => {
    const source = new URL(route.request().url());
    const response = await route.fetch({ url: `${apiUrl}${source.pathname}` });
    requestSeen();
    await held;
    await route.fulfill({ response });
    responseFulfilled();
  });
  await page.getByRole("button", { name: "Compare runs" }).click();
  await seen;
  await page.getByLabel("Strict gate: any candidate assertion failure fails").uncheck();
  releaseResponse();
  await fulfilled;
  await expect(page.locator(".comparison-report")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("saved recording replays a threshold change offline and survives restart", async ({ page }) => {
  const errors = await openIsolated(page);
  await page.getByLabel("Example to load").selectOption("support-baseline");
  await page.getByRole("button", { name: "Load checked example" }).click();
  await expect(page.getByText("Loaded Support routing — baseline as a persisted project.")).toBeVisible();
  const projectId = await page.getByLabel("Saved project").inputValue();
  await page.getByRole("button", { name: "Run full suite" }).click();
  await expect(page.locator(".run-details h3").first()).toContainText("completed", { timeout: 20000 });
  const sourceId = await page.getByLabel("Baseline run").locator("option").nth(1).getAttribute("value");
  expect(sourceId).toBeTruthy();
  await clickEditableNode(page, "confidence_gate");
  await page.getByLabel("Case 1 literal value").fill("0.8");
  await page.getByRole("button", { name: "Save workflow draft" }).click();
  await page.getByRole("button", { name: "Publish workflow" }).click();
  await expect(page.getByText(/Workflow version .* published/)).toBeVisible();
  await page.getByLabel("Execution mode").selectOption("replay");
  await page.getByLabel("Replay source run").selectOption(sourceId!);
  await expect(page.locator(".run-mode-panel")).toContainText("zero new provider requests");
  await page.getByRole("button", { name: "Run full suite" }).click();
  await expect(page.locator(".run-details h3").first()).toContainText("completed", { timeout: 20000 });
  await expect(page.locator(".run-details")).toContainText("0 current HTTP attempts");
  await expect(page.locator(".run-details")).toContainText("Recorded replay source:");
  const candidateId = await page.getByLabel("Candidate run").locator("option").nth(1).getAttribute("value");
  await page.getByLabel("Baseline run").selectOption(sourceId!);
  await page.getByLabel("Candidate run").selectOption(candidateId!);
  await page.getByRole("button", { name: "Compare runs" }).click();
  await expect(page.locator(".comparison-metrics")).toContainText("2 new assertion regressions");
  await expect(page.locator(".comparison-metrics")).toContainText("1 assertion improvements");
  await expect(page.locator(".comparison-report")).toContainText("Recorded Replay / synthetic");
  await page.reload();
  await expect(page.locator(".sidebar-footer")).toContainText("API ready");
  await page.getByLabel("Saved project").selectOption(projectId);
  await page.locator(".history button").filter({ hasText: candidateId!.slice(0, 8) }).click();
  await expect(page.locator(".run-details")).toContainText(`Recorded replay source: ${sourceId}`);
  await expect(page.locator(".run-details")).toContainText("0 current HTTP attempts");
  expect(errors).toEqual([]);
});

test("canceled partial history entry remains selectable as a replay source", async ({ page }) => {
  await openIsolated(page);
  await page.getByRole("button", { name: "Load checked example" }).click();
  await expect(page.getByText("Loaded Gaming as a persisted project.")).toBeVisible();
  const projectId = await page.getByLabel("Saved project").inputValue();
  await page.getByRole("button", { name: "Run selected case" }).click();
  await expect(page.locator(".run-details h3").first()).toContainText("completed", { timeout: 20000 });
  const sourceId = await page.getByLabel("Baseline run").locator("option").nth(1).getAttribute("value");
  expect(sourceId).toBeTruthy();
  // Alter only the history response to exercise the selector's canceled status.
  // The saved source report remains real and the replay request still reaches the API.
  await page.route("**/api/v1/runs?*", async (route) => {
    const source = new URL(route.request().url());
    const response = await route.fetch({ url: `${apiUrl}${source.pathname}${source.search}` });
    const pageData = await response.json() as { items: { id: string; status: string; progress: { persisted: number; selected: number } }[]; total: number };
    await route.fulfill({ response, json: {
      ...pageData,
      items: pageData.items.map((item) => item.id === sourceId ? { ...item, status: "canceled", progress: { ...item.progress, persisted: 1, selected: 2 } } : item),
    } });
  });
  await page.reload();
  await page.getByLabel("Saved project").selectOption(projectId);
  await page.getByLabel("Execution mode").selectOption("replay");
  const choice = page.getByLabel("Replay source run").locator(`option[value="${sourceId}"]`);
  await expect(choice).toContainText("canceled (partial: 1/2 saved)");
  await page.getByLabel("Replay source run").selectOption(sourceId!);
  await page.getByRole("button", { name: "Run selected case" }).click();
  await expect(page.locator(".run-details h3").first()).toContainText("completed", { timeout: 20000 });
  await expect(page.locator(".run-details")).toContainText(`Recorded replay source: ${sourceId}`);
});

test("live mode stays unavailable without server credentials and requires consent", async ({ page }) => {
  await openIsolated(page);
  await page.getByRole("button", { name: "Load checked example" }).click();
  await expect(page.getByText("Loaded Gaming as a persisted project.")).toBeVisible();
  const status = await directApi<{ providers: { id: string; configured: boolean; enabled?: boolean }[] }>("/providers/status");
  expect(status.providers.find((item) => item.id === "jev")?.configured).toBe(false);
  await page.getByLabel("Execution mode").selectOption("live");
  await expect(page.getByText("Live Jev preflight")).toBeVisible();
  await expect(page.locator(".live-preflight")).toContainText("Scenario state and question text leave this computer");
  await expect(page.locator(".live-preflight")).toContainText("Longest judgment path");
  await expect(page.getByRole("alert")).toContainText("Live mode is unavailable");
  await expect(page.getByLabel("Confirm live run")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Run full suite" })).toBeDisabled();
  const html = await page.content();
  expect(html).not.toContain("TYPESAFE_API_KEY");
  expect(JSON.stringify(status)).not.toContain("apiKey");
  await page.route("**/api/v1/providers/status", async (route) => {
    await route.fulfill({ json: {
      allowedModes: ["mock", "replay", "live"], defaultMode: "mock",
      defaultHttpAttemptLimit: 200, maximumHttpAttemptLimit: 2000,
      providers: [{ id: "mock", configured: true, defaultModel: "mock-v1" }, { id: "jev", configured: true, enabled: true, defaultModel: "jev-test" }],
    } });
  });
  const projectId = await page.getByLabel("Saved project").inputValue();
  await page.reload();
  await page.getByLabel("Saved project").selectOption(projectId);
  await page.getByLabel("Execution mode").selectOption("live");
  await expect(page.locator(".live-preflight")).toContainText("jev-test");
  await expect(page.getByRole("button", { name: "Run full suite" })).toBeDisabled();
  await page.getByLabel("Confirm live run").check();
  await expect(page.getByRole("button", { name: "Run full suite" })).toBeEnabled();
  await page.getByLabel("Execution mode").selectOption("mock");
  await page.getByLabel("Execution mode").selectOption("live");
  await expect(page.getByLabel("Confirm live run")).not.toBeChecked();
});

test("full run export requires sensitive data acknowledgement", async ({ page }) => {
  await openIsolated(page);
  await page.getByRole("button", { name: "Load checked example" }).click();
  await page.getByRole("button", { name: "Run selected case" }).click();
  await expect(page.locator(".run-details h3").first()).toContainText("completed", { timeout: 20000 });
  await expect(page.locator(".export-warning")).toContainText("scenario inputs, questions, model responses");
  await expect(page.getByRole("button", { name: "Export full run JSON" })).toBeDisabled();
  await page.getByLabel("Acknowledge sensitive run export").check();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export full run JSON" }).click();
  const download = await downloadPromise;
  const report = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(report.artifactType).toBe("pathsmith_run");
  expect(report.mode).toBe("mock");
  expect(report.scenarios).toHaveLength(1);
  expect(JSON.stringify(report)).not.toContain("TYPESAFE_API_KEY");
  await expect(page.getByRole("button", { name: "Export full run JSON" })).toBeDisabled();
});

test("new graph nodes remain editable while incomplete and undo restores canonical JSON", async ({ page }) => {
  await openIsolated(page);
  await page.getByRole("button", { name: "Add node" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(11);
  await expect(page.getByRole("status").filter({ hasText: "problem" })).toBeVisible();
  await page.getByRole("button", { name: "Undo edit" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(10);
  await page.getByRole("button", { name: "Redo edit" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(11);
  await page.getByRole("button", { name: "JSON definition" }).click();
  const json = JSON.parse(await page.getByLabel("Workflow JSON", { exact: true }).inputValue());
  expect(json.nodes.some((node: { id: string }) => node.id === "branch")).toBe(true);
});

test("malformed nested workflow JSON stays editable and cannot be exported", async ({ page }) => {
  const errors = await openIsolated(page);
  await page.getByRole("button", { name: "JSON definition" }).click();
  const editor = page.getByLabel("Workflow JSON", { exact: true });
  const original = JSON.parse(await editor.inputValue());
  const malformed = structuredClone(original);
  const branch = malformed.nodes.find((node: { kind: string }) => node.kind === "branch");
  branch.cases[0].when = null;
  const judgment = malformed.nodes.find((node: { kind: string }) => node.kind === "judgment");
  judgment.questions[Object.keys(judgment.questions)[0]].instructions = null;
  await editor.fill(JSON.stringify(malformed));
  await expect(page.getByRole("button", { name: "Export workflow" })).toBeDisabled();
  await page.getByRole("button", { name: "Graph editor" }).click();
  await expect(page.getByRole("button", { name: "Open JSON definition" })).toBeVisible();
  await page.getByRole("button", { name: "Open JSON definition" }).click();
  await expect(editor).toHaveValue(JSON.stringify(malformed));
  await editor.fill(JSON.stringify(original));
  await page.getByRole("button", { name: "Graph editor" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(original.nodes.length);
  expect(errors).toEqual([]);
});

test("branch case order and named port reconnection round-trip to JSON", async ({ page }) => {
  await openIsolated(page);
  await page.getByLabel("Example to load").selectOption("support-baseline");
  await page.getByRole("button", { name: "Load checked example" }).click();
  await expect(page.locator(".react-flow__node", { hasText: "department_router" })).toBeVisible();
  await clickEditableNode(page, "department_router");
  const second = page.getByRole("group", { name: "Case 2" });
  await second.getByRole("button", { name: "Move up" }).click();
  await expect(page.getByLabel("Case 1 port ID")).toHaveValue("technical");
  await page.getByLabel("Default destination").selectOption("assess_request");
  await expect(page.getByRole("alert").filter({ hasText: "Invalid connection: cycles" })).toBeVisible();
  await page.getByLabel("Default destination").selectOption("out_sales");
  await expect(page.getByRole("alert").filter({ hasText: "Invalid connection: cycles" })).toHaveCount(0);
  await page.getByRole("button", { name: "JSON definition" }).click();
  const definition = JSON.parse(await page.getByLabel("Workflow JSON", { exact: true }).inputValue());
  expect(definition.nodes.find((node: { id: string }) => node.id === "department_router").cases.map((item: { id: string }) => item.id)).toEqual(["technical", "billing", "sales"]);
  expect(definition.edges.find((edge: { source: string; port: string }) => edge.source === "department_router" && edge.port === "default").target).toBe("out_sales");
});

test("late coverage response cannot replace a different historical run", async ({ page }) => {
  const seeded = await seedMinimal(2, 1);
  const full = await queueMinimal(seeded.workflowVersion.id, seeded.suiteVersion.id);
  const single = await queueMinimal(seeded.workflowVersion.id, seeded.suiteVersion.id, true);
  await expect.poll(async () => (await directApi<{ status: string }>(`/runs/${full.id}`)).status).toBe("completed");
  await expect.poll(async () => (await directApi<{ status: string }>(`/runs/${single.id}`)).status).toBe("completed");
  await openIsolated(page);
  await page.getByLabel("Saved project").selectOption(seeded.project.id);
  await expect(page.locator(".history button")).toHaveCount(2);
  let release!: () => void;
  let intercepted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const seen = new Promise<void>((resolve) => { intercepted = resolve; });
  let count = 0;
  await page.route("**/api/v1/runs/*/coverage", async (route) => {
    const source = new URL(route.request().url());
    const response = await route.fetch({ url: `${apiUrl}${source.pathname}` });
    if (++count === 1) { intercepted(); await gate; }
    await route.fulfill({ response });
  });
  await page.locator(".history button").first().click();
  await seen;
  await page.locator(".history button").nth(1).click();
  await page.getByRole("button", { name: "Cohort coverage" }).click();
  await expect(page.locator(".historical-graph")).toContainText("2 started");
  release();
  await expect(page.locator(".historical-graph")).toContainText("2 started");
});

test("an unstarted case does not highlight the graph start node", async ({ page }) => {
  const seeded = await seedMinimal(1, 1);
  const run = await queueMinimal(seeded.workflowVersion.id, seeded.suiteVersion.id);
  await expect.poll(async () => (await directApi<{ status: string }>(`/runs/${run.id}`)).status).toBe("completed");
  await openIsolated(page);
  // Replace only the browser's case summary to exercise the unstarted display state.
  await page.route(`**/api/v1/runs/${run.id}/scenarios*`, async (route) => {
    const source = new URL(route.request().url());
    const response = await route.fetch({ url: `${apiUrl}${source.pathname}${source.search}` });
    const pageData = await response.json() as { items: { result: { started: boolean; visitedNodes: string[]; selectedEdges: string[] } }[] };
    await route.fulfill({ response, json: { ...pageData, items: pageData.items.map((item) => ({ ...item, result: { ...item.result, started: false, visitedNodes: [], selectedEdges: [] } })) } });
  });
  await page.getByLabel("Saved project").selectOption(seeded.project.id);
  await page.locator(".history button").first().click();
  await expect(page.locator(".case-results button")).toHaveCount(1);
  await page.locator(".case-results button").first().click();
  await expect(page.locator(".historical-graph")).toContainText("Case did not start; no path was observed");
  await expect(page.locator(".historical-graph .react-flow__node", { hasText: "start" }).locator(".workflow-card")).toHaveClass(/path-unvisited/);
});

test("dragged layout persists without changing workflow semantic hash", async ({ page }) => {
  await openIsolated(page);
  await page.getByRole("button", { name: "Load checked example" }).click();
  await expect(page.getByLabel("Saved project")).not.toHaveValue("");
  const projectId = await page.getByLabel("Saved project").inputValue();
  const [draft] = await directApi<{ id: string }[]>(`/projects/${projectId}/workflows`);
  const versionsBefore = await directApi<{ workflowSemanticHash: string }[]>(`/workflows/${draft.id}/versions`);
  const node = page.locator(".workspace .react-flow__node", { hasText: "start" }).first();
  await expect(page.locator(".workspace .canvas")).toHaveAttribute("data-fit-ready", "true");
  await node.scrollIntoViewIfNeeded();
  const nodeBox = await node.boundingBox();
  const canvasBox = await page.locator(".workspace .canvas").boundingBox();
  expect(nodeBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(Math.min(nodeBox!.x + nodeBox!.width, canvasBox!.x + canvasBox!.width) - Math.max(nodeBox!.x, canvasBox!.x)).toBeGreaterThan(0);
  expect(Math.min(nodeBox!.y + nodeBox!.height, canvasBox!.y + canvasBox!.height) - Math.max(nodeBox!.y, canvasBox!.y)).toBeGreaterThan(0);
  const dragHandle = node.locator(".workflow-card .kind");
  const box = await dragHandle.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 90, start.y + 70, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Save workflow draft" })).toBeEnabled();
  await page.getByRole("button", { name: "Save workflow draft" }).click();
  const saved = await directApi<{ layout: { positions: Record<string, { x: number; y: number }> } }>(`/workflows/${draft.id}`);
  expect(saved.layout.positions.start).toBeDefined();
  await page.getByRole("button", { name: "Publish workflow" }).click();
  const versionsAfter = await directApi<{ workflowSemanticHash: string }[]>(`/workflows/${draft.id}/versions`);
  expect(versionsAfter).toHaveLength(2);
  expect(versionsAfter[0].workflowSemanticHash).toBe(versionsBefore[0].workflowSemanticHash);
});
