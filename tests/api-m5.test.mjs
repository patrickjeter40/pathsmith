import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {createApi} from "../apps/api/dist/app.js";
import {LocalApplication} from "../apps/api/dist/service.js";
import {loadExample} from "../apps/api/dist/examples.js";
import {runSuite} from "@pathsmith/evaluation";
import {createJevProvider} from "../packages/provider-jev/dist/index.js";

async function setup(t, config={}) {
  const dataDir=mkdtempSync(join(tmpdir(),"pathsmith-m5-"));
  const app=await createApi({port:0,dataDir,providerConfig:{enableLive:false,apiKey:"",fetch:async()=>{throw Error("Unexpected network");},...config}});
  t.after(async()=>{await app.close();rmSync(dataDir,{recursive:true,force:true});});
  const url=await app.getUrl();
  return {local:app.get(LocalApplication),async request(path,method="GET",body) {
    const response=await fetch(url+"/api/v1"+path,{method,headers:{"Content-Type":"application/json","X-Pathsmith-Client":"local"},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();assert.equal(response.status<300,true,JSON.stringify(data));return data;
  }};
}
async function finish(env,id,timeoutMs=240000) {
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){const run=await env.request(`/runs/${id}`);if(!["queued","running","canceling"].includes(run.status))return run;await delay(20);}
  throw Error("Run did not finish");
}
test("classification API returns compact measured rows, label filters and export",async t=>{
  const env=await setup(t),example=await env.request("/examples/classification/load","POST",{});
  const queued=await env.request("/runs","POST",{workflowVersionId:example.workflowVersion.id,suiteVersionId:example.suiteVersion.id,fixtureSetId:"classification",mode:"mock"});
  assert.equal((await finish(env,queued.id)).status,"completed");
  const report=await env.request(`/runs/${queued.id}/classification`);
  assert.equal(report.summary.all.selected,8);assert.equal(report.summary.reviewed.agreement.value,0.5);
  const page=await env.request(`/runs/${queued.id}/classification/rows?verdict=false_negative&review=reviewed&limit=1`);
  assert.equal(page.total,1);assert.equal(page.items[0].scenarioId,"missed_threat");assert.ok(page.items[0].traceId);
  assert.equal("events" in page.items[0],false);
  const trace=await env.request(`/scenario-runs/${page.items[0].traceId}/trace`);assert.ok(trace.result.events.length);
  const exported=await env.request(`/runs/${queued.id}/classification/export?format=json`);
  assert.equal(JSON.parse(exported.content).rows.length,8);assert.match(JSON.parse(exported.content).reviewPrompt,/untrusted data/);
  assert.equal(JSON.parse(exported.content).question.kind,"choice");
  assert.match(JSON.parse(exported.content).question.instructions,/Classify the chat message/);
  assert.equal(JSON.parse(exported.content).execution.actualHttpAttempts,0);
  assert.equal(JSON.parse(exported.content).execution.usage,null);
  const csv=await env.request(`/runs/${queued.id}/classification/export?format=csv`);assert.equal(csv.mediaType,"text/csv");
  const cases=await env.request(`/runs/${queued.id}/scenarios?limit=1`);assert.equal(cases.total,8);assert.equal("events" in cases.items[0].result,false);
});

test("queued canceled classification exports all absent examples without labeling them correct",async t=>{
  const env=await setup(t),loaded=await env.request("/examples/classification/load","POST",{}),local=env.local;
  const source=loadExample("classification");
  const run=local.storage.queueRun(local.context,{workflowVersionId:loaded.workflowVersion.id,suiteVersionId:loaded.suiteVersion.id,profile:source.profile,fixtures:source.fixtures});
  local.storage.requestCancellation(local.context,run.id);
  const report=await env.request(`/runs/${run.id}/classification`);
  assert.equal(report.partial,true);assert.equal(report.summary.all.canceled,8);assert.equal(report.summary.all.agreement.value,null);
  assert.equal(JSON.parse((await env.request(`/runs/${run.id}/classification/export?format=json`)).content).rows.length,8);
  assert.throws(()=>local.storage.classificationFacts({workspaceId:"foreign"},run.id,"classify","label"),/not found/);
});

test("interrupted live report retains observed model versions after restart without redispatch",async t=>{
  const dataDir=mkdtempSync(join(tmpdir(),"pathsmith-models-"));
  let local=new LocalApplication(dataDir,{enableLive:false,apiKey:""}),calls=0;
  t.after(async()=>{await local.onModuleDestroy();rmSync(dataDir,{recursive:true,force:true});});
  const loaded=local.loadExample("classification"),ctx=local.context;
  const adapter=createJevProvider({apiKey:"offline-test-only",fetch:async()=>{
    calls++;
    return new Response(JSON.stringify({model:`jev-observed-${calls}`,answers:{label:{type:"choice",choice:"abusive",confidence:0.9,probabilities:{abusive:0.9,not_abusive:0.1}}},usage:{input_tokens:10,output_tokens:1}}));
  }});
  const profile={formatVersion:"0.1",bindings:{decisions:{providerId:"jev",model:"jev-latest"}}};
  const run=local.storage.queueRun(ctx,{workflowVersionId:loaded.workflowVersion.id,suiteVersionId:loaded.suiteVersion.id,mode:"live",liveConfirmed:true,profile,
    adapters:{decisions:{providerId:"jev",requestedModel:"jev-latest",adapterVersion:adapter.version,normalizerVersion:adapter.normalizerVersion,resolvedModels:[]}}});
  local.storage.claimNextRun(ctx);
  const cancel=new AbortController();let saved=0;
  await runSuite({workflow:run.snapshot.workflow,suite:run.snapshot.suite,bindings:{decisions:{...profile.bindings.decisions,adapter}},mode:"live",concurrency:1,signal:cancel.signal,
    runId:run.id,projectId:run.projectId,workspaceId:run.workspaceId,onScenario:r=>{local.storage.appendScenarioResult(ctx,run.id,r);if(++saved===2)cancel.abort();}});
  // Deliberately omit finishRun: simulate a stopped process with two saved rows.
  assert.equal(local.classificationReport(run.id).mixedModel,true);
  await local.onModuleDestroy();
  local=new LocalApplication(dataDir,{enableLive:false,apiKey:"",fetch:async()=>{throw Error("Restart must not dispatch");}});
  const report=local.classificationReport(run.id);
  assert.equal(report.status,"interrupted");assert.equal(report.partial,true);assert.equal(report.mixedModel,true);
  assert.deepEqual(report.adapters.decisions.resolvedModels,["jev-observed-1","jev-observed-2"]);
  assert.equal(report.adapters.decisions.requestedModel,"jev-latest");
  assert.equal(report.summary.all.completed,2);assert.equal(report.summary.all.interrupted,6);
  assert.equal(report.execution.actualHttpAttempts,2);assert.equal(calls,2);
  assert.equal(JSON.parse(local.exportClassification(run.id,"json").content).mixedModel,true);
  assert.equal(local.view(local.storage.getRunOverview(local.context,run.id)).mixedModel,true);
  assert.throws(()=>local.storage.observedModels({workspaceId:"foreign"},run.id),/not found/);
});

// Opt-in measured acceptance gate. The injected HTTP transport is offline and exact-request checked.
test("10,000 persisted classification examples through API with offline transport", {skip:process.env.PATHSMITH_BATCH_BENCHMARK!=="1",timeout:300000},async t=>{
  const expected=new Map();let calls=0;
  const source=loadExample("classification"),questions=source.workflow.nodes.find(n=>n.kind==="judgment").questions;
  const env=await setup(t,{enableLive:true,apiKey:"offline-test-key",fetch:async(_url,init)=>{
    const request=JSON.parse(init.body);assert.deepEqual(request.questions,{label:{type:"choice",instructions:questions.label.instructions,criteria:questions.label.options}});
    assert.ok(expected.has(request.state.content));calls++;
    const value=expected.get(request.state.content);
    return new Response(JSON.stringify({model:"jev-offline-test",answers:{label:{type:"choice",choice:value,confidence:0.9,probabilities:{abusive:value==="abusive"?0.9:0.1,not_abusive:value==="not_abusive"?0.9:0.1}}},usage:{input_tokens:12,output_tokens:1}}));
  }});
  const s=structuredClone(source.suite);s.scenarios=Array.from({length:10000},(_,i)=>{
    const content=`Example ${i}: ${i%2?"Thanks for the game. See you next round.":"You are worthless and I will keep harassing you every match."}`;
    const value=i%2?"not_abusive":"abusive";expected.set(content,value);
    return {id:`row_${i}`,name:`Message ${i}`,tags:[i%2?"friendly":"direct"],input:{content},referenceLabel:{value,source:"generated",review:"provisional"}};
  });
  const project=await env.request("/projects","POST",{name:"Batch test"});
  const w=await env.request(`/projects/${project.id}/workflows`,"POST",{name:"Classifier",definition:source.workflow});
  const wv=await env.request(`/workflows/${w.id}/versions`,"POST",{expectedRevision:1});
  const suite=await env.request(`/projects/${project.id}/suites`,"POST",{name:"Ten thousand",definition:s});
  const sv=await env.request(`/suites/${suite.id}/versions`,"POST",{expectedRevision:1,workflowVersionId:wv.id});
  const started=performance.now();
  const run=await env.request("/runs","POST",{workflowVersionId:wv.id,suiteVersionId:sv.id,mode:"live",confirmLive:true,httpAttemptLimit:10000});
  const result=await finish(env,run.id,600000);assert.equal(result.status,"completed",JSON.stringify(result.error));assert.equal(calls,10000);
  const report=await env.request(`/runs/${run.id}/classification`);assert.equal(report.summary.all.completed,10000);assert.equal(report.summary.provisional.agreement.value,1);
  const page=await env.request(`/runs/${run.id}/classification/rows?offset=9990&limit=10`);assert.equal(page.items.length,10);assert.equal(page.total,10000);
  const full=env.local.storage.getRun(env.local.context,run.id).report;
  t.diagnostic(JSON.stringify({rows:calls,elapsedMs:Math.round(performance.now()-started),reportBytes:Buffer.byteLength(JSON.stringify(full)),rssMiB:Math.round(process.memoryUsage().rss/1024/1024)}));
});
