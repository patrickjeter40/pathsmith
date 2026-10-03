import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "../../apps/api/dist/app.js";
import { LocalApplication } from "../../apps/api/dist/service.js";
import { loadExample } from "../../apps/api/dist/examples.js";

let app: Awaited<ReturnType<typeof createApi>>;
let dataDir: string;
let apiUrl: string;
const screenshots = "/workspace/attachments/pathsmith-implementation/phase3b";

test.beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pathsmith-redesign3b-"));
  app = await createApi({ port: 0, dataDir });
  apiUrl = new URL(await app.getUrl()).origin;
});
test.afterAll(async () => {
  await app?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});
async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: method === "GET" ? undefined : { "Content-Type": "application/json", "X-Pathsmith-Client": "local" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(value));
  return value as T;
}
async function open(page: Page, projectId: string) {
  await page.route("**/api/v1/**", async (route) => {
    const source = new URL(route.request().url());
    if (source.pathname === "/api/v1/runs" && route.request().method() === "POST") {
      await route.fulfill({ status: 599, json: { error: { code: "TEST_BLOCKED_LIVE", message: "Run queue blocked in authoring test" } } });
      return;
    }
    const response = await route.fetch({ url: `${apiUrl}${source.pathname}${source.search}` });
    await route.fulfill({ response });
  });
  await page.goto(`/?project=${projectId}#/workflow`);
  await expect(page.locator(".shell-health")).toContainText("API ready");
  await expect(page.locator(".workflow-title h2")).toBeVisible();
}
async function editJson(page: Page, change: (definition: Record<string, unknown>) => void) {
  await page.getByRole("tab", { name: "JSON" }).click();
  const editor = page.getByLabel("Workflow JSON", { exact: true });
  const definition = JSON.parse(await editor.inputValue()) as Record<string, unknown>;
  change(definition);
  await editor.fill(JSON.stringify(definition));
  await editor.blur();
  await expect(page.getByRole("button", { name: "Save version" })).toBeEnabled();
}
async function numericProject(caseCount: number) {
  const project = await request<{ id: string }>("/projects", "POST", { name: `Numeric comparison ${caseCount}` });
  const workflow = await request<{ id: string; draftRevision: number }>(`/projects/${project.id}/workflows`, "POST", {
    name: "Numeric pass-through", definition: {
      formatVersion: "0.1", id: "numeric_pass_through", name: "Numeric pass-through", description: "No judgment nodes", bindings: [],
      inputSchema: { type: "object", properties: { value: { type: "number" } }, required: ["value"], additionalProperties: false }, outputSchema: { type: "number" },
      nodes: [{ id: "start", label: "Start", kind: "start" }, { id: "finish", label: "Finish", kind: "output", outcomeId: "done", value: { op: "ref", path: ["input", "value"] } }],
      edges: [{ id: "start_next", source: "start", port: "next", target: "finish" }],
    },
  });
  const workflowVersion = await request<{ id: string }>(`/workflows/${workflow.id}/versions`, "POST", { expectedRevision: workflow.draftRevision });
  const suite = await request<{ id: string; draftRevision: number }>(`/projects/${project.id}/suites`, "POST", { name: "Numeric cases",
    definition: { formatVersion: "0.1", id: "numeric_cases", name: "Numeric cases", description: "A long exact cohort",
      scenarios: Array.from({ length: caseCount }, (_, index) => ({ id: `case_${index + 1}`, name: `Case ${index + 1}`, tags: [], input: { value: index + 1 }, expected: { allowedOutcomes: ["done"] } })) } });
  const suiteVersion = await request<{ id: string }>(`/suites/${suite.id}/versions`, "POST", { expectedRevision: suite.draftRevision, workflowVersionId: workflowVersion.id });
  const run = async () => {
    const queued = await request<{ id: string }>("/runs", "POST", { workflowVersionId: workflowVersion.id, suiteVersionId: suiteVersion.id, fixtureSetId: "gaming", mode: "mock", profile: { formatVersion: "0.1", bindings: {} } });
    await expect.poll(async () => (await request<{ status: string }>(`/runs/${queued.id}`)).status, { timeout: 30000 }).toBe("completed");
    return queued.id;
  };
  return { projectId: project.id, workflowVersionId: workflowVersion.id, suiteId: suite.id, suiteVersionId: suiteVersion.id, run };
}
async function projectWithWorkflow(name: string, definition: Record<string, unknown>) {
  const project = await request<{ id: string }>("/projects", "POST", { name });
  const workflow = await request<{ id: string }>(`/projects/${project.id}/workflows`, "POST", { name, definition });
  return { projectId: project.id, workflowId: workflow.id };
}
async function interruptedClassificationRun(mode: "mock" | "live" = "mock") {
  const loaded = await request<{ project: { id: string }; workflowVersion: { id: string }; suiteVersion: { id: string } }>("/examples/classification/load", "POST");
  const baseline = await request<{ id: string }>("/runs", "POST", { workflowVersionId: loaded.workflowVersion.id,
    suiteVersionId: loaded.suiteVersion.id, fixtureSetId: "classification", mode: "mock" });
  await expect.poll(async () => (await request<{ status: string }>(`/runs/${baseline.id}`)).status, { timeout: 30000 }).toBe("completed");
  const example = loadExample("classification");
  const local = app.get(LocalApplication);
  const parent = local.storage.queueRun(local.context, { workflowVersionId: loaded.workflowVersion.id, suiteVersionId: loaded.suiteVersion.id,
    ...(mode === "mock" ? { fixtures: example.fixtures, profile: example.profile } : { mode: "live" as const,
      profile: { formatVersion: "0.1" as const, bindings: { decisions: { providerId: "jev", model: "jev-offline" } } },
      adapters: { decisions: { providerId: "jev", requestedModel: "jev-offline", adapterVersion: "offline-seed", normalizerVersion: "offline-seed", resolvedModels: [] } },
      liveConfirmed: true, controls: { maxProviderCalls: 8, stopAfterConsecutiveErrors: 2 }, httpAttemptLimit: 24 }) });
  await app.close();
  app = await createApi({ port: 0, dataDir });
  apiUrl = new URL(await app.getUrl()).origin;
  await expect.poll(async () => (await request<{ status: string }>(`/runs/${parent.id}`)).status).toBe("interrupted");
  return { loaded, baselineId: baseline.id, parentId: parent.id };
}

