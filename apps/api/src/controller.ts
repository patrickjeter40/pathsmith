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
import type { ExecutionLimits } from "@pathsmith/core";
import { LocalApplication } from "./service.js";
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
      milestone: "M2",
      database: {
        status: this.local.storageFailed ? "error" : "ready",
        schemaVersion: this.local.storage.schemaVersion,
      },
    };
  }
  @Get("providers/status") providers() {
    return {
      allowedModes: ["mock"],
      defaultMode: "mock",
      providers: [
        { id: "mock", configured: true, defaultModel: "mock-v1" },
        { id: "jev", configured: false, implementation: "deferred-to-M4" },
      ],
    };
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
      ],
      ["workflowVersionId", "suiteVersionId", "fixtureSetId", "mode"],
    );
    if (body.mode !== "mock") badRequest("Only mock mode is implemented");
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
    return this.local.queue({
      workflowVersionId: identifier(body.workflowVersionId),
      suiteVersionId: identifier(body.suiteVersionId),
      fixtureSetId: identifier(body.fixtureSetId),
      profile: body.profile as unknown as ExecutionProfile | undefined,
      limits: body.limits as Partial<ExecutionLimits> | undefined,
      selectedScenarioIds: selection(body.selectedScenarioIds),
      concurrency: body.concurrency as number | undefined,
    });
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
  @Get("runs/:id") run(@Param("id") id: string) {
    return this.local.view(
      this.local.storage.getRun(this.local.context, identifier(id)),
    );
  }
  @Get("runs/:id/snapshot") snapshot(@Param("id") id: string) {
    return this.local.snapshot(identifier(id));
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
