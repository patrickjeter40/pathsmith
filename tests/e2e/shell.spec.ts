import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "../../apps/api/dist/app.js";

let app: Awaited<ReturnType<typeof createApi>>;
let dataDir: string;
let apiUrl: string;
type Destination = "overview" | "testset" | "results" | "workflow" | "compare";

test.beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pathsmith-browser-"));
  app = await createApi({ port: 0, dataDir });
  apiUrl = new URL(await app.getUrl()).origin;
});
test.afterAll(async () => {
  await app?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});
async function openIsolated(page: Page, destination: Destination = "overview") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/**", async (route) => {
    const source = new URL(route.request().url());
    if (source.pathname === "/api/v1/runs" && route.request().method() === "POST" && JSON.parse(route.request().postData() ?? "{}").mode === "live") {
      await route.fulfill({ status: 599, json: { error: { code: "TEST_BLOCKED_LIVE", message: "Browser Live queue is blocked" } } });
      return;
    }
    const target = `${apiUrl}${source.pathname}${source.search}`;
    const response = await route.fetch({ url: target });
    await route.fulfill({ response });
  });
  await page.goto(`/#/${destination}`);
  await expect(page.locator(".shell-health")).toContainText("API ready");
  return errors;
}
async function visit(page: Page, destination: Destination) {
  await page.locator(".shell-nav:visible, .shell-mobile-nav:visible")
    .getByRole("button", { name: ({ overview: "Overview", testset: "Test set", results: "Results", workflow: "Workflow", compare: "Compare" } as const)[destination] })
    .click();
  await expect(({ overview: page.locator(".overview-start h1, .overview-screen h1"), testset: page.locator(".test-screen .screen-top h2, .screen-empty h2"), results: page.locator(".results-screen .screen-top h2"), workflow: page.locator(".workflow-title h2"), compare: page.locator(".compare-screen .screen-top h2") } as const)[destination]).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/${destination}$`));
}
async function createStarter(page: Page) {
  await page.getByRole("button", { name: "Create from starter" }).click();
  await expect(page.locator(".overview-screen h1")).toBeVisible();
}
async function runStarter(page: Page, full = false) {
  await visit(page, "testset");
  await page.locator(".step-bar").getByRole("button", { name: /Run/ }).click();
  if (full) await page.getByRole("button", { name: "Full published test set" }).click();
  await page.getByRole("button", { name: full ? "Run full set" : "Run sample", exact: true }).click();
  await expect(page.locator(".results-screen .screen-top h2")).toContainText("Results");
}
async function clickEditableNode(page: Page, id: string) {
  const canvas = page.locator(".workflow-editor-wrap .canvas");
  const node = page.locator(`.workflow-editor-wrap [data-canvas-node="${id}"]`).first();
  await expect(canvas).toHaveAttribute("data-fit-ready", "true");
  const [initialNode, initialCanvas] = await Promise.all([node.boundingBox(), canvas.boundingBox()]);
  if (!initialNode || !initialCanvas || initialNode.x + initialNode.width <= initialCanvas.x || initialNode.x >= initialCanvas.x + initialCanvas.width || initialNode.y + initialNode.height <= initialCanvas.y || initialNode.y >= initialCanvas.y + initialCanvas.height) {
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".editor-mobile-list button", { hasText: id }).click();
    await page.setViewportSize(viewport);
  }
  await expect(canvas).toHaveAttribute("data-fit-ready", "true");
  await expect.poll(async () => {
    const [item, area] = await Promise.all([node.boundingBox(), canvas.boundingBox()]);
    return !!item && !!area && Math.min(item.x + item.width, area.x + area.width) > Math.max(item.x, area.x) && Math.min(item.y + item.height, area.y + area.height) > Math.max(item.y, area.y);
  }).toBe(true);
  await node.click();
}
async function visitLegacy(page: Page, destination: Destination) {
  await visit(page, destination);
  const summary = destination === "overview" ? "Project and file tools" : destination === "testset" ? "Advanced test-set JSON and versions" : destination === "results" ? "Advanced run setup, exports and historical graph" : "";
  if (summary) {
    const details = page.locator("details", { has: page.getByText(summary, { exact: true }) }).first();
    if (await details.count() && await details.getAttribute("open") === null) await details.locator(":scope > summary").click();
  }
}
async function loadCheckedExample(page: Page, id: "gaming" | "support-baseline" = "gaming") {
  if (!new URL(page.url()).searchParams.has("project")) await createStarter(page);
  await visitLegacy(page, "overview");
  await page.getByLabel("Load another example").selectOption(id);
  await expect(page.locator(".overview-screen h1")).toContainText(id === "gaming" ? "Gaming" : "Support");
}
function currentProjectId(page: Page) { return new URL(page.url()).searchParams.get("project") ?? ""; }
async function selectProject(page: Page, id: string) {
  if (currentProjectId(page) === id) return;
  if (await page.locator(".overview-start").isVisible()) {
    await page.locator(".overview-start").getByLabel("Saved project", { exact: true }).selectOption(id);
    return;
  }
  const switcher = page.getByLabel("Switch project");
  if (!await switcher.isVisible()) await page.getByText("Project and file tools", { exact: true }).click();
  await switcher.selectOption(id);
}
async function queueAdvancedRun(page: Page, full: boolean) {
  const picker = page.getByLabel("Saved run");
  const previous = await picker.count() ? await picker.inputValue() : "";
  await page.getByRole("button", { name: full ? "Run full suite" : "Run selected case" }).click();
  await expect(page.locator(".test-run-grid")).toBeVisible();
  if (full) {
    await page.locator(".scope-options").getByRole("button", { name: /Full published test set/ }).click();
    await page.locator(".test-run-grid").getByRole("button", { name: "Run full set", exact: true }).click();
  } else await page.locator(".test-run-grid").getByRole("button", { name: /^Run \d+ selected cases$/ }).click();
  await expect(page.locator(".results-screen .screen-top h2")).toContainText("Results");
  await expect.poll(() => page.getByLabel("Saved run").inputValue()).not.toBe(previous);
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

test("phase1 destinations expose only their content and keep the URL in sync", async ({ page }) => {
  await openIsolated(page);
  await expect(page.locator(".overview-start")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start a local project" })).toBeVisible();
  for (const destination of ["testset", "results", "workflow", "compare", "overview"] as const) {
    await visit(page, destination);
    await expect(page.locator(".shell-nav:visible, .shell-mobile-nav:visible")
      .getByRole("button", { name: ({ overview: "Overview", testset: "Test set", results: "Results", workflow: "Workflow", compare: "Compare" } as const)[destination] }))
      .toHaveAttribute("aria-current", "page");
  }
  await page.goBack();
  await expect(page.locator(".compare-screen .screen-top h2")).toHaveText("Compare runs");
  await page.goto("/#/unknown");
  await expect(page.getByRole("heading", { name: "Start a local project" })).toBeVisible();
  await expect(page.locator("#workflow")).toBeHidden();
});

test("phase1 no-hash entry follows browser Back and Forward", async ({ page }) => {
  await openIsolated(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Start a local project" })).toBeVisible();
  await expect(page).toHaveURL("http://127.0.0.1:5173/#/overview");
  await visit(page, "testset");
  await page.goBack();
  await expect(page).toHaveURL("http://127.0.0.1:5173/#/overview");
  await expect(page.getByRole("heading", { name: "Start a local project" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Start a local project" })).toBeVisible();
});

test("phase1 Overview shows persisted project facts and keeps workflow draft across navigation", async ({ page }) => {
  await openIsolated(page);
  await expect(page.locator(".overview-start")).toContainText("Start a local project");
  await createStarter(page);
  await expect(page.locator(".overview-welcome")).toContainText("Examples");
  await visit(page, "workflow");
  await page.getByRole("tab", { name: "JSON" }).click();
  const editor = page.getByLabel("Workflow JSON", { exact: true });
  await editor.fill("{");
  await visit(page, "testset");
  await visit(page, "workflow");
  await expect(editor).toHaveValue("{");
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
});

test("phase1 light theme persists after reload", async ({ page }) => {
  await openIsolated(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("button", { name: "Switch to dark theme" })).toBeVisible();
});

test("phase1 desktop compact and mobile navigation remain usable", async ({ page }) => {
  const screenshots = "/workspace/attachments/pathsmith-implementation/phase1";
  await mkdir(screenshots, { recursive: true });
  for (const { width, height, layout } of [
    { width: 1440, height: 900, layout: "desktop" },
    { width: 1024, height: 768, layout: "compact" },
    { width: 390, height: 844, layout: "mobile" },
  ]) {
    await page.setViewportSize({ width, height });
    await openIsolated(page);
    const sidebar = page.locator(".shell-sidebar");
    const mobile = page.locator(".shell-mobile-nav");
    if (width <= 700) { await expect(sidebar).toBeHidden(); await expect(mobile).toBeVisible(); }
    else { await expect(sidebar).toBeVisible(); await expect(mobile).toBeHidden(); }
    await visit(page, "testset");
    await expect(page.locator(".test-screen .screen-top h2, .screen-empty h2")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await visit(page, "overview");
    await page.screenshot({ path: `${screenshots}/${layout}-dark.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await page.screenshot({ path: `${screenshots}/desktop-light.png`, fullPage: true });
});

test("phase1 mobile navigation returns to the heading from a long results page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openIsolated(page);
  await createStarter(page);
  await runStarter(page, true);
  await expect(page.locator(".results-screen .screen-top h2")).toContainText("Results", { timeout: 20000 });
  await page.getByText("Raw trace JSON").click();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await visit(page, "overview");
  await expect.poll(() => page.evaluate(() => {
    const heading = document.querySelector(".overview-screen h1")?.getBoundingClientRect();
    return !!heading && heading.top >= 0 && heading.bottom <= window.innerHeight;
  })).toBe(true);
  await page.screenshot({ path: "/workspace/attachments/pathsmith-implementation/phase1/mobile-after-results.png", fullPage: true });
});

test("phase1 light results show mock provenance and observed path", async ({ page }) => {
  await openIsolated(page);
  await createStarter(page);
  await runStarter(page);
  await expect(page.locator(".results-detail .trace-view")).toBeVisible();
  await expect(page.locator(".results-detail .saved-trace .saved-node").first()).toBeVisible();
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator(".results-head .mode-badge-mock")).toBeVisible();
  await page.screenshot({ path: "/workspace/attachments/pathsmith-implementation/phase1/results-light-observed.png", fullPage: true });
});

test("canonical gaming preview, import, and export", async ({ page }) => {
  const errors = await openIsolated(page);
  await loadCheckedExample(page);
  await visit(page, "workflow");
  await expect(page.locator(".workflow-title")).toContainText("Executable");
  await expect(page.locator(".workflow-editor-wrap .canvas")).toHaveAttribute("data-fit-ready", "true");
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.getByRole("tab", { name: "JSON" }).click();
  const canonical = JSON.parse(await page.getByLabel("Workflow JSON", { exact: true }).inputValue());
  expect(canonical.id).toBe("gaming_content_triage");
  expect(canonical.nodes).toHaveLength(10);
  await page.getByLabel("Workflow JSON", { exact: true }).fill("{");
  await expect(
    page.getByRole("button", { name: "Export", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Import workflow JSON")
    .setInputFiles("examples/support-routing/baseline.workflow.json");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
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
  await createStarter(page);
  await visit(page, "testset");
  await page.getByLabel("Import CSV or JSONL").setInputFiles({ name: "messages.csv", mimeType: "text/csv", buffer: Buffer.from('\uFEFFcontent,expected_label,source,tags\r\n"A quoted,\r\nmultiline message",abusive,generated,quoted|test\r\nFriendly game,not_abusive,human,friendly\r\n') });
  await expect(page.locator(".preview-list li")).toHaveCount(2);
  await expect(page.locator(".preview-list")).toContainText("A quoted,");
  await expect(page.locator(".preview-list")).toContainText("multiline message");
  await page.getByRole("button", { name: "Add 2 to draft" }).click();
  await expect(page.locator(".test-screen .screen-top p")).toContainText("10 examples");
  await page.locator(".step-bar").getByRole("button", { name: "Review labels" }).click();
  await expect(page.locator(".label-list li")).toHaveCount(10);
  await expect(page.locator(".label-list")).toContainText("provisional · generated");
  await page.locator(".step-bar").getByRole("button", { name: /Run/ }).click();
  await page.getByRole("button", { name: "Full published test set" }).click();
  await expect(page.locator(".test-run-grid")).toContainText("8 saved cases");
  await page.locator(".scope-options").getByRole("button", { name: /Run sample/ }).click();
  await page.getByLabel("Sample size").fill("4");
  await page.getByRole("button", { name: "Run sample", exact: true }).click();
  await expect(page.locator(".results-summary-joined")).toContainText("Reviewed agreement", { timeout: 20000 });
  await expect(page.locator(".review-groups")).toContainText("Missed positives");
  await expect(page.locator(".review-groups")).toContainText("False alarms");
  await expect(page.locator(".results-summary-joined")).toContainText("Unreviewed references");
  expect(errors).toEqual([]);
});

test("guided trace ignores a delayed response after another result is selected", async ({ page }) => {
  await openIsolated(page);
  await createStarter(page);
  await runStarter(page, true);
  await expect(page.locator(".results-head")).toBeVisible();
  await expect.poll(() => page.getByLabel("Saved run").inputValue()).not.toBe("");
  const runId = await page.getByLabel("Saved run").inputValue();
  const missed = await directApi<{ items: { scenarioId: string; traceId: string }[] }>(`/runs/${runId}/classification/rows?verdict=false_negative&limit=50`);
  const falseAlarms = await directApi<{ items: { scenarioId: string; traceId: string }[] }>(`/runs/${runId}/classification/rows?verdict=false_positive&limit=50`);
  expect(missed.items[0]?.traceId).toBeTruthy();
  expect(falseAlarms.items[0]?.traceId).toBeTruthy();
  await page.locator(".review-group", { hasText: "False alarms" }).locator(".review-preview").first().click();
  await expect(page.locator(".results-detail")).toContainText(falseAlarms.items[0].scenarioId);
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const started = new Promise<void>((resolve) => { firstStarted = resolve; });
  await page.route(`**/api/v1/scenario-runs/${missed.items[0].traceId}/trace`, async (route) => {
    const response = await route.fetch({ url: `${apiUrl}/api/v1/scenario-runs/${missed.items[0].traceId}/trace` });
    const record = await response.json() as { result: { events: unknown[] } };
    firstStarted(); await gate; await route.fulfill({ response, json: { ...record, result: { ...record.result, events: [...record.result.events, { kind: "test_marker", marker: "delayed-first" }] } } });
  });
  await page.route(`**/api/v1/scenario-runs/${falseAlarms.items[0].traceId}/trace`, async (route) => {
    const response = await route.fetch({ url: `${apiUrl}/api/v1/scenario-runs/${falseAlarms.items[0].traceId}/trace` });
    const record = await response.json() as { result: { events: unknown[] } };
    await route.fulfill({ response, json: { ...record, result: { ...record.result, events: [...record.result.events, { kind: "test_marker", marker: "current-second" }] } } });
  });
  await page.locator(".review-group", { hasText: "Missed positives" }).locator(".review-preview").first().click();
  await started;
  await page.locator(".review-group", { hasText: "False alarms" }).locator(".review-preview").first().click();
  await expect(page.locator(".results-detail")).toContainText(falseAlarms.items[0].scenarioId);
  const rawTrace = page.locator(".results-detail details", { hasText: "Raw trace JSON" }).locator("pre");
  await expect(rawTrace).toContainText("current-second");
  releaseFirst();
  await expect(rawTrace).toContainText("current-second");
  await expect(rawTrace).not.toContainText("delayed-first");
});

test("guided run waits for the reviewed test set to be published", async ({ page }) => {
  await openIsolated(page);
  await createStarter(page);
  await visitLegacy(page, "testset");
  await page.locator(".step-bar").getByRole("button", { name: /Run/ }).click();
  const action = page.getByRole("button", { name: "Run sample", exact: true });
  await expect(action).toBeEnabled();
  const originalVersion = (await page.locator(".run-facts").textContent())?.match(/Test set\s*([a-f0-9]{8})/)?.[1];
  expect(originalVersion).toBeTruthy();
  const input = page.getByLabel("Scenario input JSON");
  const value = JSON.parse(await input.inputValue());
  await input.fill(JSON.stringify({ ...value, content: "Changed message for draft" }));
  await input.blur();
  await expect(action).toBeDisabled();
  await page.getByRole("button", { name: "Save suite draft" }).click();
  await expect(page.locator(".test-screen .screen-top p")).toContainText("draft changes pending");
  await expect(page.locator(".run-facts")).toContainText(originalVersion!);
  await page.getByRole("button", { name: "Publish suite" }).click();
  await expect(page.locator(".run-facts")).not.toContainText(originalVersion!);
  await expect(action).toBeEnabled();
});

test("load, run, reopen history, and inspect saved trace", async ({ page }) => {
  const errors = await openIsolated(page);
  await loadCheckedExample(page);
  await expect(page.locator(".notice")).toContainText("Loaded Gaming as a persisted project.");
  expect(currentProjectId(page)).not.toBe("");
  const projectId = await currentProjectId(page);
  await visitLegacy(page, "testset");
  await expect(page.getByLabel("Scenario case")).toHaveValue("chat_abuse");
  await visitLegacy(page, "results");
  await queueAdvancedRun(page, false);
  await expect(page.locator(".run-details h3").first()).toContainText(
    "completed",
    { timeout: 15000 },
  );
  await expect(page.locator(".case-results button")).toContainText(
    "chat_abuse · completed · passed",
  );
  await page.locator(".case-results button").first().click();
  await expect(page.locator(".trace pre")).toContainText("assess_content");
  await visitLegacy(page, "testset");
  const originalInput = JSON.parse(
    await page.getByLabel("Scenario input JSON").inputValue(),
  );
  await page
    .getByLabel("Scenario input JSON")
    .fill(JSON.stringify({ ...originalInput, content: "A later draft edit" }));
  await page.getByLabel("Scenario input JSON").blur();
  await page.getByRole("button", { name: "Save suite draft" }).click();
  await expect(page.locator(".notice").filter({ hasText: /Suite draft saved at revision/ })).toBeVisible();
  await visitLegacy(page, "results");
  await page.getByText("Immutable workflow and suite snapshot").click();
  await expect(page.locator(".run-details details pre")).toContainText(
    originalInput.content,
  );
  await expect(page.locator(".run-details details pre")).not.toContainText(
    "A later draft edit",
  );
  const runId = (await page.locator(".history button").first().textContent())?.match(/[a-f0-9]{8}$/)?.[0];
  await app.close();
  app = await createApi({ port: 0, dataDir });
  apiUrl = new URL(await app.getUrl()).origin;
  await page.reload();
  await expect(page.locator(".shell-health")).toContainText("API ready");
  await visitLegacy(page, "overview");
  await selectProject(page, projectId);
  await visitLegacy(page, "results");
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
  await loadCheckedExample(page);
  const projectId = await currentProjectId(page);
  await visitLegacy(page, "testset");
  await expect(page.getByLabel("Scenario case")).toBeVisible();
  await page.getByText("Full suite JSON").click();
  for (const malformed of ['{"scenarios":{}}', '{"scenarios":[null]}']) {
    await page.getByLabel("Suite JSON").fill(malformed);
    await expect(page.getByRole("alert")).toContainText("Suite JSON needs a scenarios array");
    await expect(page.getByLabel("Suite JSON")).toHaveValue(malformed);
    await expect(page.getByRole("button", { name: "Publish suite" })).toBeDisabled();
  }
  await page.getByRole("button", { name: "Save suite draft" }).click();
  await expect(page.locator(".notice").filter({ hasText: /Suite draft saved at revision/ })).toBeVisible();
  await page.reload();
  await expect(page.locator(".shell-health")).toContainText("API ready");
  await visitLegacy(page, "overview");
  await selectProject(page, projectId);
  await visitLegacy(page, "testset");
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
  await selectProject(page, seeded.project.id);
  await visitLegacy(page, "results");
  await expect(page.locator(".history button")).toHaveCount(50);
  await page.getByRole("button", { name: /Load more runs/ }).click();
  await expect(page.locator(".history button")).toHaveCount(51);
  await expect(page.locator(".history button").last()).toContainText(earliest.id.slice(0, 8));
  await page.locator(".history button").last().click();
  await expect(page.locator(".run-details h3").first()).toContainText("completed", { timeout: 30000 });
  await expect(page.locator(".run-details")).toContainText("1 labeled · 100 unlabeled");
  await expect(page.locator(".case-results button")).toHaveCount(100);
  await page.locator("#runs").getByRole("button", { name: /Load more cases/ }).click();
  await expect(page.locator(".case-results button")).toHaveCount(101);
  await expect(page.locator(".case-results button").last()).toContainText("case_101");
});

test("a delayed trace cannot replace the newly selected case", async ({ page }) => {
  await openIsolated(page);
  await loadCheckedExample(page);
  await visitLegacy(page, "results");
  await queueAdvancedRun(page, true);
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
  await loadCheckedExample(page, "support-baseline");
  await visitLegacy(page, "results");
  await expect(page.getByLabel("Exact fixture set")).toHaveValue(
    "support-routing",
  );
  await visitLegacy(page, "testset");
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
  await expect(page.locator(".notice").filter({ hasText: /Suite draft saved at revision/ })).toBeVisible();
  await page.getByRole("button", { name: "Publish suite" }).click();
  await expect(page.locator(".notice").filter({ hasText: /Suite version .* published/ })).toBeVisible();
  await visitLegacy(page, "results");
  await queueAdvancedRun(page, false);
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
  await loadCheckedExample(page);
  expect(currentProjectId(page)).not.toBe("");
  const projectId = await currentProjectId(page);
  await visitLegacy(page, "testset");
  const second = await context.newPage();
  await openIsolated(second);
  await second.goto(`/?project=${projectId}#/testset`);
  await expect(second.locator(".shell-health")).toContainText("API ready");
  await visitLegacy(second, "testset");
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
  await expect(page.locator(".notice").filter({ hasText: /Suite draft saved at revision/ })).toBeVisible();
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
    page.getByRole("button", { name: "Create from starter" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("workflow authoring route stays open after reload", async ({ page }) => {
  await openIsolated(page, "workflow");
  await expect(page.getByRole("tab", { name: "JSON" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: "JSON" })).toBeVisible();
  await expect(page).toHaveURL(/#\/workflow$/);
});

test("branch threshold edit compares two regressions and one improvement", async ({ page }) => {
  const errors = await openIsolated(page);
  await loadCheckedExample(page, "support-baseline");
  await visitLegacy(page, "results");
  await queueAdvancedRun(page, true);
  await expect(page.locator(".results-head")).toContainText("Mock");
  const baselineId = await page.getByLabel("Saved run").inputValue();
  await visitLegacy(page, "workflow");
  await clickEditableNode(page, "confidence_gate");
  await expect(page.getByLabel("Case 1 literal value")).toHaveValue("0.7");
  await page.getByLabel("Case 1 literal value").fill("0.8");
  await expect(page.getByRole("button", { name: "Save version" })).toBeEnabled();
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.locator(".workflow-title")).toContainText("Executable");
  await visitLegacy(page, "results");
  await queueAdvancedRun(page, true);
  const candidateId = await page.getByLabel("Saved run").inputValue();
  expect(candidateId).not.toBe(baselineId);
  await visitLegacy(page, "compare");
  await page.getByLabel("Baseline run").selectOption(baselineId);
  await page.getByLabel("Candidate run").selectOption(candidateId);
  await expect(page.locator(".compare-gate-card")).toContainText("fail");
  await expect(page.locator(".compare-counts")).toContainText("New assertion regressions2");
  await expect(page.locator(".compare-counts")).toContainText("Assertion improvements1");
  await mkdir("/workspace/attachments/pathsmith-implementation/phase3b", { recursive: true });
  await page.screenshot({ path: "/workspace/attachments/pathsmith-implementation/phase3b/desktop-assertion-gate-fail.png", fullPage: true });
  await page.locator(".compare-table-wrap").getByRole("button", { name: "regression", exact: true }).click();
  await expect(page.locator(".compare-table tbody tr")).toHaveCount(2);
  await page.locator(".compare-table tbody tr").first().getByRole("button").first().click();
  await expect(page.locator(".compare-path-panel")).toContainText("First observed divergence:");
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const seen = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/api/v1/comparisons", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const source = new URL(route.request().url());
    const response = await route.fetch({ url: `${apiUrl}${source.pathname}` });
    if (body.policy?.strict) {
      const value = await response.json() as Record<string, unknown>;
      started(); await gate;
      await route.fulfill({ response, json: { ...value, gate: "pass", newAssertionRegressions: 999 } });
    } else await route.fulfill({ response });
  });
  const strict = page.getByRole("checkbox", { name: "Strict candidate gate" });
  await strict.check();
  await seen;
  await strict.uncheck();
  await expect(page.locator(".compare-gate-card")).toContainText("fail");
  release();
  await expect(page.locator(".compare-gate-card")).toContainText("fail");
  await expect(page.locator(".compare-counts")).toContainText("New assertion regressions2");
  await expect(page.locator(".compare-counts")).not.toContainText("999");
  expect(errors).toEqual([]);
});

