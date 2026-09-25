import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("shell validates both examples and exports the actual imported JSON", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname)
      ? route.continue()
      : route.abort();
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Inspect the decision path." }),
  ).toBeVisible();
  await expect(page.getByText("API ready", { exact: false })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("✓ Valid definition");
  await expect(page.locator(".react-flow__node")).toHaveCount(13);
  await page.getByLabel("Example definition").selectOption("candidate");
  await page
    .getByRole("button", { name: "JSON definition", exact: true })
    .click();
  const text = await page
    .getByLabel("Workflow JSON", { exact: true })
    .inputValue();
  expect(
    JSON.parse(text).nodes.find(
      (n: { id: string }) => n.id === "confidence_gate",
    ).cases[0].when.right.value,
  ).toBe(0.8);
  await page.getByLabel("Workflow JSON", { exact: true }).fill("{");
  await expect(page.getByRole("status")).toContainText("problem");
  await expect(
    page.getByRole("button", { name: "Export workflow" }),
  ).toBeDisabled();
  await page
    .getByLabel("Import workflow JSON")
    .setInputFiles("examples/support-routing/baseline.workflow.json");
  await expect(page.getByRole("status")).toHaveText("✓ Valid definition");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workflow" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(JSON.parse(await readFile(path!, "utf8"))).toEqual(
    JSON.parse(
      await readFile("examples/support-routing/baseline.workflow.json", "utf8"),
    ),
  );
  expect(errors).toEqual([]);
});
test("small viewport keeps primary controls usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "JSON definition", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export workflow" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
