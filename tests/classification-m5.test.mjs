import test from "node:test";
import assert from "node:assert/strict";
import { loadExample } from "../apps/api/dist/examples.js";
import { validateSuite, MAX_HTTP_ATTEMPTS } from "@pathsmith/contracts";
import { runSuite, classificationRow, summarizeClassification, classificationCsv } from "@pathsmith/evaluation";
import { createMockProvider } from "@pathsmith/provider-mock";
import { readRunReport } from "../packages/cli/dist/report.js";

const example = loadExample("classification");
const bindings = () => ({decisions:{providerId:"mock",model:"mock-v1",adapter:createMockProvider(example.fixtures)}});

test("classification metadata validates labels, target, and 10,000 row bound", () => {
  assert.equal(validateSuite(example.suite,example.workflow).valid,true);
  for (const mutate of [
    (s)=>{s.classification.nodeId="missing";},
    (s)=>{s.classification.questionId="missing";},
    (s)=>{s.classification.negativeLabel=s.classification.positiveLabel;},
    (s)=>{s.scenarios[0].referenceLabel.value="bogus";},
    (s)=>{delete s.classification;},
    (s)=>{s.scenarios[0].referenceLabel.review="automatic";},
  ]) {
    const s=structuredClone(example.suite);mutate(s);
    assert.equal(validateSuite(s,example.workflow).valid,false);
  }
  const s=structuredClone(example.suite);
  s.scenarios=Array.from({length:10000},(_,i)=>({...s.scenarios[0],id:`row_${i}`,name:`Row ${i}`}));
  assert.equal(validateSuite(s,example.workflow,s.scenarios.map(r=>r.id)).valid,true);
  s.scenarios.push({...s.scenarios[0],id:"row_10000"});
  assert.equal(validateSuite(s,example.workflow).valid,false);
});

test("measured report separates reviewed/provisional labels and computes hand-checked denominators", async () => {
  const report=await runSuite({workflow:example.workflow,suite:example.suite,bindings:bindings(),mode:"mock",httpAttemptLimit:MAX_HTTP_ATTEMPTS});
  assert.equal(report.status,"completed");
  assert.equal(readRunReport(report).id,report.id);
  const facts=new Map(report.scenarios.map(s=>[s.scenarioId,s]));
  const rows=example.suite.scenarios.map(s=>classificationRow(report.suite,s,facts.get(s.id),report.status));
  const summary=summarizeClassification(rows);
  assert.deepEqual([summary.all.truePositive,summary.all.trueNegative,summary.all.falsePositive,summary.all.falseNegative],[2,2,1,1]);
  assert.deepEqual(summary.all.agreement,{numerator:4,denominator:6,value:4/6});
  assert.equal(summary.all.selected,8);
  assert.equal(summary.all.unclear,1);
  assert.equal(summary.all.unlabeled,1);
  assert.equal(summary.reviewed.agreement.value,0.5);
  assert.equal(summary.provisional.agreement.value,1);
  assert.deepEqual(summary.labelSources,{generated:3,human:4,unknown:0});
  assert.equal(summary.slices.find(s=>s.tag==="threat").all.falseNegative,1);
  assert.equal(summary.slices.find(s=>s.tag==="context").all.agreement.value,null);
  const csv=classificationCsv([{...rows[0],name:'=HYPERLINK("bad")'}]);
  assert.ok(csv.includes("'="));
  // Today's draft cannot alter the saved test labels.
  const changed=structuredClone(example.suite);changed.scenarios[0].referenceLabel.value="not_abusive";
  assert.equal(report.suite.scenarios[0].referenceLabel.value,"abusive");
  await assert.rejects(()=>runSuite({workflow:example.workflow,suite:example.suite,bindings:bindings(),mode:"mock",httpAttemptLimit:MAX_HTTP_ATTEMPTS+1}));
});

test("failed, interrupted, unclear and absent predictions never become correct classifications", () => {
  const s=example.suite.scenarios[0];
  const good={scenarioId:s.id,status:"completed",outputs:{classify:{label:{kind:"choice",value:"abusive"}}},actualHttpAttempts:1,elapsedMs:1};
  const rows=[
    classificationRow(example.suite,s,good,"failed"),
    classificationRow(example.suite,{...s,id:"failed"},{...good,scenarioId:"failed",status:"failed",error:{code:"PROVIDER_TIMEOUT"}},"failed"),
    classificationRow(example.suite,{...s,id:"missing"},{...good,scenarioId:"missing",outputs:{}},"failed"),
    classificationRow(example.suite,{...s,id:"interrupted"},undefined,"interrupted"),
  ];
  const summary=summarizeClassification(rows).all;
  assert.equal(summary.evaluated,1);
  assert.equal(summary.errors,1);
  assert.equal(summary.missingPrediction,1);
  assert.equal(summary.interrupted,1);
  assert.equal(summary.agreement.value,1);
  assert.equal(summary.endToEndAgreement.value,0.25);
  assert.equal(summary.completion.value,0.5);
  assert.equal(summarizeClassification([]).all.agreement.value,null);
});