test("saved recording replays a threshold change offline and survives restart", async ({ page }) => {
  const errors = await openIsolated(page);
  await loadCheckedExample(page, "support-baseline");
  const projectId = currentProjectId(page);
  await visitLegacy(page, "results");
  await queueAdvancedRun(page, true);
  const sourceId = await page.getByLabel("Saved run").inputValue();
  const source = await directApi<{ workflowVersionId: string; suiteVersionId: string }>(`/runs/${sourceId}`);
  await visitLegacy(page, "workflow");
  await clickEditableNode(page, "confidence_gate");
  await page.getByLabel("Case 1 literal value").fill("0.8");
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.locator(".workflow-title")).toContainText("Executable");
  await visitLegacy(page, "results");
  await page.getByLabel("Execution mode").selectOption("replay");
  await page.locator("#runs").getByLabel("Replay source run").selectOption(sourceId);
  await queueAdvancedRun(page, true);
  const firstCandidateId = await page.getByLabel("Saved run").inputValue();
  await expect(page.locator(".results-head")).toContainText("Replay");
  await visitLegacy(page, "compare");
  await page.getByLabel("Baseline run").selectOption(sourceId);
  await page.getByLabel("Candidate run").selectOption(firstCandidateId);
  await expect(page.locator(".compare-gate-card")).toContainText("inconclusive");
  await expect(page.locator(".compare-inconclusive")).toContainText("mode");
  await mkdir("/workspace/attachments/pathsmith-implementation/phase3b", { recursive: true });
  await page.screenshot({ path: "/workspace/attachments/pathsmith-implementation/phase3b/desktop-mode-inconclusive.png", fullPage: true });
  await page.getByRole("button", { name: /Run baseline workflow in replay/ }).click();
  await expect(page.locator(".test-run-grid")).toContainText("12 selected cases");
  await expect(page.locator(".run-facts")).toContainText(source.workflowVersionId.slice(0, 8));
  await expect(page.locator(".run-facts")).toContainText(source.suiteVersionId.slice(0, 8));
  await expect(page.locator(".test-run-grid").getByLabel("Replay source run")).toHaveValue(sourceId);
  await page.locator(".test-run-grid").getByRole("button", { name: /^Run \d+ selected cases$/ }).click();
  await expect(page.locator(".results-head")).toContainText("Results");
  await expect.poll(() => page.getByLabel("Saved run").inputValue()).not.toBe(firstCandidateId);
  const replayBaselineId = await page.getByLabel("Saved run").inputValue();
  await visitLegacy(page, "results");
  await page.getByLabel("Execution mode").selectOption("replay");
  await page.locator("#runs").getByLabel("Replay source run").selectOption(sourceId);
  await queueAdvancedRun(page, true);
  const replayCandidateId = await page.getByLabel("Saved run").inputValue();
  await visitLegacy(page, "compare");
  await page.getByLabel("Baseline run").selectOption(replayBaselineId);
  await page.getByLabel("Candidate run").selectOption(replayCandidateId);
  await expect(page.locator(".compare-gate-card")).toContainText("fail");
  await expect(page.locator(".compare-counts")).toContainText("New assertion regressions2");
  await expect(page.locator(".compare-counts")).toContainText("Assertion improvements1");
  await app.close();
  app = await createApi({ port: 0, dataDir });
  apiUrl = new URL(await app.getUrl()).origin;
  await page.reload();
  await expect(page.locator(".shell-health")).toContainText("API ready");
  await visitLegacy(page, "overview");
  await selectProject(page, projectId);
  await visitLegacy(page, "results");
  await page.getByLabel("Saved run").selectOption(replayCandidateId);
  await expect(page.locator(".run-details")).toContainText(`Recorded replay source: ${sourceId}`);
  await expect(page.locator(".run-details")).toContainText("0 current HTTP attempts");
  expect(errors).toEqual([]);
});

