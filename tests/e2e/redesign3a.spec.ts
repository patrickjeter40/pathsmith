import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "../../apps/api/dist/app.js";

let app: Awaited<ReturnType<typeof createApi>>;
let dataDir: string;
let apiUrl: string;

test.beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pathsmith-redesign3a-"));
  app = await createApi({ port: 0, dataDir });
  apiUrl = new URL(await app.getUrl()).origin;
});
test.afterAll(async () => {
  await app?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});
async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}/api/v1${path}`, {
    method, headers: method === "GET" ? undefined : { "Content-Type": "application/json", "X-Pathsmith-Client": "local" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(value));
  return value as T;
}
async function open(page: Page, intercept?: (route: Parameters<Parameters<Page["route"]>[1]>[0], url: URL) => Promise<boolean>) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (intercept && await intercept(route, url)) return;
    const response = await route.fetch({ url: `${apiUrl}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  await page.goto("/#/overview");
  await expect(page.locator(".shell-health")).toContainText("API ready");
}
async function starter(page: Page) {
  await page.getByRole("button", { name: "Create from starter" }).click();
  await expect(page.locator(".overview-screen h1")).toBeVisible();
}
async function destination(page: Page, label: "Overview" | "Test set" | "Results") {
  await page.locator(".shell-nav:visible, .shell-mobile-nav:visible").getByRole("button", { name: label }).click();
}
async function runStarter(page: Page) {
  await starter(page);
  await destination(page, "Test set");
  await page.locator(".step-bar").getByRole("button", { name: /Run/ }).click();
  await page.getByRole("button", { name: "Run sample", exact: true }).click();
  await expect(page.locator(".results-screen .screen-top h2")).toContainText("Results");
  await expect(page.locator(".results-summary-joined")).toContainText("Reviewed agreement");
}

