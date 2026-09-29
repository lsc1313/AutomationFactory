import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../src/index.js';
test('sandbox executes generated code with external actions disabled',()=>{const p=buildPlan();assert.equal(p.externalActionsAllowed,false);assert.ok(p.requirements.length>0);});