test("canceled partial history entry remains selectable as a replay source", async ({ page }) => {
  await openIsolated(page);
  await loadCheckedExample(page);
  await expect(page.locator(".notice").filter({ hasText: "Loaded Gaming as a persisted project." })).toBeVisible();
  const projectId = await currentProjectId(page);
  await visitLegacy(page, "results");
  await queueAdvancedRun(page, false);
  await expect(page.locator(".run-details h3").first()).toContainText("completed", { timeout: 20000 });
  const sourceId = await page.getByLabel("Saved run").inputValue();
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
  await visitLegacy(page, "overview");
  await selectProject(page, projectId);
  await visitLegacy(page, "results");
  await page.getByLabel("Execution mode").selectOption("replay");
  const choice = page.locator("#runs").getByLabel("Replay source run").locator(`option[value="${sourceId}"]`);
  await expect(choice).toContainText("canceled (partial: 1/2 saved)");
  await page.locator("#runs").getByLabel("Replay source run").selectOption(sourceId!);
  await queueAdvancedRun(page, false);
  await expect(page.locator(".run-details h3").first()).toContainText("completed", { timeout: 20000 });
  await expect(page.locator(".run-details")).toContainText(`Recorded replay source: ${sourceId}`);
});

test("live mode stays unavailable without server credentials and requires consent", async ({ page }) => {
  await openIsolated(page);
  await loadCheckedExample(page);
  const status = await directApi<{ providers: { id: string; configured: boolean }[] }>("/providers/status");
  expect(status.providers.find((item) => item.id === "jev")?.configured).toBe(false);
  await visit(page, "testset");
  await page.locator(".step-bar").getByRole("button", { name: /Run/ }).click();
  await page.getByRole("radio", { name: /Live/ }).click();
  const action = page.getByRole("button", { name: "Run sample", exact: true });
  const consent = page.getByLabel("I consent to the external requests shown above.");
  await expect(page.locator(".live-consent")).toContainText("Messages and workflow questions leave this computer");
  await expect(page.locator(".run-facts")).toContainText("Path bound");
  await expect(consent).toBeDisabled();
  await expect(action).toBeDisabled();
  expect(await page.content()).not.toContain("TYPESAFE_API_KEY");
  expect(JSON.stringify(status)).not.toContain("apiKey");
  await page.route("**/api/v1/providers/status", async (route) => {
    await route.fulfill({ json: { allowedModes: ["mock", "replay", "live"], defaultMode: "mock", defaultHttpAttemptLimit: 200, maximumHttpAttemptLimit: 2000,
      providers: [{ id: "mock", configured: true, defaultModel: "mock-v1" }, { id: "jev", configured: true, enabled: true, defaultModel: "jev-test" }] } });
  });
  await page.route("**/api/v1/runs/preflight", async (route) => {
    const input = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({ json: { selectedScenarioIds: input.selectedScenarioIds, mode: "live", providerModels: [{ binding: "decisions", providerId: "jev", model: "jev-test" }],
      maxJudgmentsPerCase: 1, maxProviderCalls: input.selectedScenarioIds.length, maxHttpAttempts: 24, attemptsPerCall: 3, concurrency: input.concurrency ?? 4,
      controls: { maxProviderCalls: input.selectedScenarioIds.length, stopAfterConsecutiveErrors: 5 }, httpAttemptLimit: input.httpAttemptLimit,
      workflowVersionId: input.workflowVersionId, suiteVersionId: input.suiteVersionId } });
  });
  await page.reload();
  await expect(page.locator(".shell-health")).toContainText("API ready");
  await visit(page, "testset");
  await page.locator(".step-bar").getByRole("button", { name: /Run/ }).click();
  await page.getByRole("radio", { name: /Live/ }).click();
  await expect(page.locator(".run-facts")).toContainText("jev-test");
  await expect(action).toBeDisabled();
  await consent.check();
  await expect(action).toBeEnabled();
  await page.getByRole("radio", { name: /Mock/ }).click();
  await page.getByRole("radio", { name: /Live/ }).click();
  await expect(consent).not.toBeChecked();
  await expect(action).toBeDisabled();
});