test("Phase 3B real workflow 409 combines disjoint edits into executable immutable version", async ({ page, context }) => {
  const loaded = await request<{ project: { id: string }; workflowVersion: { workflowId: string; id: string } }>("/examples/support-baseline/load", "POST");
  await open(page, loaded.project.id);
  const second = await context.newPage();
  await open(second, loaded.project.id);
  await editJson(page, (definition) => { definition.description = "Remote description from first window"; });
  await editJson(second, (definition) => { definition.name = "Local title from second window"; });
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.locator(".workflow-title")).toContainText("Executable");
  const conflictResponse = second.waitForResponse((response) => response.url().endsWith(`/workflows/${loaded.workflowVersion.workflowId}/save-version`) && response.status() === 409);
  await second.getByRole("button", { name: "Save version" }).click();
  await conflictResponse;
  await second.getByRole("tab", { name: /Problems/ }).click();
  await expect(second.locator(".merge-conflicts")).toBeVisible();
  await expect(second.getByLabel("Node inspector")).toContainText("Save conflict");
  await expect(second.getByLabel("Node inspector")).not.toContainText("Saved snapshot");
  await mkdir(screenshots, { recursive: true });
  await second.screenshot({ path: `${screenshots}/real-409-conflict.png`, fullPage: true });
  await second.getByRole("button", { name: "Apply my edits on top" }).click();
  await expect(second.locator(".workflow-title")).toContainText("Executable");
  const versions = await request<{ id: string; definition: { name: string; description: string } }[]>(`/workflows/${loaded.workflowVersion.workflowId}/versions`);
  expect(versions).toHaveLength(3);
  expect(versions[0].definition.name).toBe("Local title from second window");
  expect(versions[0].definition.description).toBe("Remote description from first window");
  expect((await request<{ definition: { name: string } }>(`/workflow-versions/${loaded.workflowVersion.id}`)).definition.name).not.toBe("Local title from second window");
  await expect(second.getByRole("button", { name: /Run / })).toBeEnabled();
});

test("Phase 3B clearing and retyping node fields keeps the inspector and valid save", async ({ page }) => {
  const loaded = await request<{ project: { id: string }; workflowVersion: { workflowId: string } }>("/examples/support-baseline/load", "POST");
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, loaded.project.id);
  await page.locator(".editor-mobile-list button", { hasText: "assess_request" }).click();
  const inspector = page.getByLabel("Node inspector");
  await expect(inspector).toContainText("assess_request");
  for (const [label, replacement] of [
    ["Node label", "Assess the edited request"],
    ["department instructions", "Choose the correct department from the request."],
    ["department billing description", "Payments and invoices."],
  ] as const) {
    const field = inspector.getByLabel(label, { exact: true });
    await field.fill("");
    await expect(inspector).toContainText("assess_request");
    await expect(field).toBeVisible();
    await expect(page.getByRole("button", { name: "Save version" })).toBeDisabled();
    await field.fill(replacement);
    await expect(field).toHaveValue(replacement);
  }
  await expect(page.getByRole("button", { name: "Save version" })).toBeEnabled();
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.locator(".workflow-title")).toContainText("Executable");
  const versions = await request<{ definition: { nodes: { id: string; label: string; questions?: { department?: { instructions: string; options: { billing: string } } } }[] } }[]>(`/workflows/${loaded.workflowVersion.workflowId}/versions`);
  const saved = versions[0].definition.nodes.find((item) => item.id === "assess_request");
  expect(saved?.label).toBe("Assess the edited request");
  expect(saved?.questions?.department?.instructions).toBe("Choose the correct department from the request.");
  expect(saved?.questions?.department?.options.billing).toBe("Payments and invoices.");
});

test("Phase 3B Compare opens the exact saved generic case beyond the first 100", async ({ page }) => {
  test.setTimeout(90000);
  const seeded = await numericProject(105);
  const baselineId = await seeded.run();
  const candidateId = await seeded.run();
  await open(page, seeded.projectId);
  await page.locator(".shell-nav:visible, .shell-mobile-nav:visible").getByRole("button", { name: "Compare" }).click();
  await page.getByLabel("Baseline run").selectOption(baselineId);
  await page.getByLabel("Candidate run").selectOption(candidateId);
  await expect(page.locator(".compare-gate-card")).toContainText("pass");
  const table = page.locator(".compare-table-wrap");
  for (let pageIndex = 0; pageIndex < 3 && await table.locator("tr", { hasText: "case_105" }).count() === 0; pageIndex++) {
    await expect(table.getByRole("button", { name: "Next" })).toBeEnabled();
    await table.getByRole("button", { name: "Next" }).click();
  }
  await expect(table.locator("tr", { hasText: "case_105" })).toHaveCount(1);
  await table.locator("tr", { hasText: "case_105" }).getByRole("button").first().click();
  await expect(page.locator(".compare-path-panel")).toContainText("First observed divergence");
  await page.getByRole("button", { name: "Open candidate case in Results" }).click();
  await expect(page.locator(".results-screen .screen-top h2")).toContainText(candidateId.slice(0, 8));
  await expect(page.locator(".results-detail")).toContainText("case_105");
  await expect(page.locator(".results-detail .saved-trace")).toContainText("Outcome done");
  await expect(page.locator(".results-detail .saved-trace")).toContainText("105");
  await expect(page.locator(".results-detail")).not.toContainText("case_1 ·");
});

