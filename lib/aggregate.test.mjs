// aggregate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, compareWindows } from './aggregate.mjs';

function ph(o) {
  return {
    rdc: o.rdc, wf: o.wf, phase: o.phase, nth: o.nth || 1, sessionId: o.s || 's1',
    tStart: o.t, tEnd: o.t + (o.d || 0), durationMs: o.d || 0,
    status: 'done', gate: o.gate ?? null, title: o.title || '',
    owner: o.owner || '', doc: o.doc || '', days: o.days ?? null, wfResult: o.wfResult ?? null,
    tokens: { input: o.tin || 0, output: o.tout || 0, cacheRead: 0, cacheCreate: 0, total: o.tok || 0 },
    turns: o.turns || 0,
    toolCalls: { total: o.tc || 0, ok: o.ok || 0, err: o.err || 0, byTool: {} },
    subagents: 0, subagentCalls: o.sac || 0, corrections: o.corr || 0,
    models: o.models || [], subagentTypes: [],
    kb: { calls: o.kc || 0, hits: o.kh || 0, refs: 0 },
  };
}

test('groups into rdc -> workflow -> phase, tokens summed', () => {
  const phases = [
    ph({ rdc: 'r1', wf: 'w1', phase: 'A', t: 10, tok: 100, gate: 'PASS' }),
    ph({ rdc: 'r1', wf: 'w1', phase: 'B', t: 20, tok: 50, gate: 'FAIL' }),
    ph({ rdc: 'r1', wf: 'w2', phase: 'A', t: 30, tok: 70, gate: 'PASS' }),
  ];
  const rdcs = aggregate(phases);
  assert.equal(rdcs.length, 1);
  assert.equal(rdcs[0].workflowCount, 2);
  assert.equal(rdcs[0].totals.tokens, 220);
});

test('workflow gatePassRate = pass / (non-null gates)', () => {
  const phases = [
    ph({ rdc: 'r1', wf: 'w1', phase: 'A', t: 10, gate: 'PASS' }),
    ph({ rdc: 'r1', wf: 'w1', phase: 'B', t: 20, gate: 'FAIL' }),
    ph({ rdc: 'r1', wf: 'w1', phase: 'C', t: 30, gate: null }),
  ];
  const wf = aggregate(phases)[0].workflows[0];
  assert.equal(wf.gatePassRate, 0.5);
});

test('gatePassRate null when no gates recorded', () => {
  const phases = [ph({ rdc: 'r1', wf: 'w1', phase: 'A', t: 10, gate: null })];
  assert.equal(aggregate(phases)[0].workflows[0].gatePassRate, null);
});

test('status: last phase with FAIL gate is blocked, earlier are done', () => {
  const phases = [
    ph({ rdc: 'r1', wf: 'w1', phase: 'A', t: 10, gate: 'PASS' }),
    ph({ rdc: 'r1', wf: 'w1', phase: 'B', t: 20, gate: 'FAIL' }),
  ];
  const ps = aggregate(phases)[0].workflows[0].phases;
  assert.equal(ps[0].status, 'done');
  assert.equal(ps[1].status, 'blocked');
});

test('unattributed with null rdc is dropped from tree', () => {
  const phases = [
    { ...ph({ rdc: null, wf: null, phase: '__unattributed__', t: 5, tok: 999 }), nth: 0 },
    ph({ rdc: 'r1', wf: 'w1', phase: 'A', t: 10, tok: 10 }),
  ];
  const rdcs = aggregate(phases);
  assert.equal(rdcs.length, 1);
  assert.equal(rdcs[0].rdc, 'r1');
});

test('placeholder rdc (<slug> / <runId>) is filtered out', () => {
  const phases = [
    ph({ rdc: '<slug>', wf: '<runId>', phase: '<阶段名>', t: 5, tok: 100 }),
    ph({ rdc: 'real-rdc', wf: 'w1', phase: 'A', t: 10, tok: 50 }),
  ];
  const rdcs = aggregate(phases);
  assert.equal(rdcs.length, 1);
  assert.equal(rdcs[0].rdc, 'real-rdc');
});

test('cross-session same runId groups into one workflow', () => {
  const phases = [
    ph({ rdc: 'r1', wf: 'w1', phase: 'A', s: 'sessA', t: 10, tok: 10 }),
    ph({ rdc: 'r1', wf: 'w1', phase: 'B', s: 'sessB', t: 20, tok: 20 }),
  ];
  const rdcs = aggregate(phases);
  assert.equal(rdcs[0].workflowCount, 1);
  assert.equal(rdcs[0].workflows[0].phaseCount, 2);
  assert.equal(rdcs[0].workflows[0].totals.tokens, 30);
});