test("full run export requires sensitive data acknowledgement", async ({ page }) => {
  await openIsolated(page);
  await loadCheckedExample(page);
  await visitLegacy(page, "results");
  await queueAdvancedRun(page, false);
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
  await openIsolated(page, "workflow");
  await page.getByRole("button", { name: "Add node" }).click();
  await page.getByRole("tab", { name: /Problems/ }).click();
  await expect(page.locator(".workflow-problems li").first()).toBeVisible();
  await page.getByRole("button", { name: "Undo edit" }).click();
  await expect(page.getByRole("tab", { name: "Problems · 0" })).toBeVisible();
  await page.getByRole("button", { name: "Redo edit" }).click();
  await expect(page.locator(".workflow-problems li").first()).toBeVisible();
  await page.getByRole("tab", { name: "JSON" }).click();
  const json = JSON.parse(await page.getByLabel("Workflow JSON", { exact: true }).inputValue());
  expect(json.nodes).toHaveLength(11);
  expect(json.nodes.some((node: { id: string }) => node.id === "branch")).toBe(true);
});

test("malformed nested workflow JSON stays editable and cannot be exported", async ({ page }) => {
  const errors = await openIsolated(page, "workflow");
  await page.getByRole("tab", { name: "JSON" }).click();
  const editor = page.getByLabel("Workflow JSON", { exact: true });
  const original = JSON.parse(await editor.inputValue());
  const malformed = structuredClone(original);
  const branch = malformed.nodes.find((node: { kind: string }) => node.kind === "branch");
  branch.cases[0].when = null;
  const judgment = malformed.nodes.find((node: { kind: string }) => node.kind === "judgment");
  judgment.questions[Object.keys(judgment.questions)[0]].instructions = null;
  await editor.fill(JSON.stringify(malformed));
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: /Problems/ }).click();
  await expect(page.locator(".workflow-problems li").first()).toBeVisible();
  await page.getByRole("tab", { name: "JSON" }).click();
  await expect(editor).toHaveValue(JSON.stringify(malformed));
  await editor.fill(JSON.stringify(original));
  await expect(page.getByRole("tab", { name: "Problems · 0" })).toBeVisible();
  expect(JSON.parse(await editor.inputValue()).nodes).toHaveLength(original.nodes.length);
  expect(errors).toEqual([]);
});