test("Phase 3B imported legal object-method node IDs show and clear actual node diagnostics", async ({ page }) => {
  const seeded = await numericProject(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, seeded.projectId);
  const definition = {
    formatVersion: "0.1", id: "method_names", name: "Legal node names", description: "Object-method IDs are ordinary node IDs", bindings: [],
    inputSchema: { type: "object", properties: { value: { type: "number" } }, required: ["value"], additionalProperties: false },
    outputSchema: { type: "number" },
    nodes: [
      { id: "start", label: "Start", kind: "start" },
      { id: "toString", label: "First transform", kind: "transform", value: { op: "ref", path: ["input", "value"] } },
      { id: "valueOf", label: "Second transform", kind: "transform", value: { op: "ref", path: ["outputs", "toString"] } },
      { id: "finish", label: "Finish", kind: "output", outcomeId: "done", value: { op: "ref", path: ["outputs", "valueOf"] } },
    ],
    edges: [
      { id: "e_start", source: "start", port: "next", target: "toString" },
      { id: "e_first", source: "toString", port: "next", target: "valueOf" },
      { id: "e_second", source: "valueOf", port: "next", target: "finish" },
    ],
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByLabel("Import workflow JSON").setInputFiles({ name: "legal-node-ids.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(definition)) });
  const first = page.locator(".editor-mobile-list button", { hasText: "toString" });
  const second = page.locator(".editor-mobile-list button", { hasText: "valueOf" });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expect(page.getByRole("button", { name: "Save version" })).toBeEnabled();
  await first.click();
  const label = page.getByLabel("Node inspector").getByLabel("Node label", { exact: true });
  await label.fill("");
  await expect(page.getByRole("button", { name: "Save version" })).toBeDisabled();
  await expect(page.locator('[data-canvas-node="toString"] .workflow-card-problem')).toContainText("Error");
  await expect(first.locator(".workflow-mobile-problem")).toContainText("Error");
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: `${screenshots}/mobile-invalid-node-diagnostic.png`, fullPage: true });
  await label.fill("First transform repaired");
  await expect(page.locator('[data-canvas-node="toString"] .workflow-card-problem')).toHaveCount(0);
  await expect(first.locator(".workflow-mobile-problem")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save version" })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("Phase 3B saved snapshot Problems show snapshot validity while preserving invalid draft", async ({ page }) => {
  const seeded = await numericProject(1);
  const runId = await seeded.run();
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, seeded.projectId);
  await page.locator(".editor-mobile-list button", { hasText: "Finish" }).click();
  await page.getByLabel("Node inspector").getByLabel("Node label", { exact: true }).fill("");
  await expect(page.getByRole("tab", { name: /Problems/ })).not.toContainText("Problems · 0");
  await page.locator(".shell-nav:visible, .shell-mobile-nav:visible").getByRole("button", { name: "Results" }).click();
  await page.getByLabel("Saved run").selectOption(runId);
  await page.locator(".generic-case-list button", { hasText: "case_1" }).click();
  await page.locator(".results-detail").getByRole("button", { name: "Workflow" }).click();
  await expect(page.locator(".workflow-snapshot-banner")).toContainText("saved workflow");
  await page.getByRole("tab", { name: /Problems/ }).click();
  await expect(page.locator(".workflow-dock-content")).toContainText("No validation problems in this saved workflow snapshot.");
  await expect(page.locator(".workflow-dock-content")).toContainText("Draft problems and save conflicts are deferred");
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: `${screenshots}/mobile-saved-snapshot.png`, fullPage: true });
  await expect(page.getByRole("button", { name: "Save version" })).toBeDisabled();
  await page.getByRole("button", { name: "Edit in my draft" }).click();
  await expect(page.locator(".workflow-snapshot-banner")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Problems/ })).not.toContainText("Problems · 0");
  await expect(page.getByRole("button", { name: "Save version" })).toBeDisabled();
});

test("Phase 3B arrow navigation reaches both convergent branch paths without moving nodes", async ({ page }) => {
  const graph = {
    formatVersion: "0.1", id: "convergent", name: "Convergent branch", description: "Both outgoing paths reach finish", bindings: [],
    inputSchema: { type: "object", properties: {}, additionalProperties: true }, outputSchema: { type: "string" },
    nodes: [
      { id: "start", label: "Start", kind: "start" },
      { id: "branch", label: "Choose path", kind: "branch", cases: [{ id: "direct", when: { op: "literal", value: true } }] },
      { id: "transform", label: "Alternate path", kind: "transform", value: { op: "literal", value: "alternate" } },
      { id: "finish", label: "Finish", kind: "output", outcomeId: "done", value: { op: "literal", value: "done" } },
    ],
    edges: [
      { id: "e_start", source: "start", port: "next", target: "branch" },
      { id: "e_direct", source: "branch", port: "direct", target: "finish" },
      { id: "e_default", source: "branch", port: "default", target: "transform" },
      { id: "e_alternate", source: "transform", port: "next", target: "finish" },
    ],
  };
  const seeded = await projectWithWorkflow("Keyboard convergence", graph);
  await open(page, seeded.projectId);
  const node = (id: string) => page.locator(`[data-canvas-node="${id}"]`);
  await expect(node("finish")).toBeAttached();
  const positions = () => page.locator(".react-flow__node").evaluateAll((elements) => Object.fromEntries(elements.map((element) => [element.getAttribute("data-id"), /transform: ([^;]+)/.exec(element.getAttribute("style") ?? "")?.[1]])));
  const before = await positions();
  await node("start").focus();
  for (const [key, expected] of [["ArrowRight", "branch"], ["ArrowRight", "finish"], ["ArrowLeft", "branch"], ["ArrowRight", "transform"], ["ArrowRight", "finish"], ["ArrowLeft", "transform"]] as const) {
    await page.keyboard.press(key);
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.canvasNode)).toBe(expected);
  }
  expect(await positions()).toEqual(before);
});

test("Phase 3B compact Compare stacks both run cards and keeps provenance readable", async ({ page }) => {
  const seeded = await numericProject(1);
  const baselineId = await seeded.run();
  const candidateId = await seeded.run();
  await page.setViewportSize({ width: 1024, height: 820 });
  await open(page, seeded.projectId);
  await page.locator(".shell-nav:visible, .shell-mobile-nav:visible").getByRole("button", { name: "Compare" }).click();
  await page.getByLabel("Baseline run").selectOption(baselineId);
  await page.getByLabel("Candidate run").selectOption(candidateId);
  await expect(page.locator(".compare-gate-card")).toContainText("pass");
  const cards = page.locator(".compare-run-card");
  await expect(cards).toHaveCount(2);
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  expect(first && second && second.y >= first.y + first.height).toBe(true);
  await expect(cards.nth(0)).toContainText(baselineId);
  await expect(cards.nth(1)).toContainText(candidateId);
  await expect(cards.nth(0).locator(".mode-badge")).toContainText("Mock");
  await expect(cards.nth(1).locator(".mode-badge")).toContainText("Mock");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Side by side" }).click();
  await expect(page.locator(".compare-path-grid.view-both .compare-path")).toHaveCount(2);
  await expect(page.locator(".compare-path-grid.view-both .compare-path").first()).toBeVisible();
  await expect(page.locator(".compare-path-grid.view-both .compare-path").last()).toBeVisible();
  const mobile = await page.evaluate(() => {
    const cell = document.querySelector(".compare-table tr td:nth-child(5)");
    const pseudo = cell && getComputedStyle(cell, "::before");
    return { overflow: document.documentElement.scrollWidth > window.innerWidth + 1, pseudoWhitespace: pseudo?.whiteSpace, pseudoWidth: pseudo?.minWidth };
  });
  expect(mobile.overflow).toBe(false);
  expect(mobile.pseudoWhitespace).toBe("nowrap");
});

