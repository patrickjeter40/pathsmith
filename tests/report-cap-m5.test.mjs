import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {byteLength} from "@pathsmith/contracts";
import {runSuite,MAX_REPORT_BYTES} from "@pathsmith/evaluation";
import {openStorage} from "../packages/storage/dist/index.js";
import {minimal,literal,ref} from "./helpers.mjs";

test("report cap reserves all 10,000 rows and persists honest partial results",{skip:process.env.PATHSMITH_REPORT_CAP_TEST!=="1",timeout:300000},async t=>{
  const dataDir=mkdtempSync(join(tmpdir(),"pathsmith-cap-"));
  const storage=openStorage({dataDir});
  t.after(()=>{storage.close();rmSync(dataDir,{recursive:true,force:true});});
  const ctx=storage.localContext,workflow=minimal();
  workflow.nodes.splice(1,0,{id:"expand",kind:"transform",label:"Large value",value:literal("x".repeat(128*1024))});
  workflow.nodes.at(-1).value=ref("outputs","expand");workflow.outputSchema={type:"string"};
  workflow.edges=[{id:"e1",source:"start",port:"next",target:"expand"},{id:"e2",source:"expand",port:"next",target:"finish"}];
  const suite={formatVersion:"0.1",id:"cap_cases",name:"Cap",description:"Offline report bound",scenarios:Array.from({length:10000},(_,i)=>({id:`row_${i}`,name:`Row ${i}`,tags:[],input:{value:i}}))};
  const project=storage.createProject(ctx,"Cap");
  const w=storage.createWorkflow(ctx,project.id,{name:"Cap",definition:workflow}),wv=storage.publishWorkflowVersion(ctx,w.id);
  const s=storage.createSuite(ctx,project.id,{name:"Cap",definition:suite}),sv=storage.publishSuiteVersion(ctx,s.id,wv.id);
  const run=storage.queueRun(ctx,{workflowVersionId:wv.id,suiteVersionId:sv.id,profile:{formatVersion:"0.1",bindings:{}},fixtures:{formatVersion:"0.1",origin:"synthetic",description:"No judgments",entries:[]}});
  storage.claimNextRun(ctx);
  const report=await runSuite({workflow,suite,bindings:{},mode:"mock",runId:run.id,projectId:project.id,workspaceId:ctx.workspaceId,
    onScenario:r=>{storage.appendScenarioResult(ctx,run.id,r);}});
  assert.equal(report.error.code,"RUN_LIMIT_EXCEEDED");assert.equal(report.status,"failed");
  assert.equal(report.scenarios.length,10000);assert.ok(report.summary.completed>0);assert.ok(report.summary.canceled>0);
  assert.equal(report.summary.completed+report.summary.failedExecution+report.summary.canceled,10000);
  const bytes=byteLength(report);assert.ok(bytes<=MAX_REPORT_BYTES,`${bytes} exceeds ${MAX_REPORT_BYTES}`);
  storage.finishRun(ctx,run.id,report);
  assert.equal(storage.getRunOverview(ctx,run.id).status,"failed");
  assert.equal(storage.listScenarioSummaries(ctx,run.id).total,10000);
  t.diagnostic(JSON.stringify({bytes,cap:MAX_REPORT_BYTES,completed:report.summary.completed,failed:report.summary.failedExecution,canceled:report.summary.canceled}));
});