test("branch case order and named port reconnection round-trip to JSON", async ({ page }) => {
  await openIsolated(page);
  await loadCheckedExample(page, "support-baseline");
  await visitLegacy(page, "workflow");
  await expect(page.locator('[data-canvas-node="department_router"]')).toBeAttached();
  await clickEditableNode(page, "department_router");
  const second = page.getByRole("group", { name: "Case 2" });
  await second.getByRole("button", { name: "Move up" }).click();
  await expect(page.getByLabel("Case 1 port ID")).toHaveValue("technical");
  await page.getByLabel("Default destination").selectOption("assess_request");
  await expect(page.getByRole("alert").filter({ hasText: "Invalid connection: cycles" })).toBeVisible();
  await page.getByLabel("Default destination").selectOption("out_sales");
  await expect(page.getByRole("alert").filter({ hasText: "Invalid connection: cycles" })).toHaveCount(0);
  await page.getByRole("tab", { name: "JSON" }).click();
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
  await selectProject(page, seeded.project.id);
  await visitLegacy(page, "results");
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
  await selectProject(page, seeded.project.id);
  await visitLegacy(page, "results");
  await page.locator(".history button").first().click();
  await expect(page.locator(".case-results button")).toHaveCount(1);
  await page.locator(".case-results button").first().click();
  await expect(page.locator(".historical-graph")).toContainText("Case did not start; no path was observed");
  await expect(page.locator(".historical-graph .react-flow__node", { hasText: "start" }).locator(".workflow-card")).toHaveClass(/path-unvisited/);
});