test("Phase 3B real 409 Combine keeps local branch order plus remote port and default route", async ({ page, context }) => {
  const graph = {
    formatVersion: "0.1", id: "merge_branch", name: "Merge branch", description: "Ordered branch", bindings: [],
    inputSchema: { type: "object", properties: {}, additionalProperties: true }, outputSchema: { type: "string" },
    nodes: [
      { id: "start", label: "Start", kind: "start" },
      { id: "route", label: "Route", kind: "branch", cases: [
        { id: "A", when: { op: "literal", value: false } }, { id: "B", when: { op: "literal", value: true } },
      ] },
      { id: "finish", label: "Finish", kind: "output", outcomeId: "done", value: { op: "literal", value: "done" } },
    ],
    edges: [
      { id: "start_next", source: "start", port: "next", target: "route" },
      { id: "route_A", source: "route", port: "A", target: "finish" },
      { id: "route_B", source: "route", port: "B", target: "finish" },
      { id: "route_default", source: "route", port: "default", target: "finish" },
    ],
  };
  const seeded = await projectWithWorkflow("Branch combine", graph);
  await open(page, seeded.projectId);
  const second = await context.newPage();
  await open(second, seeded.projectId);
  await editJson(page, (definition) => {
    const branch = (definition.nodes as { id: string; cases: unknown[] }[]).find((item) => item.id === "route")!;
    branch.cases.reverse();
  });
  await editJson(second, (definition) => {
    const branch = (definition.nodes as { id: string; cases: unknown[] }[]).find((item) => item.id === "route")!;
    branch.cases.push({ id: "R", when: { op: "literal", value: false } });
    (definition.edges as unknown[]).push({ id: "route_R", source: "route", port: "R", target: "finish" });
  });
  await second.getByRole("button", { name: "Save version" }).click();
  await expect(second.locator(".workflow-title")).toContainText("Executable");
  await page.getByRole("button", { name: "Save version" }).click();
  await page.getByRole("tab", { name: /Problems/ }).click();
  await expect(page.locator(".merge-conflicts")).toContainText("Order: B → A → R");
  await expect(page.locator(".merge-conflicts")).toContainText("R → Finish");
  await expect(page.locator(".merge-conflicts")).toContainText("Default:");
  await expect(page.getByLabel("Node inspector")).toContainText("Save conflict");
  await expect(page.getByLabel("Node inspector")).not.toContainText("Saved snapshot");
  await page.locator(".merge-conflict").getByRole("button", { name: "Combine" }).click();
  await expect(page.locator(".merge-conflict").getByRole("button", { name: "Combine" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Review and save resolution" }).click();
  await expect(page.locator(".workflow-title")).toContainText("Executable");
  const versions = await request<{ definition: { nodes: { id: string; cases: { id: string }[] }[]; edges: { id: string; source: string; port: string; target: string }[] } }[]>(`/workflows/${seeded.workflowId}/versions`);
  const final = versions[0].definition;
  expect(final.nodes.find((item) => item.id === "route")?.cases.map((item) => item.id)).toEqual(["B", "A", "R"]);
  expect(final.edges.find((item) => item.port === "R")).toMatchObject({ id: "route_R", source: "route", target: "finish" });
  expect(final.edges.find((item) => item.port === "default")).toMatchObject({ id: "route_default", source: "route", target: "finish" });
  const mergedEdge = page.locator('.workflow-editor-wrap .react-flow__edge[data-id="route_R"] .react-flow__edge-path');
  await expect(mergedEdge).toBeVisible();
  await expect(mergedEdge).toHaveAttribute("d", /[ML]/);
  await page.locator(".react-flow__controls-fitview").click();
  await page.locator('[data-canvas-node="route"]').click();
  await expect.poll(async () => {
    const [edge, canvas, route, finish] = await Promise.all([
      mergedEdge.boundingBox(), page.locator(".workflow-editor-wrap .canvas").boundingBox(),
      page.locator('[data-canvas-node="route"]').boundingBox(), page.locator('[data-canvas-node="finish"]').boundingBox(),
    ]);
    return !!edge && !!canvas && !!route && !!finish && [edge, route, finish].every((box) =>
      box.x >= canvas.x && box.x + box.width <= canvas.x + canvas.width && box.y >= canvas.y && box.y + box.height <= canvas.y + canvas.height);
  }).toBe(true);
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: `${screenshots}/real-409-combined-edge.png`, fullPage: true });
});

test("Phase 3B Workflow and Compare render at desktop compact and mobile in both themes", async ({ page }) => {
  test.setTimeout(90000);
  await mkdir(screenshots, { recursive: true });
  const support = await request<{ project: { id: string } }>("/examples/support-baseline/load", "POST");
  const numeric = await numericProject(1);
  const baselineId = await numeric.run();
  const candidateId = await numeric.run();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, support.project.id);
  for (const { width, height, layout } of [
    { width: 1440, height: 900, layout: "desktop" },
    { width: 1024, height: 768, layout: "compact" },
    { width: 390, height: 844, layout: "mobile" },
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ["dark", "light"] as const) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByRole("button", { name: `Switch to ${theme} theme` }).click();
      await page.goto(`/?project=${support.project.id}#/workflow`);
      await expect(page.locator(".workflow-title h2")).toBeVisible();
      if (width > 760) {
        await expect(page.locator(".workflow-editor-wrap .canvas")).toHaveAttribute("data-fit-ready", "true").catch(async (error) => {
          const state = await page.evaluate(() => ({ nodes: document.querySelectorAll(".workflow-editor-wrap .react-flow__node").length, cards: document.querySelectorAll(".workflow-editor-wrap [data-canvas-node]").length, viewport: document.querySelector(".workflow-editor-wrap .react-flow__viewport")?.getAttribute("style") }));
          throw new Error(`Workflow fit stalled at ${layout}/${theme}: ${JSON.stringify(state)}; ${String(error)}`);
        });
        await expect(page.locator('.workflow-editor-wrap [data-canvas-node="start"]')).toBeAttached();
        await page.locator('[data-canvas-node="start"]').focus();
        await page.keyboard.press("ArrowRight");
      } else {
        await page.locator(".editor-mobile-list button", { hasText: "assess_request" }).click();
      }
      await expect(page.getByLabel("Node inspector")).toContainText("assess_request");
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `${screenshots}/${layout}-${theme}-workflow.png`, fullPage: true });
      await page.goto(`/?project=${numeric.projectId}#/compare`);
      await page.getByLabel("Baseline run").selectOption(baselineId);
      await page.getByLabel("Candidate run").selectOption(candidateId);
      await expect(page.locator(".compare-gate-card")).toContainText("pass");
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `${screenshots}/${layout}-${theme}-compare.png`, fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});