test('derived metrics: toolSuccessRate / replanRate / correctionRate', () => {
  const phases = [
    ph({ rdc: 'r1', wf: 'w1', phase: 'A', t: 10, ok: 8, err: 2, turns: 4, corr: 1 }),
    ph({ rdc: 'r1', wf: 'w1', phase: 'B', nth: 2, t: 20, ok: 5, err: 0, turns: 2, corr: 0 }),
  ];
  const wf = aggregate(phases)[0].workflows[0];
  assert.equal(wf.metrics.toolSuccessRate, 13 / 15);
  assert.equal(wf.metrics.replanRate, 0.5); // 2 阶段中 1 个 nth>1
  assert.equal(wf.metrics.avgLoops, 3);      // (4+2)/2
  assert.equal(wf.metrics.correctionRate, 0.5);
});

test('task result: explicit wf-end wins over inferred gate', () => {
  const phases = [
    ph({ rdc: 'r1', wf: 'w1', phase: 'A', t: 10, gate: 'FAIL', wfResult: 'SUCCESS' }),
  ];
  const wf = aggregate(phases)[0].workflows[0];
  assert.equal(wf.metrics.task.value, 'success');
  assert.equal(wf.metrics.task.source, 'sentinel');
});

test('task result inferred from last gate when no wf-end', () => {
  const phases = [
    ph({ rdc: 'r1', wf: 'w1', phase: 'A', t: 10, gate: 'PASS' }),
    ph({ rdc: 'r1', wf: 'w1', phase: 'B', t: 20, gate: 'FAIL' }),
  ];
  const wf = aggregate(phases)[0].workflows[0];
  assert.equal(wf.metrics.task.value, 'fail');
  assert.equal(wf.metrics.task.source, 'inferred');
});

test('cost computed with discount applied (custom price table)', () => {
  // 原价 = (1e6*10 + 1e6*50)/1e6 = 60，折扣 0.5 → 30
  const prices = { foo: { input: 10, output: 50, cacheRead: 0, cacheCreate: 0, discount: 0.5 }, _default: { input: 1, output: 1, cacheRead: 0, cacheCreate: 0, discount: 1 } };
  const phases = [ph({ rdc: 'r1', wf: 'w1', phase: 'A', t: 10, tin: 1e6, tout: 1e6, tok: 2e6, models: ['foo'] })];
  const wf = aggregate(phases, { prices })[0].workflows[0];
  assert.equal(Math.round(wf.totals.cost * 100) / 100, 30);
});

test('synthetic / placeholder model costs zero', () => {
  const phases = [ph({ rdc: 'r1', wf: 'w1', phase: 'A', t: 10, tin: 1e6, tout: 1e6, tok: 2e6, models: ['<synthetic>'] })];
  const wf = aggregate(phases)[0].workflows[0];
  assert.equal(wf.totals.cost, 0);
});

test('prefix match picks longest key', () => {
  const prices = {
    'gpt-5': { input: 100, output: 100, cacheRead: 0, cacheCreate: 0, discount: 1 },
    'gpt-5.4': { input: 1, output: 1, cacheRead: 0, cacheCreate: 0, discount: 1 },
    _default: { input: 999, output: 999, cacheRead: 0, cacheCreate: 0, discount: 1 },
  };
  const phases = [ph({ rdc: 'r1', wf: 'w1', phase: 'A', t: 10, tin: 1e6, tout: 0, tok: 1e6, models: ['gpt-5.4-turbo'] })];
  const wf = aggregate(phases, { prices })[0].workflows[0];
  assert.equal(wf.totals.cost, 1); // 命中更长的 gpt-5.4，不是 gpt-5
});

test('wf meta (owner/doc/days) surfaced from phases', () => {
  const phases = [
    ph({ rdc: 'r1', wf: 'w1', phase: 'A', t: 10, owner: '张三', doc: 'feishu/x', days: 5.5 }),
  ];
  const wf = aggregate(phases)[0].workflows[0];
  assert.equal(wf.meta.owner, '张三');
  assert.equal(wf.meta.days, 5.5);
});

test('compareWindows splits recent vs previous by cutoff', () => {
  const day = 86400000; const now = 100 * day;
  const phases = [
    ph({ rdc: 'r1', wf: 'w1', phase: 'A', t: now - 2 * day, ok: 10, err: 0 }),   // recent
    ph({ rdc: 'r2', wf: 'w2', phase: 'A', t: now - 30 * day, ok: 5, err: 5 }),   // previous
  ];
  const cmp = compareWindows(aggregate(phases), { windowDays: 7, now });
  assert.equal(cmp.recent.workflowCount, 1);
  assert.equal(cmp.previous.workflowCount, 1);
  assert.equal(cmp.recent.metrics.toolSuccessRate, 1);
  assert.equal(cmp.previous.metrics.toolSuccessRate, 0.5);
});