test("Phase 3A reviewed review group filters only reviewed cases", async ({ page }) => {
  await open(page);
  await runStarter(page);
  const group = page.locator(".review-group-heading", { hasText: "Missed positives" });
  await expect(group).toBeVisible();
  await group.click();
  await expect(page.getByRole("button", { name: "Missed", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByText("Detailed filters").click();
  await expect(page.getByLabel("Result review")).toHaveValue("reviewed");
});

test("Phase 3A invalid live call cap stays editable until corrected", async ({ page }) => {
  let livePostCount = 0;
  await open(page, async (route, url) => {
    if (url.pathname === "/api/v1/providers/status") {
      await route.fulfill({ json: { allowedModes: ["mock", "replay", "live"], defaultMode: "mock", defaultHttpAttemptLimit: 200,
        maximumHttpAttemptLimit: 30000, providers: [{ id: "mock", configured: true, defaultModel: "mock-v1" },
          { id: "jev", configured: true, enabled: true, defaultModel: "jev-offline" }] } }); return true;
    }
    if (url.pathname === "/api/v1/runs/preflight") {
      const input = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({ json: { selectedScenarioIds: input.selectedScenarioIds, mode: "live", providerModels: [{ binding: "decisions", providerId: "jev", model: "jev-offline" }],
        maxJudgmentsPerCase: 1, maxProviderCalls: input.selectedScenarioIds.length,
        maxHttpAttempts: 24, attemptsPerCall: 3, concurrency: input.concurrency ?? 4,
        controls: { maxProviderCalls: input.selectedScenarioIds.length, stopAfterConsecutiveErrors: 5 },
        httpAttemptLimit: input.httpAttemptLimit, workflowVersionId: input.workflowVersionId, suiteVersionId: input.suiteVersionId } });
      return true;
    }
    if (url.pathname === "/api/v1/runs" && route.request().method() === "POST") {
      livePostCount++;
      await route.fulfill({ status: 599, json: { error: { code: "TEST_BLOCKED_LIVE", message: "Live request intercepted" } } });
      return true;
    }
    return false;
  });
  await starter(page);
  await destination(page, "Test set");
  await page.locator(".step-bar").getByRole("button", { name: /Run/ }).click();
  await page.getByRole("radio", { name: /Live/ }).click();
  await expect(page.getByLabel("Max provider calls")).toBeVisible();
  const capMaximum = Number(await page.getByLabel("Max provider calls").getAttribute("max"));
  expect(capMaximum).toBeGreaterThan(1);
  await page.getByLabel("I consent to the external requests shown above.").check();
  await page.getByLabel("Max provider calls").fill("0");
  await expect(page.getByRole("alert").filter({ hasText: "Provider call cap must be" })).toBeVisible();
  await expect(page.getByLabel("Max provider calls")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run sample", exact: true })).toBeDisabled();
  await expect(page.getByLabel("I consent to the external requests shown above.")).not.toBeChecked();
  await page.getByLabel("Max provider calls").fill("1");
  await expect(page.getByLabel("Max provider calls")).toHaveValue("1");
  await page.getByLabel("Max provider calls").fill(String(capMaximum));
  await expect(page.getByLabel("Max provider calls")).toHaveValue(String(capMaximum));
  expect(livePostCount).toBe(0);
});

test("Phase 3A safe invalid imported classification input stays reviewable", async ({ page }) => {
  const loaded = await request<{ project: { id: string } }>("/examples/classification/load", "POST");
  const bundle = await request<{ name: string; suites: { definition: { scenarios: { input: unknown }[] } }[] }>(`/projects/${loaded.project.id}/export`);
  bundle.name = "Invalid input draft";
  bundle.suites[0].definition.scenarios[0].input = null;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await page.locator(".overview-start input[type=file]").setInputFiles({ name: "invalid-project.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bundle)) });
  await expect(page.locator(".overview-screen h1")).toHaveText("Invalid input draft");
  await destination(page, "Test set");
  await page.locator(".step-bar").getByRole("button", { name: "Review labels" }).click();
  await expect(page.locator(".label-list")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Phase 3A delayed project A label save cannot replace project B draft", async ({ page }) => {
  const a = await request<{ project: { id: string }; suiteVersion: { suiteId: string } }>("/examples/classification/load", "POST");
  const b = await request<{ project: { id: string } }>("/examples/classification/load", "POST");
  const suite = await request<{ definition: { scenarios: { id: string; referenceLabel: { value: string } }[] } }>(`/suites/${a.suiteVersion.suiteId}`);
  const first = suite.definition.scenarios[0];
  const changed = first.referenceLabel.value === "abusive" ? "not_abusive" : "abusive";
  let release!: () => void;
  let started!: () => void;
  let finished!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const seen = new Promise<void>((resolve) => { started = resolve; });
  const fulfilled = new Promise<void>((resolve) => { finished = resolve; });
  await open(page, async (route, url) => {
    if (url.pathname === `/api/v1/suites/${a.suiteVersion.suiteId}/draft` && route.request().method() === "PUT") {
      started(); await gate;
      const response = await route.fetch({ url: `${apiUrl}${url.pathname}` });
      await route.fulfill({ response }); finished(); return true;
    }
    return false;
  });
  await page.locator(".overview-start").getByLabel("Saved project").selectOption(a.project.id);
  await expect(page.locator(".overview-screen h1")).toBeVisible();
  await destination(page, "Test set");
  await page.locator(".step-bar").getByRole("button", { name: "Review labels" }).click();
  await page.getByLabel(`Expected answer for ${first.id}`).selectOption(changed);
  await page.getByRole("button", { name: "Save 1 label changes" }).click();
  await seen;
  await destination(page, "Overview");
  await page.getByText("Project and file tools").click();
  await page.locator(".overview-project-tools").getByLabel("Switch project").selectOption(b.project.id);
  await expect(page.locator(".overview-project-tools").getByLabel("Switch project")).toHaveValue(b.project.id);
  await destination(page, "Test set");
  await page.locator(".step-bar").getByRole("button", { name: "Review labels" }).click();
  await expect(page.getByLabel(`Expected answer for ${first.id}`)).toHaveValue(first.referenceLabel.value);
  release();
  await fulfilled;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByLabel(`Expected answer for ${first.id}`)).toHaveValue(first.referenceLabel.value);
  await expect(page.getByText("1 reference changes saved to the draft.", { exact: false })).toHaveCount(0);
});

test("Phase 3A pending project switch gates old live setup and mutations", async ({ page }) => {
  const a = await request<{ project: { id: string } }>("/examples/classification/load", "POST");
  const b = await request<{ project: { id: string } }>("/examples/classification/load", "POST");
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const seen = new Promise<void>((resolve) => { started = resolve; });
  const mutations: string[] = [];
  await open(page, async (route, url) => {
    if (url.pathname === "/api/v1/providers/status") {
      await route.fulfill({ json: { allowedModes: ["mock", "replay", "live"], defaultMode: "mock", defaultHttpAttemptLimit: 200,
        maximumHttpAttemptLimit: 30000, providers: [{ id: "mock", configured: true, defaultModel: "mock-v1" },
          { id: "jev", configured: true, enabled: true, defaultModel: "jev-offline" }] } }); return true;
    }
    if (url.pathname === "/api/v1/runs/preflight") {
      const input = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({ json: { selectedScenarioIds: input.selectedScenarioIds, mode: "live", providerModels: [{ binding: "decisions", providerId: "jev", model: "jev-offline" }],
        maxJudgmentsPerCase: 1, maxProviderCalls: input.selectedScenarioIds.length, maxHttpAttempts: 24, attemptsPerCall: 3,
        controls: { maxProviderCalls: input.selectedScenarioIds.length, stopAfterConsecutiveErrors: 5 },
        concurrency: input.concurrency ?? 4, httpAttemptLimit: input.httpAttemptLimit, workflowVersionId: input.workflowVersionId, suiteVersionId: input.suiteVersionId } });
      return true;
    }
    if (url.pathname === `/api/v1/projects/${b.project.id}/workflows` && route.request().method() === "GET") {
      started(); await gate;
      const response = await route.fetch({ url: `${apiUrl}${url.pathname}` });
      await route.fulfill({ response }); return true;
    }
    if (route.request().method() !== "GET" && url.pathname !== "/api/v1/runs/preflight") {
      mutations.push(`${route.request().method()} ${url.pathname}`);
      await route.fulfill({ status: 599, json: { error: { code: "TEST_BLOCKED_MUTATION", message: "Blocked while switching projects" } } });
      return true;
    }
    return false;
  });
  await page.locator(".overview-start").getByLabel("Saved project").selectOption(a.project.id);
  await expect(page.locator(".overview-screen h1")).toBeVisible();
  await destination(page, "Test set");
  await page.locator(".step-bar").getByRole("button", { name: /Run/ }).click();
  await page.getByRole("radio", { name: /Live/ }).click();
  const consent = page.getByLabel("I consent to the external requests shown above.");
  await expect(consent).toBeEnabled();
  await consent.check();
  await expect(page.getByRole("button", { name: "Run sample", exact: true })).toBeEnabled();
  await page.getByText("Advanced test-set JSON and versions").click();
  await expect(page.getByRole("button", { name: "Publish suite", exact: true })).toBeVisible();
  await destination(page, "Overview");
  await page.getByText("Project and file tools").click();
  await page.locator(".overview-project-tools").getByLabel("Switch project").selectOption(b.project.id);
  await seen;
  try {
    await destination(page, "Test set");
    await expect(page.locator(".test-owner-gate")).toHaveCount(2);
    await expect(page.locator(".test-owner-gate").first()).toHaveAttribute("disabled", "");
    await expect(page.locator(".test-owner-gate").nth(1)).toHaveAttribute("disabled", "");
    await expect(page.getByRole("button", { name: "Run sample", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save suite draft", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Publish suite", exact: true })).toBeDisabled();
    await expect(consent).not.toBeChecked();
    await page.getByRole("button", { name: "Run sample", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    await page.getByRole("button", { name: "Save suite draft", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    await page.getByRole("button", { name: "Publish suite", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    expect(mutations).toEqual([]);
  } finally { release(); }
  await expect(page.locator(".test-owner-gate").first()).not.toHaveAttribute("disabled", "");
  await page.locator(".step-bar").getByRole("button", { name: /Run/ }).click();
  await expect(consent).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Run sample", exact: true })).toBeDisabled();
  expect(mutations).toEqual([]);
});

test("Phase 3A Overview Test set and Results remain usable at three widths in both themes", async ({ page }) => {
  const screenshots = "/workspace/attachments/pathsmith-implementation/phase3a";
  await mkdir(screenshots, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await runStarter(page);
  for (const { width, height, layout } of [
    { width: 1440, height: 900, layout: "desktop" },
    { width: 1024, height: 768, layout: "compact" },
    { width: 390, height: 844, layout: "mobile" },
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ["dark", "light"] as const) {
      const current = await page.locator("html").getAttribute("data-theme");
      if (current !== theme) await page.getByRole("button", { name: `Switch to ${theme} theme` }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const [screen, heading] of [["Overview", ".overview-screen h1"], ["Test set", ".test-screen .screen-top h2"], ["Results", ".results-screen .screen-top h2"]] as const) {
        await destination(page, screen);
        await expect(page.locator(heading)).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: `${screenshots}/${layout}-${theme}-${screen.toLowerCase().replace(" ", "-")}.png`, fullPage: true });
        if (screen === "Test set" && (width === 1440 || width === 390)) {
          await page.locator(".step-bar").getByRole("button", { name: "Review labels" }).click();
          await expect(page.locator(".label-list")).toBeVisible();
          await page.screenshot({ path: `${screenshots}/${layout}-${theme}-review-labels.png`, fullPage: true });
          await page.locator(".step-bar").getByRole("button", { name: /Run/ }).click();
        }
      }
    }
  }
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await destination(page, "Test set");
  await page.locator(".step-bar").getByRole("button", { name: "Examples" }).click();
  await page.getByLabel("Import CSV or JSONL").setInputFiles({ name: "visual-preview.csv", mimeType: "text/csv", buffer: Buffer.from("content,expected_label,source,tags\nVisual preview case,abusive,human,visual\n") });
  await expect(page.locator(".preview-list li")).toHaveCount(1);
  for (const { width, height, layout } of [{ width: 1440, height: 900, layout: "desktop" }, { width: 390, height: 844, layout: "mobile" }]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${screenshots}/${layout}-dark-csv-preview.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});

test("Phase 3A published label edits rescore the original run without new execution", async ({ page }) => {
  await open(page);
  await runStarter(page);
  const runId = await page.getByLabel("Saved run").inputValue();
  const original = await request<{ items: { scenarioId: string; referenceLabel: { value: string }; predictedLabel: string; traceId: string }[] }>(`/runs/${runId}/classification/rows?limit=50`);
  const row = original.items.find((item) => item.referenceLabel?.value === "abusive" || item.referenceLabel?.value === "not_abusive");
  expect(row).toBeTruthy();
  const changed = row!.referenceLabel.value === "abusive" ? "not_abusive" : "abusive";
  const posts: string[] = [];
  await page.route("**/api/v1/runs", async (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request().url());
      await route.fulfill({ status: 599, json: { error: { code: "TEST_BLOCKED_RUN", message: "No execution during re-score" } } });
    } else await route.fallback();
  });
  await destination(page, "Test set");
  await page.locator(".step-bar").getByRole("button", { name: "Review labels" }).click();
  const label = page.getByLabel(`Expected answer for ${row!.scenarioId}`);
  await label.selectOption(changed);
  await page.getByRole("button", { name: "Save 1 label changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 reference changes saved" })).toBeVisible();
  await page.getByRole("button", { name: "Publish labels" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Published a new immutable test-set version" })).toBeVisible();
  await page.getByRole("button", { name: "View re-scored results" }).click();
  await expect(page.locator(".results-screen .screen-top h2")).toContainText(runId.slice(0, 8));
  await expect(page.getByText("Re-scored against published labels", { exact: false })).toBeVisible();
  const rescored = await request<{ items: { scenarioId: string; referenceLabel: { value: string }; predictedLabel: string; traceId: string }[] }>(`/runs/${runId}/classification/rows?labelsSuiteVersionId=${(await request<{ id: string }[]>(`/suites/${(await request<{ id: string }[]>(`/projects/${new URL(page.url()).searchParams.get("project")}/suites`))[0].id}/versions`))[0].id}&limit=50`);
  const revised = rescored.items.find((item) => item.scenarioId === row!.scenarioId);
  expect(revised?.referenceLabel?.value).toBe(changed);
  expect(revised?.predictedLabel).toBe(row!.predictedLabel);
  expect(revised?.traceId).toBe(row!.traceId);
  await page.getByRole("button", { name: "Use original labels" }).click();
  await expect(page.getByText("Re-scored against published labels", { exact: false })).toHaveCount(0);
  expect((await request<typeof original>(`/runs/${runId}/classification/rows?limit=50`)).items.find((item) => item.scenarioId === row!.scenarioId)?.referenceLabel?.value).toBe(row!.referenceLabel.value);
  await destination(page, "Test set");
  await page.locator(".step-bar").getByRole("button", { name: "Review labels" }).click();
  await expect(page.getByLabel(`Expected answer for ${row!.scenarioId}`)).toHaveValue(changed);
  expect(posts).toEqual([]);
  await destination(page, "Results");
  await expect(page.getByLabel("Saved run").locator("option")).toHaveCount(1);
});

test("Phase 3A general numeric test set runs without judgments", async ({ page }) => {
  const project = await request<{ id: string }>("/projects", "POST", { name: "Numeric zero-judgment browser case" });
  const workflow = await request<{ id: string; draftRevision: number }>(`/projects/${project.id}/workflows`, "POST", {
    name: "Numeric pass-through", definition: {
      formatVersion: "0.1", id: "numeric_pass_through", name: "Numeric pass-through", description: "No judgment nodes", bindings: [],
      inputSchema: { type: "object", properties: { value: { type: "number" } }, required: ["value"], additionalProperties: false }, outputSchema: { type: "number" },
      nodes: [{ id: "start", label: "Start", kind: "start" }, { id: "finish", label: "Finish", kind: "output", outcomeId: "done", value: { op: "ref", path: ["input", "value"] } }],
      edges: [{ id: "start_next", source: "start", port: "next", target: "finish" }],
    },
  });
  const workflowVersion = await request<{ id: string }>(`/workflows/${workflow.id}/versions`, "POST", { expectedRevision: workflow.draftRevision });
  const suite = await request<{ id: string; draftRevision: number }>(`/projects/${project.id}/suites`, "POST", {
    name: "Numeric cases", definition: { formatVersion: "0.1", id: "numeric_cases", name: "Numeric cases", description: "One number", scenarios: [{ id: "value_7", name: "Value seven", tags: [], input: { value: 7 }, expected: { allowedOutcomes: ["done"] } }] },
  });
  await request(`/suites/${suite.id}/versions`, "POST", { expectedRevision: suite.draftRevision, workflowVersionId: workflowVersion.id });
  await open(page);
  await page.locator(".overview-start").getByLabel("Saved project").selectOption(project.id);
  await destination(page, "Test set");
  await page.locator(".step-bar").getByRole("button", { name: /Run/ }).click();
  await page.locator(".test-screen").getByLabel("Fixture set", { exact: true }).selectOption("gaming");
  await page.getByRole("button", { name: "Run sample", exact: true }).click();
  await expect(page.locator(".results-screen .screen-top h2")).toContainText("Results");
  await expect(page.locator(".results-detail .saved-trace .saved-node").first()).toBeVisible();
  await expect(page.locator(".results-detail")).toContainText("done");
  const runId = await page.getByLabel("Saved run").inputValue();
  const run = await request<{ mode: string; status: string; summary: { completed: number } }>(`/runs/${runId}`);
  expect(run.mode).toBe("mock");
  expect(run.status).toBe("completed");
  expect(run.summary.completed).toBe(1);
});

test("Phase 3A review group inspects a saved case beyond both initial pages", async ({ page }) => {
  test.setTimeout(90000);
  const loaded = await request<{ project: { id: string }; workflowVersion: { id: string }; suiteVersion: { suiteId: string } }>("/examples/classification/load", "POST");
  const draft = await request<{ draftRevision: number; definition: { scenarios: unknown[] } }>(`/suites/${loaded.suiteVersion.suiteId}`);
  const custom = Array.from({ length: 110 }, (_, index) => ({ id: `unmatched_${String(index + 1).padStart(3, "0")}`, name: `Unmatched ${index + 1}`, input: { content: `Unique unmatched mock content ${index + 1}` }, tags: ["unmatched"] }));
  await request(`/suites/${loaded.suiteVersion.suiteId}/draft`, "PUT", { expectedRevision: draft.draftRevision,
    workflowVersionId: loaded.workflowVersion.id, definition: { ...draft.definition, scenarios: [...custom, ...draft.definition.scenarios] } });
  const updated = await request<{ draftRevision: number }>(`/suites/${loaded.suiteVersion.suiteId}`);
  const version = await request<{ id: string }>(`/suites/${loaded.suiteVersion.suiteId}/versions`, "POST", { expectedRevision: updated.draftRevision, workflowVersionId: loaded.workflowVersion.id });
  const queued = await request<{ id: string }>("/runs", "POST", { workflowVersionId: loaded.workflowVersion.id, suiteVersionId: version.id, fixtureSetId: "classification", mode: "mock" });
  await expect.poll(async () => (await request<{ status: string; progress: { persisted: number } }>(`/runs/${queued.id}`)).progress.persisted, { timeout: 60000 }).toBe(118);
  expect((await request<{ status: string }>(`/runs/${queued.id}`)).status).toBe("failed");
  const firstRows = await request<{ items: { scenarioId: string }[] }>(`/runs/${queued.id}/classification/rows?limit=50`);
  const firstCases = await request<{ items: { scenarioId: string }[] }>(`/runs/${queued.id}/scenarios?limit=100`);
  expect(firstRows.items.some((item) => item.scenarioId === "missed_threat")).toBe(false);
  expect(firstCases.items.some((item) => item.scenarioId === "missed_threat")).toBe(false);
  const missed = await request<{ items: { scenarioId: string; input: { content: string }; predictedLabel: string; traceId: string }[] }>(`/runs/${queued.id}/classification/rows?reviewedVerdict=missed_positive&limit=3`);
  expect(missed.items.some((item) => item.scenarioId === "missed_threat")).toBe(true);
  await open(page);
  await page.locator(".overview-start").getByLabel("Saved project").selectOption(loaded.project.id);
  await destination(page, "Results");
  await page.getByLabel("Saved run").selectOption(queued.id);
  const group = page.locator(".review-group", { hasText: "Missed positives" });
  await group.locator(".review-preview", { hasText: "missed_threat" }).click();
  await expect(page.locator(".results-detail")).toContainText("missed_threat");
  await expect(page.locator(".results-detail .detail-input")).toContainText(missed.items.find((item) => item.scenarioId === "missed_threat")!.input.content);
  await expect(page.locator(".results-detail")).toContainText(missed.items.find((item) => item.scenarioId === "missed_threat")!.predictedLabel);
  await expect(page.locator(".results-detail .saved-trace .saved-node").first()).toBeVisible();
  await expect(page.locator(".results-detail").getByText("Raw trace JSON")).toBeVisible();
});

test("Phase 3A Agrees counts reviewed positive and negative matches while unknown stays unverified", async ({ page }) => {
  await open(page);
  await runStarter(page);
  const runId = await page.getByLabel("Saved run").inputValue();
  const report = await request<{ selected: number; summary: { reviewed: { selected: number; agreement: { numerator: number; denominator: number } } } }>(`/runs/${runId}/classification`);
  const agrees = await request<{ total: number; items: { scenarioId: string; verdict: string; referenceLabel: { review: string } }[] }>(`/runs/${runId}/classification/rows?reviewedVerdict=agree&limit=50`);
  const unknown = await request<{ total: number; items: { scenarioId: string; referenceLabel?: { review: string; value: string | null } }[] }>(`/runs/${runId}/classification/rows?reviewedVerdict=unknown&limit=50`);
  expect(agrees.items.some((item) => item.verdict === "true_positive")).toBe(true);
  expect(agrees.items.some((item) => item.verdict === "true_negative")).toBe(true);
  expect(agrees.items.every((item) => item.referenceLabel.review === "reviewed")).toBe(true);
  expect(unknown.items.length).toBeGreaterThan(0);
  expect(unknown.items.every((item) => !item.referenceLabel || item.referenceLabel.review !== "reviewed" || item.referenceLabel.value === null)).toBe(true);
  await page.getByRole("button", { name: "Agrees", exact: true }).click();
  await expect(page.locator(".results-table tbody tr")).toHaveCount(agrees.total);
  expect(report.summary.reviewed.agreement.numerator).toBe(agrees.total);
  await expect(page.locator(".results-summary-joined")).toContainText(`Reviewed agreement ${report.summary.reviewed.agreement.numerator} of ${report.summary.reviewed.agreement.denominator} evaluated`);
  await expect(page.locator(".results-summary-joined")).toContainText(`Unreviewed references ${report.selected - report.summary.reviewed.selected} of ${report.selected}`);
});

test("Phase 3A inspected pending row refreshes when saved case becomes available", async ({ page }) => {
  await open(page);
  await runStarter(page);
  const runId = await page.getByLabel("Saved run").inputValue();
  const actual = await request<{ items: { scenarioId: string; predictedLabel: string }[] }>(`/runs/${runId}/classification/rows?limit=50`);
  const first = actual.items[0];
  expect(first?.predictedLabel).toBeTruthy();
  let pending = true;
  await page.route(`**/api/v1/runs/${runId}/classification/rows?*`, async (route) => {
    const source = new URL(route.request().url());
    const response = await route.fetch({ url: `${apiUrl}${source.pathname}${source.search}` });
    const body = await response.json() as { items: Record<string, unknown>[] };
    if (pending && !source.searchParams.get("reviewedVerdict") && !source.searchParams.get("verdict") && !source.searchParams.get("review")) {
      body.items = body.items.map((item) => item.scenarioId === first.scenarioId ? { ...item, predictedLabel: "PENDING_BROWSER", traceId: null, status: "pending", executionStatus: "pending" } : item);
      await route.fulfill({ response, json: body });
    } else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Agrees", exact: true }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator(".results-table tbody tr").first()).toContainText("PENDING_BROWSER");
  await page.locator(".results-table tbody tr").first().getByRole("button").first().click();
  await expect(page.locator(".results-detail")).toContainText("PENDING_BROWSER");
  pending = false;
  await page.getByRole("button", { name: "Agrees", exact: true }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator(".results-table tbody tr").first()).toContainText(first.predictedLabel);
  await expect(page.locator(".results-detail")).toContainText(first.predictedLabel);
  await expect(page.locator(".results-detail")).not.toContainText("PENDING_BROWSER");
});
