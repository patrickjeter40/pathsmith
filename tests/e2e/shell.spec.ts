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
  return errors;
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
    page.getByRole("heading", { name: "Inspect the decision path." }),
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