test("Phase 3B compact workflow settles to visible legible graph cards", async ({ page }) => {
  const support = await request<{ project: { id: string } }>("/examples/support-baseline/load", "POST");
  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page, support.project.id);
  await expect(page.locator(".workflow-editor-wrap .canvas")).toHaveAttribute("data-fit-ready", "true");
  await page.waitForTimeout(400);
  const metrics = await page.evaluate(() => {
    const canvas = document.querySelector(".workflow-editor-wrap .canvas")?.getBoundingClientRect();
    const cards = [...document.querySelectorAll<HTMLElement>(".workflow-editor-wrap [data-canvas-node]")].map((element) => {
      const box = element.getBoundingClientRect();
      const visible = !!canvas && box.right > canvas.left && box.left < canvas.right && box.bottom > canvas.top && box.top < canvas.bottom;
      return { id: element.dataset.canvasNode, width: box.width, visible };
    });
    return { count: cards.length, visible: cards.filter((item) => item.visible).length, widest: Math.max(0, ...cards.map((item) => item.width)) };
  });
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: `${screenshots}/compact-settled-workflow.png`, fullPage: true });
  expect(metrics.count).toBeGreaterThan(10);
  expect(metrics.visible).toBeGreaterThan(0);
  expect(metrics.widest).toBeGreaterThanOrEqual(110);
});

test("Phase 3B selected workflow node stays centered and readable after resize", async ({ page }) => {
  const support = await request<{ project: { id: string } }>("/examples/support-baseline/load", "POST");
  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page, support.project.id);
  await expect(page.locator(".workflow-editor-wrap .canvas")).toHaveAttribute("data-fit-ready", "true", { timeout: 10000 });
  await page.locator('[data-canvas-node="start"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.canvasNode)).toBe("assess_request");
  await expect(page.getByLabel("Node inspector")).toContainText("assess_request");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".workflow-editor-wrap .canvas")).toHaveAttribute("data-fit-ready", "true", { timeout: 10000 });
  const visible = await page.evaluate(() => {
    const canvas = document.querySelector(".workflow-editor-wrap .canvas")?.getBoundingClientRect();
    const card = document.querySelector('[data-canvas-node="assess_request"]')?.getBoundingClientRect();
    return !!canvas && !!card && card.width >= 110 && card.right > canvas.left && card.left < canvas.right && card.bottom > canvas.top && card.top < canvas.bottom;
  });
  expect(visible).toBe(true);
  await expect(page.getByLabel("Node inspector")).toContainText("assess_request");
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: `${screenshots}/desktop-selected-inspector.png`, fullPage: true });
});

test("Phase 3B Compare candidate labels use actual policy and never queue a run", async ({ page }) => {
  const seeded = await numericProject(2);
  const baselineId = await seeded.run();
  const comparableId = await seeded.run();
  const partial = await request<{ id: string }>("/runs", "POST", { workflowVersionId: seeded.workflowVersionId, suiteVersionId: seeded.suiteVersionId,
    fixtureSetId: "gaming", mode: "mock", profile: { formatVersion: "0.1", bindings: {} }, selectedScenarioIds: ["case_1"] });
  await expect.poll(async () => (await request<{ status: string }>(`/runs/${partial.id}`)).status).toBe("completed");
  let queuedInBrowser = 0;
  await open(page, seeded.projectId);
  await page.route("**/api/v1/runs", async (route) => { if (route.request().method() === "POST") queuedInBrowser++; await route.fulfill({ status: 599, json: { error: { code: "TEST_BLOCKED_RUN", message: "No run should be queued in Compare" } } }); });
  await page.locator(".shell-nav:visible, .shell-mobile-nav:visible").getByRole("button", { name: "Compare" }).click();
  await page.getByLabel("Baseline run").selectOption(baselineId);
  await page.getByLabel("Candidate run").selectOption(partial.id);
  const candidates = page.getByLabel("Candidate run");
  await expect(candidates.locator(`option[value="${comparableId}"]`)).toContainText("Comparable");
  await expect(candidates.locator(`option[value="${partial.id}"]`)).toContainText("Not comparable");
  await expect(page.locator(".compare-gate-card")).toContainText("inconclusive");
  await page.getByLabel("Comparison basis").selectOption("reviewed_classification");
  await expect(candidates.locator(`option[value="${comparableId}"]`)).toContainText("Not comparable");
  await expect(candidates.locator(`option[value="${partial.id}"]`)).toContainText("Not comparable");
  expect(queuedInBrowser).toBe(0);
});

