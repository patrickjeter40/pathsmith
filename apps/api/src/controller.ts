import { MAX_HTTP_ATTEMPTS } from "@pathsmith/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  validateWorkflow,
  type ExecutionProfile,
  type Workflow,
} from "@pathsmith/contracts";
import type { ExecutionLimits, ExecutionMode, RunControls } from "@pathsmith/core";
import { CLASSIFICATION_VERDICTS, REVIEWED_CLASSIFICATION_VERDICTS, type ClassificationVerdict, type ReviewedClassificationVerdict } from "@pathsmith/evaluation";
import { LocalApplication, type ClassificationReport, type RunRequest } from "./service.js";
import {
  badRequest,
  confirmed,
  envelope,
  identifier,
  pagination,
  revision,
  selection,
  textValue,
} from "./inputs.js";
import { listExamples } from "./examples.js";

@Controller("api/v1")
export class ApiController {
  constructor(
    @Inject(LocalApplication) private readonly local: LocalApplication,
  ) {}
  @Get("health") health() {
    return {
      service: "pathsmith",
      status: this.local.storageFailed ? "degraded" : "ready",
      milestone: "M5",
      database: {
        status: this.local.storageFailed ? "error" : "ready",
        schemaVersion: this.local.storage.schemaVersion,
      },
    };
  }
  @Get("providers/status") providers() {
    return this.local.providerStatus();
  }
  @Get("examples") examples() {
    return listExamples();
  }
  @Post("examples/:id/load") load(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    envelope(body ?? {}, []);
    return this.local.loadExample(identifier(id));
  }
  @Get("projects") projects() {
    return this.local.storage.listProjects(this.local.context);
  }
  @Post("projects") createProject(@Body() value: unknown) {
    const body = envelope(value, ["name"], ["name"]);
    return this.local.storage.createProject(
      this.local.context,
      textValue(body.name),
    );
  }
  @Post("projects/import") importProject(@Body() value: unknown) {
    const body = envelope(value, ["artifact"], ["artifact"]);
    return this.local.storage.importProject(this.local.context, body.artifact);
  }
  @Get("projects/:id/export") exportProject(@Param("id") id: string) {
    return this.local.storage.exportProject(this.local.context, identifier(id));
  }
  @Get("projects/:id") project(@Param("id") id: string) {
    return this.local.storage.getProject(this.local.context, identifier(id));
  }
  @Delete("projects/:id") @HttpCode(204) deleteProject(
    @Param("id") id: string,
    @Body() value: unknown,
  ) {
    confirmed(value);
    this.local.storage.deleteProject(this.local.context, identifier(id));
  }
  @Get("projects/:id/workflows") workflows(@Param("id") id: string) {
    return this.local.storage.listWorkflows(this.local.context, identifier(id));
  }
  @Post("projects/:id/workflows") createWorkflow(
    @Param("id") id: string,
    @Body() value: unknown,
  ) {
    const body = envelope(value, ["name", "definition", "layout"], ["name"]);
    return this.local.storage.createWorkflow(
      this.local.context,
      identifier(id),
      {
        name: textValue(body.name),
        ...(Object.hasOwn(body, "definition")
          ? { definition: body.definition }
          : {}),
        ...(Object.hasOwn(body, "layout") ? { layout: body.layout } : {}),
      },
    );
  }
  @Get("workflows/:id") workflow(@Param("id") id: string) {
    return this.local.storage.getWorkflow(this.local.context, identifier(id));
  }
  @Put("workflows/:id/draft") saveWorkflow(
    @Param("id") id: string,
    @Body() value: unknown,
  ) {
    const body = envelope(
      value,
      ["expectedRevision", "definition", "layout"],
      ["expectedRevision", "definition"],
    );
    return this.local.storage.saveWorkflowDraft(
      this.local.context,
      identifier(id),
      {
        expectedRevision: revision(body.expectedRevision),
        definition: body.definition,
        ...(Object.hasOwn(body, "layout") ? { layout: body.layout } : {}),
      },
    );
  }
  @Post("workflows/:id/save-version") saveWorkflowVersion(@Param("id") id: string, @Body() value: unknown) {
    const body = envelope(value, ["expectedRevision", "definition", "layout"], ["expectedRevision", "definition", "layout"]);
    return this.local.storage.saveWorkflowVersion(this.local.context, identifier(id), {
      expectedRevision: revision(body.expectedRevision), definition: body.definition, layout: body.layout,
    });
  }
  @Post("workflows/:id/validate") @HttpCode(200) validateWorkflow(
    @Param("id") id: string,
    @Body() value: unknown,
  ) {
    envelope(value ?? {}, []);
    return validateWorkflow(
      this.local.storage.getWorkflow(this.local.context, identifier(id))
        .definition,
    );
  }
  @Get("workflows/:id/versions") workflowVersions(@Param("id") id: string) {
    return this.local.storage.listWorkflowVersions(
      this.local.context,
      identifier(id),
    );
  }
  @Post("workflows/:id/versions") publishWorkflow(
    @Param("id") id: string,
    @Body() value: unknown,
  ) {
    const body = envelope(value, ["expectedRevision"], ["expectedRevision"]);
    return this.local.storage.publishWorkflowVersion(
      this.local.context,
      identifier(id),
      revision(body.expectedRevision),
    );
  }
  @Get("workflow-versions/:id") workflowVersion(@Param("id") id: string) {
    return this.local.storage.getWorkflowVersion(
      this.local.context,
      identifier(id),
    );
  }
  @Get("workflow-versions/:id/export") exportWorkflow(
    @Param("id") id: string,
  ): Workflow {
    return this.local.storage.getWorkflowVersion(
      this.local.context,
      identifier(id),
    ).definition;
  }
  @Get("projects/:id/suites") suites(@Param("id") id: string) {
    return this.local.storage.listSuites(this.local.context, identifier(id));
  }
  @Post("projects/:id/suites") createSuite(
    @Param("id") id: string,
    @Body() value: unknown,
  ) {
    const body = envelope(value, ["name", "definition"], ["name"]);
    return this.local.storage.createSuite(this.local.context, identifier(id), {
      name: textValue(body.name),
      ...(Object.hasOwn(body, "definition")
        ? { definition: body.definition }
        : {}),
    });
  }
  @Get("suites/:id") suite(@Param("id") id: string) {
    return this.local.storage.getSuite(this.local.context, identifier(id));
  }
  @Put("suites/:id/draft") saveSuite(
    @Param("id") id: string,
    @Body() value: unknown,
  ) {
    const body = envelope(
      value,
      ["expectedRevision", "definition", "workflowVersionId"],
      ["expectedRevision", "definition"],
    );
    return this.local.storage.saveSuiteDraft(
      this.local.context,
      identifier(id),
      {
        expectedRevision: revision(body.expectedRevision),
        definition: body.definition,
        ...(Object.hasOwn(body, "workflowVersionId")
          ? { workflowVersionId: identifier(body.workflowVersionId) }
          : {}),
      },
    );
  }
  @Get("suites/:id/versions") suiteVersions(@Param("id") id: string) {
    return this.local.storage.listSuiteVersions(
      this.local.context,
      identifier(id),
    );
  }
  @Post("suites/:id/versions") publishSuite(
    @Param("id") id: string,
    @Body() value: unknown,
  ) {
    const body = envelope(
      value,
      ["expectedRevision", "workflowVersionId"],
      ["expectedRevision", "workflowVersionId"],
    );
    return this.local.storage.publishSuiteVersion(
      this.local.context,
      identifier(id),
      identifier(body.workflowVersionId),
      revision(body.expectedRevision),
    );
  }
  @Get("suite-versions/:id") suiteVersion(@Param("id") id: string) {
    return this.local.storage.getSuiteVersion(
      this.local.context,
      identifier(id),
    );
  }
  @Post("runs") @HttpCode(202) queue(@Body() value: unknown) {
    return this.local.queue(this.runInput(value));
  }
  @Post("runs/preflight") @HttpCode(200) preflight(@Body() value: unknown) {
    return this.local.preflight(this.runInput(value, true));
  }
  @Get("runs/:id/rerun-plan") rerunPlan(@Param("id") id: string) {
    return this.local.storage.remainderPlan(this.local.context, identifier(id));
  }
  @Post("runs/:id/rerun") @HttpCode(202) rerun(@Param("id") id: string, @Body() value: unknown) {
    const body = envelope(value, ["scope", "confirmLive", "controls", "httpAttemptLimit"], ["scope"]);
    if (body.scope !== "remaining") badRequest("Select the remaining case scope");
    if (body.confirmLive !== undefined && body.confirmLive !== true) badRequest("Explicit live confirmation must be true");
    this.attemptLimit(body.httpAttemptLimit);
    return this.local.rerun(identifier(id), { confirmLive: body.confirmLive as true | undefined,
      controls: this.controls(body.controls), httpAttemptLimit: body.httpAttemptLimit as number | undefined });
  }
  private controls(value: unknown): RunControls | undefined {
    if (value === undefined) return undefined;
    const body = envelope(value, ["maxProviderCalls", "stopAfterConsecutiveErrors"], ["maxProviderCalls", "stopAfterConsecutiveErrors"]);
    if (!Number.isSafeInteger(body.maxProviderCalls) || (body.maxProviderCalls as number) < 0 ||
      !Number.isSafeInteger(body.stopAfterConsecutiveErrors) || (body.stopAfterConsecutiveErrors as number) < 1 || (body.stopAfterConsecutiveErrors as number) > 20)
      badRequest("Provider call cap must be a nonnegative integer and consecutive error stop must be 1–20");
    return body as unknown as RunControls;
  }
  private attemptLimit(value: unknown): void {
    if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_HTTP_ATTEMPTS))
      badRequest("HTTP attempt limit must be between 1 and 30,000");
  }
  private runInput(value: unknown, preflight = false): RunRequest {
    const body = envelope(
      value,
      [
        "workflowVersionId",
        "suiteVersionId",
        "fixtureSetId",
        "mode",
        "profile",
        "selectedScenarioIds",
        "limits",
        "concurrency",
        "sourceRunId",
        "confirmLive",
        "httpAttemptLimit",
        "controls",
      ],
      ["workflowVersionId", "suiteVersionId"],
    );
    const mode = body.mode ?? "mock";
    if (!["mock", "replay", "live"].includes(mode as string))
      badRequest("Unknown execution mode");
    if (
      mode === "mock" &&
      (body.fixtureSetId === undefined ||
        body.sourceRunId !== undefined ||
        body.confirmLive !== undefined)
    )
      badRequest("Mock mode requires a fixture set only");
    if (
      mode === "replay" &&
      (body.sourceRunId === undefined ||
        body.fixtureSetId !== undefined ||
        body.confirmLive !== undefined)
    )
      badRequest("Replay requires a source run only");
    if (
      mode === "live" &&
      ((!preflight && body.confirmLive !== true) ||
        body.fixtureSetId !== undefined ||
        body.sourceRunId !== undefined)
    )
      badRequest(
        "Live mode requires explicit confirmation and no fixture or replay source",
      );
    if (
      body.httpAttemptLimit !== undefined &&
      (!Number.isSafeInteger(body.httpAttemptLimit) ||
        (body.httpAttemptLimit as number) < 1 ||
        (body.httpAttemptLimit as number) > MAX_HTTP_ATTEMPTS)
    )
      badRequest("HTTP attempt limit must be between 1 and 30,000");
    if (body.profile !== undefined)
      envelope(
        body.profile,
        ["formatVersion", "bindings"],
        ["formatVersion", "bindings"],
      );
    if (body.limits !== undefined)
      envelope(body.limits, [
        "expressionOperations",
        "scenarioDeadlineMs",
        "providerRequestBytes",
        "providerResponseBytes",
        "computedValueBytes",
        "scenarioArtifactBytes",
      ]);
    if (
      body.concurrency !== undefined &&
      (!Number.isSafeInteger(body.concurrency) ||
        (body.concurrency as number) < 1 ||
        (body.concurrency as number) > 16)
    )
      badRequest("Concurrency must be between 1 and 16");
    return {
      workflowVersionId: identifier(body.workflowVersionId),
      suiteVersionId: identifier(body.suiteVersionId),
      mode: mode as ExecutionMode,
      fixtureSetId:
        body.fixtureSetId !== undefined
          ? identifier(body.fixtureSetId)
          : undefined,
      sourceRunId:
        body.sourceRunId !== undefined
          ? identifier(body.sourceRunId)
          : undefined,
      confirmLive: body.confirmLive as boolean | undefined,
      httpAttemptLimit: body.httpAttemptLimit as number | undefined,
      controls: this.controls(body.controls),
      profile: body.profile as unknown as ExecutionProfile | undefined,
      limits: body.limits as Partial<ExecutionLimits> | undefined,
      selectedScenarioIds: selection(body.selectedScenarioIds),
      concurrency: body.concurrency as number | undefined,
    };
  }
  @Get("runs") runs(@Query() query: Record<string, unknown>) {
    const page = pagination(query, ["projectId"]);
    return this.local.history({
      ...page,
      ...(query.projectId !== undefined
        ? { projectId: identifier(query.projectId) }
        : {}),
    });
  }
  @Post("comparisons") @HttpCode(200) compare(@Body() value: unknown) {
    const body = envelope(
      value,
      ["baselineRunId", "candidateRunId", "policy"],
      ["baselineRunId", "candidateRunId", "policy"],
    );
    const policy = envelope(
      body.policy,
      ["strict", "acceptMixedModel", "basis"],
      ["strict", "acceptMixedModel"],
    );
    if (
      typeof policy.strict !== "boolean" ||
      typeof policy.acceptMixedModel !== "boolean"
    )
      badRequest("Comparison policy values must be booleans");
    if (policy.basis !== undefined && !["assertions", "reviewed_classification"].includes(policy.basis as string))
      badRequest("Unsupported comparison basis");
    return this.local.compare(
      identifier(body.baselineRunId),
      identifier(body.candidateRunId),
      {
        strict: policy.strict as boolean,
        acceptMixedModel: policy.acceptMixedModel as boolean,
        basis: policy.basis as "assertions" | "reviewed_classification" | undefined,
      },
    );
  }
  @Get("runs/:id") run(@Param("id") id: string) {
    return this.local.view(
      this.local.storage.getRunOverview(this.local.context, identifier(id)),
    );
  }
  @Get("runs/:id/export") exportRun(@Param("id") id: string) {
    return this.local.exportRun(identifier(id));
  }
  @Get("runs/:id/classification") classification(@Param("id") id:string, @Query() query: Record<string, unknown>): ClassificationReport {
    if (Object.keys(query).some((key) => key !== "labelsSuiteVersionId")) badRequest("Unsupported scoring query");
    return this.local.classificationReport(identifier(id), query.labelsSuiteVersionId === undefined ? undefined : identifier(query.labelsSuiteVersionId));
  }
  @Get("runs/:id/classification/rows") classificationRows(@Param("id") id:string,@Query() query:Record<string,unknown>) {
    const page=pagination(query,["verdict","reviewedVerdict","review","tag","labelsSuiteVersionId"]);
    if (query.verdict!==undefined && !CLASSIFICATION_VERDICTS.includes(query.verdict as ClassificationVerdict)) badRequest("Unknown result filter");
    if (query.reviewedVerdict!==undefined && (typeof query.reviewedVerdict!=="string" || !REVIEWED_CLASSIFICATION_VERDICTS.includes(query.reviewedVerdict as ReviewedClassificationVerdict))) badRequest("Unknown reviewed result filter");
    if (query.review!==undefined && !["reviewed","provisional"].includes(query.review as string)) badRequest("Unknown label review filter");
    if (query.tag!==undefined && (typeof query.tag!=="string" || query.tag.length>200)) badRequest("Invalid tag filter");
    return this.local.classificationRows(identifier(id),{...page,verdict:query.verdict as ClassificationVerdict|undefined,
      reviewedVerdict:query.reviewedVerdict as ReviewedClassificationVerdict|undefined,
      review:query.review as string|undefined,tag:query.tag as string|undefined,labelsSuiteVersionId:query.labelsSuiteVersionId===undefined?undefined:identifier(query.labelsSuiteVersionId)});
  }
  @Get("runs/:id/classification/export") exportClassification(@Param("id") id:string,@Query() query:Record<string,unknown>) {
    if (Object.keys(query).some((key)=>!["format","labelsSuiteVersionId"].includes(key)) || !["json","csv"].includes(query.format as string)) badRequest("Select json or csv export format");
    return this.local.exportClassification(identifier(id),query.format as "json"|"csv",query.labelsSuiteVersionId===undefined?undefined:identifier(query.labelsSuiteVersionId));
  }
  @Get("runs/:id/snapshot") snapshot(@Param("id") id: string) {
    return this.local.snapshot(identifier(id));
  }
  @Get("runs/:id/coverage") coverage(@Param("id") id: string) {
    return { coverage: this.local.coverage(identifier(id)) };
  }
  @Get("runs/:id/scenarios") scenarios(
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
  ) {
    const page = pagination(query, ["status", "assertionStatus"]);
    if (
      query.status !== undefined &&
      !["completed", "failed", "canceled"].includes(query.status as string)
    )
      badRequest("Unknown execution status filter");
    if (
      query.assertionStatus !== undefined &&
      !["passed", "failed", "not_evaluated"].includes(
        query.assertionStatus as string,
      )
    )
      badRequest("Unknown assertion status filter");
    return this.local.scenarios(identifier(id), {
      ...page,
      status: query.status as string | undefined,
      assertionStatus: query.assertionStatus as string | undefined,
    });
  }
  @Get("scenario-runs/:id/trace") trace(@Param("id") id: string) {
    return this.local.storage.getScenarioTrace(
      this.local.context,
      identifier(id),
    );
  }
  @Post("runs/:id/cancel") @HttpCode(200) cancel(
    @Param("id") id: string,
    @Body() value: unknown,
  ) {
    envelope(value ?? {}, []);
    return this.local.cancel(identifier(id));
  }
  @Delete("runs/:id") @HttpCode(204) deleteRun(
    @Param("id") id: string,
    @Body() value: unknown,
  ) {
    confirmed(value);
    this.local.storage.deleteRun(this.local.context, identifier(id));
  }
}
