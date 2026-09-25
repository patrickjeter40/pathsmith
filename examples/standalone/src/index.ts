import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseJson, type Fixtures, type Suite, type Workflow } from '@pathsmith/contracts';
import { executeWorkflow, type JsonObject } from '@pathsmith/core';
import { createMockProvider } from '@pathsmith/provider-mock';

const directory=new URL('../../support-routing/',import.meta.url);
async function read(name:string){return parseJson(await readFile(new URL(name,directory),'utf8'));}
const suite=await read('suite.json') as unknown as Suite,fixtures=await read('mock-fixtures.json') as unknown as Fixtures;
const expectations=await read('expected-results.json') as JsonObject;
let checked=0;
for(const version of ['baseline','candidate']){
  const workflow=await read(`${version}.workflow.json`) as unknown as Workflow;
  const expected=(expectations[version] as JsonObject).scenarios as JsonObject[];
  for(const scenario of suite.scenarios){
    const result=await executeWorkflow({workflow,input:scenario.input,scenarioId:scenario.id,mode:'mock',bindings:{decisions:{providerId:'mock',model:'mock-v1',adapter:createMockProvider(fixtures)}}});
    const wanted=expected.find(s=>s.scenarioId===scenario.id)!;
    assert.equal(result.status,'completed');
    assert.equal(result.result.outcomeId,wanted.outcomeId);
    assert.deepEqual(result.result.value,wanted.value);
    assert.deepEqual(result.selectedEdges,wanted.selectedEdges);
    assert.deepEqual(result.visitedNodes,wanted.visitedNodes);
    assert.equal(result.events.length,0,'Tracing is opt-in for standalone execution');
    checked++;
  }
}
console.log(`Standalone parity: ${checked} cases passed using built package exports (${fileURLToPath(directory)}). No API or database required.`);