test("Phase 3B cross-project test-set remedy pins a copied published version and exact baseline cases", async ({ page }) => {
  const baseline = await numericProject(3);
  const baselineId = await baseline.run();
  const candidate = await numericProject(2);
  const candidateId = await candidate.run();
  let browserQueues = 0;
  await open(page, candidate.projectId);
  await page.route("**/api/v1/runs", async (route) => {
    if (route.request().method() === "POST") browserQueues++;
    await route.fulfill({ status: 599, json: { error: { code: "TEST_BLOCKED_RUN", message: "Compare must not queue" } } });
  });
  await page.locator(".shell-nav:visible, .shell-mobile-nav:visible").getByRole("button", { name: "Test set" }).click();
  await page.locator(".step-bar").getByRole("button", { name: /Run/ }).click();
  await page.getByLabel("Fixture set", { exact: true }).selectOption("gaming");
  await page.locator(".shell-nav:visible, .shell-mobile-nav:visible").getByRole("button", { name: "Compare" }).click();
  await page.getByLabel("Baseline run").selectOption(baselineId);
  await page.getByLabel("Candidate run").selectOption(candidateId);
  await expect(page.locator(".compare-gate-card")).toContainText("inconclusive");
  await expect(page.locator(".compare-remedies").getByRole("button", { name: /Use baseline test set and exact selection/ })).toBeVisible();
  await page.locator(".compare-remedies").getByRole("button", { name: /Use baseline test set and exact selection/ }).click();
  await expect(page).toHaveURL(/#\/testset$/);
  await expect(page.locator(".screen-banner")).toContainText("baseline test set copied into this project");
  await expect(page.locator(".screen-banner")).toContainText("3 selected cases");
  await expect(page.locator(".run-facts")).toContainText(candidate.workflowVersionId.slice(0, 8));
  const copied = await request<{ id: string }[]>(`/projects/${candidate.projectId}/suites`);
  expect(copied).toHaveLength(2);
  const copiedSuiteId = copied.find((item) => item.id !== candidate.suiteId)?.id;
  expect(copiedSuiteId).toBeTruthy();
  const copiedVersions = await request<{ id: string; definition: { scenarios: { id: string }[] } }[]>(`/suites/${copiedSuiteId}/versions`);
  expect(copiedVersions).toHaveLength(1);
  expect(copiedVersions[0].definition.scenarios.map((item) => item.id)).toEqual(["case_1", "case_2", "case_3"]);
  await expect(page.locator(".run-facts")).toContainText(copiedVersions[0].id.slice(0, 8));
  await expect(page.getByRole("button", { name: "Run 3 selected cases" })).toBeEnabled();
  expect(browserQueues).toBe(0);
});

test("Phase 3B second 409 keeps the resolved candidate and requires a fresh choice", async ({ page, context }) => {
  const loaded = await request<{ project: { id: string }; workflowVersion: { workflowId: string } }>("/examples/support-baseline/load", "POST");
  await open(page, loaded.project.id);
  const local = await context.newPage();
  await open(local, loaded.project.id);
  await editJson(page, (definition) => { definition.description = "First remote revision"; });
  await editJson(local, (definition) => { definition.description = "My retained candidate"; });
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.locator(".workflow-title")).toContainText("Executable");
  const third = await context.newPage();
  await open(third, loaded.project.id);
  await local.getByRole("button", { name: "Save version" }).click();
  await local.getByRole("tab", { name: /Problems/ }).click();
  await expect(local.locator(".merge-conflict")).toHaveCount(1);
  await local.locator(".merge-conflict").getByRole("button", { name: "Keep mine" }).click();
  await editJson(third, (definition) => { definition.description = "Second remote revision"; });
  await third.getByRole("button", { name: "Save version" }).click();
  await expect(third.locator(".workflow-title")).toContainText("Executable");
  const secondConflict = local.waitForResponse((response) => response.url().endsWith(`/workflows/${loaded.workflowVersion.workflowId}/save-version`) && response.status() === 409);
  await local.getByRole("button", { name: "Review and save resolution" }).click();
  await secondConflict;
  await expect(local.locator(".merge-conflicts")).toContainText("Your resolved candidate is retained");
  await expect(local.locator(".merge-conflicts")).toContainText("My retained candidate");
  await expect(local.locator(".merge-conflicts")).toContainText("Second remote revision");
  await expect(local.locator(".merge-conflict").getByRole("button", { name: "Keep mine" })).toHaveAttribute("aria-pressed", "false");
  await local.locator(".merge-conflict").getByRole("button", { name: "Keep mine" }).click();
  await local.getByRole("button", { name: "Review and save resolution" }).click();
  await expect(local.locator(".workflow-title")).toContainText("Executable");
  const versions = await request<{ definition: { description: string } }[]>(`/workflows/${loaded.workflowVersion.workflowId}/versions`);
  expect(versions[0].definition.description).toBe("My retained candidate");
  expect(versions[1].definition.description).toBe("Second remote revision");
});

test("Phase 3B reviewed comparison counts only reviewed pairs and marks provisional references outside the gate", async ({ page }) => {
  const loaded = await request<{ project: { id: string }; workflowVersion: { id: string }; suiteVersion: { id: string } }>("/examples/classification/load", "POST");
  const run = async () => {
    const queued = await request<{ id: string }>("/runs", "POST", { workflowVersionId: loaded.workflowVersion.id, suiteVersionId: loaded.suiteVersion.id,
      fixtureSetId: "classification", mode: "mock" });
    await expect.poll(async () => (await request<{ status: string }>(`/runs/${queued.id}`)).status, { timeout: 30000 }).toBe("completed");
    return queued.id;
  };
  const baselineId = await run();
  const candidateId = await run();
  const reviewed = await request<{ gate: string; cohort: { reviewedPairs: number }; cases: { scenarioId: string; classificationInGate: boolean; referenceLabel: { review: string } | null }[] }>("/comparisons", "POST", {
    baselineRunId: baselineId, candidateRunId: candidateId, policy: { basis: "reviewed_classification", strict: false, acceptMixedModel: false },
  });
  expect(reviewed.cohort.reviewedPairs).toBeGreaterThan(0);
  expect(reviewed.cases.some((item) => item.classificationInGate && item.referenceLabel?.review === "reviewed")).toBe(true);
  expect(reviewed.cases.some((item) => !item.classificationInGate && item.referenceLabel?.review !== "reviewed")).toBe(true);
  await open(page, loaded.project.id);
  await page.locator(".shell-nav:visible, .shell-mobile-nav:visible").getByRole("button", { name: "Compare" }).click();
  await page.getByLabel("Baseline run").selectOption(baselineId);
  await page.getByLabel("Candidate run").selectOption(candidateId);
  await page.getByLabel("Comparison basis").selectOption("reviewed_classification");
  await expect(page.locator(".compare-caveat")).toContainText(`${reviewed.cohort.reviewedPairs} reviewed evaluable pairs`);
  await expect(page.locator(".compare-table")).toContainText("not in gate");
  await expect(page.locator(".compare-gate-card")).toContainText(reviewed.gate);
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: `${screenshots}/desktop-classification-reviewed-outside-gate.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${screenshots}/mobile-classification-reviewed-outside-gate.png`, fullPage: true });
});