test("dragged layout persists without changing workflow semantic hash", async ({ page }) => {
  await openIsolated(page);
  await loadCheckedExample(page);
  expect(currentProjectId(page)).not.toBe("");
  const projectId = await currentProjectId(page);
  await visitLegacy(page, "workflow");
  const [draft] = await directApi<{ id: string }[]>(`/projects/${projectId}/workflows`);
  const versionsBefore = await directApi<{ workflowSemanticHash: string }[]>(`/workflows/${draft.id}/versions`);
  const node = page.locator('.workflow-editor-wrap .react-flow__node[data-id="start"]');
  await expect(page.locator(".workflow-editor-wrap .canvas")).toHaveAttribute("data-fit-ready", "true");
  await node.scrollIntoViewIfNeeded();
  const nodeBox = await node.boundingBox();
  const canvasBox = await page.locator(".workflow-editor-wrap .canvas").boundingBox();
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
  await page.locator("details.workflow-advanced summary").click();
  await expect(page.getByRole("button", { name: "Save draft only" })).toBeEnabled();
  await page.getByRole("button", { name: "Save draft only" }).click();
  const saved = await directApi<{ layout: { positions: Record<string, { x: number; y: number }> } }>(`/workflows/${draft.id}`);
  expect(saved.layout.positions.start).toBeDefined();
  await expect(page.getByRole("button", { name: "Save version" })).toBeDisabled();
  const versionsAfter = await directApi<{ workflowSemanticHash: string }[]>(`/workflows/${draft.id}/versions`);
  expect(versionsAfter).toHaveLength(versionsBefore.length);
  expect(versionsAfter[0].workflowSemanticHash).toBe(versionsBefore[0].workflowSemanticHash);
});
