import { readFileSync } from "node:fs";
import {
  type ExecutionProfile,
  type Fixtures,
  type Json,
  type Suite,
  type Workflow,
} from "@pathsmith/contracts";
import { StorageError } from "@pathsmith/storage";

const catalog = [
  {
    id: "gaming",
    name: "Gaming",
    description:
      "Player reports, chat moderation, engagement, churn, and support routing.",
    fixtureSetId: "gaming",
    folder: "gaming",
    workflowFile: "workflow.json",
  },
  {
    id: "support-baseline",
    name: "Support routing — baseline",
    description:
      "Twelve labeled support cases, including one existing assertion failure.",
    fixtureSetId: "support-routing",
    folder: "support-routing",
    workflowFile: "baseline.workflow.json",
  },
  {
    id: "support-candidate",
    name: "Support routing — candidate",
    description:
      "The candidate routing policy for the same twelve support cases.",
    fixtureSetId: "support-routing",
    folder: "support-routing",
    workflowFile: "candidate.workflow.json",
  },
] as const;
const read = (folder: string, file: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../examples/${folder}/${file}`, import.meta.url),
      "utf8",
    ),
  );
export const listExamples = () =>
  catalog.map(({ id, name, description, fixtureSetId }) => ({
    id,
    name,
    description,
    fixtureSetId,
  }));
export function loadExample(id: string) {
  const item = catalog.find((item) => item.id === id);
  if (!item) throw new StorageError("NOT_FOUND", "Example not found");
  return {
    ...item,
    workflow: read(item.folder, item.workflowFile) as Workflow,
    suite: read(item.folder, "suite.json") as Suite,
    layout:
      item.folder === "support-routing"
        ? (read(item.folder, "layout.json") as Json)
        : {},
    ...loadFixtureSet(item.fixtureSetId),
  };
}
export function loadFixtureSet(id: string): {
  fixtures: Fixtures;
  profile: ExecutionProfile;
} {
  // The caller selects a fixed catalog key; no request value becomes a path.
  const folder =
    id === "gaming"
      ? "gaming"
      : id === "support-routing"
        ? "support-routing"
        : undefined;
  if (!folder) throw new StorageError("NOT_FOUND", "Fixture set not found");
  return {
    fixtures: read(folder, "mock-fixtures.json") as Fixtures,
    profile: read(folder, "mock.profile.json") as ExecutionProfile,
  };
}