test("Phase 3B remainder setup keeps exact original snapshots and explicit start creates an immutable child", async ({ page }) => {
  const { loaded, baselineId, parentId } = await interruptedClassificationRun();
  const parentBefore = await request<unknown>(`/runs/${parentId}`);
  const parentSnapshotBefore = await request<unknown>(`/runs/${parentId}/snapshot`);
  const plan = await request<{ selectedScenarioIds: string[]; workflowVersionId: string; suiteVersionId: string; mode: string; profile: unknown }>(`/runs/${parentId}/rerun-plan`);
  expect(plan.selectedScenarioIds.length).toBeGreaterThan(0);
  let rerunPosts = 0;
  await open(page, loaded.project.id);
  await page.route(`**/api/v1/runs/${parentId}/rerun`, async (route) => {
    rerunPosts++;
    const source = new URL(route.request().url());
    const response = await route.fetch({ url: `${apiUrl}${source.pathname}`, headers: { "Content-Type": "application/json", "X-Pathsmith-Client": "local" } });
    await route.fulfill({ response });
  });
  await page.locator(".shell-nav:visible, .shell-mobile-nav:visible").getByRole("button", { name: "Compare" }).click();
  await page.getByLabel("Baseline run").selectOption(baselineId);
  await page.getByLabel("Candidate run").selectOption(parentId);
  await expect(page.locator(".compare-gate-card")).toContainText("inconclusive");
  await page.locator(".compare-remedies").getByRole("button", { name: /Run remaining cases/ }).click();
  await expect(page).toHaveURL(/#\/testset$/);
  await expect(page.locator(".test-run-grid .screen-banner")).toContainText(`Exact remaining ${plan.selectedScenarioIds.length} cases`);
  await expect(page.locator(".run-facts")).toContainText(plan.workflowVersionId.slice(0, 8));
  await expect(page.locator(".run-facts")).toContainText(plan.suiteVersionId.slice(0, 8));
  await expect(page.locator(".run-facts")).toContainText(`${plan.selectedScenarioIds.length} cases`);
  expect(rerunPosts).toBe(0);
  await page.getByRole("button", { name: `Run ${plan.selectedScenarioIds.length} remaining cases` }).click();
  await expect.poll(() => rerunPosts).toBe(1);
  await expect(page).toHaveURL(/#\/results$/);
  const childId = await page.getByLabel("Saved run").inputValue();
  expect(childId).not.toBe(parentId);
  await expect.poll(async () => (await request<{ status: string }>(`/runs/${childId}`)).status).toBe("completed");
  const child = await request<{ rerunOfRunId: string; workflowVersionId: string; suiteVersionId: string }>(`/runs/${childId}`);
  const childSnapshot = await request<{ selectedScenarioIds: string[]; profile: unknown }>(`/runs/${childId}/snapshot`);
  expect(child).toMatchObject({ rerunOfRunId: parentId, workflowVersionId: plan.workflowVersionId, suiteVersionId: plan.suiteVersionId });
  expect(childSnapshot.selectedScenarioIds).toEqual(plan.selectedScenarioIds);
  expect(childSnapshot.profile).toEqual(plan.profile);
  expect(await request<unknown>(`/runs/${parentId}`)).toEqual(parentBefore);
  expect(await request<unknown>(`/runs/${parentId}/snapshot`)).toEqual(parentSnapshotBefore);
});

test("Phase 3B delayed Compare remainder plan cannot reopen stale candidate, policy, or project", async ({ page }) => {
  test.setTimeout(60000);
  const { loaded, baselineId, parentId } = await interruptedClassificationRun();
  const third = await request<{ id: string }>("/runs", "POST", { workflowVersionId: loaded.workflowVersion.id,
    suiteVersionId: loaded.suiteVersion.id, fixtureSetId: "classification", mode: "mock" });
  await expect.poll(async () => (await request<{ status: string }>(`/runs/${third.id}`)).status).toBe("completed");
  const other = await request<{ project: { id: string } }>("/examples/classification/load", "POST");
  await open(page, loaded.project.id);
  await page.locator(".shell-nav:visible, .shell-mobile-nav:visible").getByRole("button", { name: "Compare" }).click();
  await page.getByLabel("Baseline run").selectOption(baselineId);
  await page.getByLabel("Candidate run").selectOption(parentId);
  const holdPlan = async () => {
    let started!: () => void, release!: () => void;
    const seen = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let completed = false;
    const handler = async (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
      const source = new URL(route.request().url());
      const response = await route.fetch({ url: `${apiUrl}${source.pathname}${source.search}` });
      started(); await gate; await route.fulfill({ response }); completed = true;
    };
    await page.route(`**/api/v1/runs/${parentId}/rerun-plan`, handler);
    return { seen, release, completed: () => completed, remove: () => page.unroute(`**/api/v1/runs/${parentId}/rerun-plan`, handler) };
  };
  for (const change of ["candidate", "policy", "project"] as const) {
    await expect(page.locator(".compare-remedies").getByRole("button", { name: /Run remaining cases/ })).toBeVisible();
    const held = await holdPlan();
    await page.locator(".compare-remedies").getByRole("button", { name: /Run remaining cases/ }).click();
    await held.seen;
    if (change === "candidate") await page.getByLabel("Candidate run").selectOption(third.id);
    else if (change === "policy") await page.getByLabel("Comparison basis").selectOption("reviewed_classification");
    else {
      await page.locator(".shell-nav:visible, .shell-mobile-nav:visible").getByRole("button", { name: "Overview" }).click();
      await page.locator(".overview-project-tools summary").click();
      await page.locator(".overview-project-tools").getByLabel("Switch project").selectOption(other.project.id);
      await expect(page).toHaveURL(new RegExp(`project=${other.project.id}`));
    }
    held.release();
    await expect.poll(held.completed).toBe(true);
    await held.remove();
    if (change === "project") {
      await expect(page).toHaveURL(/#\/overview$/);
      await expect(page.locator(".overview-project-tools").getByLabel("Switch project")).toHaveValue(other.project.id);
      await expect(page.locator(".screen-banner")).not.toContainText(`Run remaining cases from ${parentId.slice(0, 8)}`);
    } else {
      await expect(page).toHaveURL(/#\/compare$/);
      await expect(page.locator(".screen-banner")).toHaveCount(0);
      await page.getByLabel("Candidate run").selectOption(parentId);
    }
  }
  const runs = await request<{ items: { id: string }[] }>(`/runs?projectId=${loaded.project.id}&limit=50`);
  expect(runs.items.map((item) => item.id).sort()).toEqual([baselineId, parentId, third.id].sort());
});

test("Phase 3B delayed comparison remedy cannot copy a suite or reopen setup after owner navigation", async ({ page }) => {
  const baseline = await numericProject(3);
  const baselineId = await baseline.run();
  const candidate = await numericProject(2);
  const candidateId = await candidate.run();
  const before = await request<{ id: string }[]>(`/projects/${candidate.projectId}/suites`);
  let started!: () => void, release!: () => void;
  const seen = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let completed = false, browserQueues = 0;
  await open(page, candidate.projectId);
  await page.route(`**/api/v1/runs/${candidateId}/snapshot`, async (route) => {
    const source = new URL(route.request().url());
    const response = await route.fetch({ url: `${apiUrl}${source.pathname}` });
    started(); await gate; await route.fulfill({ response }); completed = true;
  });
  await page.route("**/api/v1/runs", async (route) => {
    if (route.request().method() === "POST") browserQueues++;
    await route.fulfill({ status: 599, json: { error: { code: "TEST_BLOCKED_RUN", message: "No queued run" } } });
  });
  await page.locator(".shell-nav:visible, .shell-mobile-nav:visible").getByRole("button", { name: "Compare" }).click();
  await page.getByLabel("Baseline run").selectOption(baselineId);
  await page.getByLabel("Candidate run").selectOption(candidateId);
  await expect(page.locator(".compare-remedies").getByRole("button", { name: /Use baseline test set and exact selection/ })).toBeVisible();
  await page.locator(".compare-remedies").getByRole("button", { name: /Use baseline test set and exact selection/ }).click();
  await seen;
  await page.locator(".shell-nav:visible, .shell-mobile-nav:visible").getByRole("button", { name: "Overview" }).click();
  await page.locator(".overview-project-tools summary").click();
  await page.locator(".overview-project-tools").getByLabel("Switch project").selectOption(baseline.projectId);
  await expect(page).toHaveURL(new RegExp(`project=${baseline.projectId}`));
  release();
  await expect.poll(() => completed).toBe(true);
  await expect(page).toHaveURL(/#\/overview$/);
  await expect(page.locator(".overview-project-tools").getByLabel("Switch project")).toHaveValue(baseline.projectId);
  expect(await request<{ id: string }[]>(`/projects/${candidate.projectId}/suites`)).toEqual(before);
  expect(browserQueues).toBe(0);
});

test("Phase 3B interrupted Live remainder requires fresh offline preflight and consent without provider POST", async ({ page }) => {
  const { loaded, baselineId, parentId } = await interruptedClassificationRun("live");
  const plan = await request<{ selectedScenarioIds: string[]; workflowVersionId: string; suiteVersionId: string; mode: string; profile: { bindings: Record<string, { model: string }> } }>(`/runs/${parentId}/rerun-plan`);
  expect(plan.mode).toBe("live");
  let livePosts = 0;
  await open(page, loaded.project.id);
  await page.route("**/api/v1/providers/status", async (route) => route.fulfill({ json: { allowedModes: ["mock", "replay", "live"], defaultMode: "mock",
    defaultHttpAttemptLimit: 200, maximumHttpAttemptLimit: 30000, providers: [{ id: "mock", configured: true, defaultModel: "mock-v1" },
      { id: "jev", configured: true, enabled: true, defaultModel: "jev-offline" }] } }));
  await page.route("**/api/v1/runs/preflight", async (route) => {
    const input = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({ json: { selectedScenarioIds: input.selectedScenarioIds, mode: "live",
      providerModels: [{ binding: "decisions", providerId: "jev", model: "jev-offline" }],
      maxJudgmentsPerCase: 1, maxProviderCalls: input.selectedScenarioIds.length, maxHttpAttempts: 24, attemptsPerCall: 3,
      concurrency: input.concurrency ?? 4, controls: { maxProviderCalls: input.selectedScenarioIds.length, stopAfterConsecutiveErrors: 2 },
      httpAttemptLimit: input.httpAttemptLimit, workflowVersionId: input.workflowVersionId, suiteVersionId: input.suiteVersionId } });
  });
  await page.route(`**/api/v1/runs/${parentId}/rerun`, async (route) => { livePosts++; await route.fulfill({ status: 599, json: { error: { code: "TEST_BLOCKED_LIVE", message: "No provider request" } } }); });
  await page.reload();
  await page.locator(".shell-nav:visible, .shell-mobile-nav:visible").getByRole("button", { name: "Compare" }).click();
  await page.getByLabel("Baseline run").selectOption(baselineId);
  await page.getByLabel("Candidate run").selectOption(parentId);
  await expect(page.locator(".compare-remedies").getByRole("button", { name: /Run remaining cases/ })).toBeVisible();
  await page.locator(".compare-remedies").getByRole("button", { name: /Run remaining cases/ }).click();
  await expect(page).toHaveURL(/#\/testset$/);
  await expect(page.locator(".test-run-grid .screen-banner")).toContainText(`Exact remaining ${plan.selectedScenarioIds.length} cases`);
  await expect(page.locator(".run-facts")).toContainText(plan.workflowVersionId.slice(0, 8));
  await expect(page.locator(".run-facts")).toContainText(plan.suiteVersionId.slice(0, 8));
  await expect(page.locator(".run-facts")).toContainText("Live");
  await expect(page.locator(".run-facts")).toContainText("jev-offline");
  const consent = page.getByLabel("I consent to the external requests shown above.");
  await expect(consent).toBeVisible();
  await expect(consent).not.toBeChecked();
  await expect(page.getByRole("button", { name: `Run ${plan.selectedScenarioIds.length} remaining cases` })).toBeDisabled();
  expect(livePosts).toBe(0);
  expect((await request<{ status: string }>(`/runs/${parentId}`)).status).toBe("interrupted");
});

test("Phase 3B same node ID changes start and transform target handles without losing drawn edges", async ({ page }) => {
  const seeded = await numericProject(1);
  await open(page, seeded.projectId);
  const startCard = page.locator('[data-canvas-node="start"]');
  await expect(startCard.locator(".react-flow__handle.target")).toHaveCount(0);
  await editJson(page, (definition) => {
    definition.nodes = [
      { id: "swap", label: "New start", kind: "start" },
      { id: "start", label: "Transformed", kind: "transform", value: { op: "literal", value: 1 } },
      { id: "finish", label: "Finish", kind: "output", outcomeId: "done", value: { op: "ref", path: ["outputs", "start"] } },
    ];
    definition.edges = [
      { id: "swap_next", source: "swap", port: "next", target: "start" },
      { id: "start_next", source: "start", port: "next", target: "finish" },
    ];
  });
  await page.getByRole("tab", { name: /Problems/ }).click();
  await expect(page.locator(".workflow-editor-wrap .canvas")).toHaveAttribute("data-fit-ready", "true");
  await expect(startCard.locator(".react-flow__handle.target")).toHaveCount(1);
  await expect(page.locator('.react-flow__edge[data-id="swap_next"] .react-flow__edge-path')).toHaveAttribute("d", /[ML]/);
  await editJson(page, (definition) => {
    definition.nodes = [
      { id: "start", label: "Start again", kind: "start" },
      { id: "finish", label: "Finish", kind: "output", outcomeId: "done", value: { op: "ref", path: ["input", "value"] } },
    ];
    definition.edges = [{ id: "start_next", source: "start", port: "next", target: "finish" }];
  });
  await page.getByRole("tab", { name: /Problems/ }).click();
  await expect(startCard.locator(".react-flow__handle.target")).toHaveCount(0);
  await expect(page.locator('.react-flow__edge[data-id="start_next"] .react-flow__edge-path')).toHaveAttribute("d", /[ML]/);
  await expect(page.locator(".workflow-title")).toContainText("Draft");
});
