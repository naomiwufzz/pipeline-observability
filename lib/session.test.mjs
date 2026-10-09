// session.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPhases, deriveIntent } from './session.mjs';

function ev(ts, o = {}) {
  return {
    ts, sessionId: 's1', role: o.role || 'assistant', isSidechain: !!o.sc, model: o.model || '',
    usage: o.usage || null, texts: o.texts || [], toolUses: o.tu || [], toolResults: o.tr || [],
  };
}
const U = (n) => ({ input: n, output: 0, cacheRead: 0, cacheCreate: 0, total: n });

test('events before first phase go to __unattributed__', () => {
  const evs = [
    ev(1, { usage: U(50) }),
    ev(2, { texts: ['⟦TRACK wf rdc=r1 id=w1 title="t"⟧'] }),
    ev(3, { texts: ['⟦TRACK phase name=方案设计⟧'], usage: U(10) }),
    ev(4, { usage: U(20) }),
  ];
  const ph = buildPhases(evs);
  const un = ph.find((p) => p.phase === '__unattributed__');
  assert.equal(un.tokens.total, 50);
  const design = ph.find((p) => p.phase === '方案设计');
  assert.equal(design.tokens.total, 30);
  assert.equal(design.rdc, 'r1');
  assert.equal(design.wf, 'w1');
});

test('token conservation: sum of phases == sum of all usage', () => {
  const evs = [
    ev(1, { usage: U(5) }),
    ev(2, { texts: ['⟦TRACK phase name=A⟧'], usage: U(10) }),
    ev(3, { usage: U(7) }),
    ev(4, { texts: ['⟦TRACK phase name=B nth=2⟧'], usage: U(3) }),
  ];
  const ph = buildPhases(evs);
  const total = ph.reduce((s, p) => s + p.tokens.total, 0);
  assert.equal(total, 25);
});

test('turns and byTool counts', () => {
  const evs = [
    ev(1, { texts: ['⟦TRACK phase name=A⟧'], tu: [{ id: 't1', name: 'Read' }] }),
    ev(2, { tu: [{ id: 't2', name: 'Read' }, { id: 't3', name: 'Bash' }] }),
  ];
  const A = buildPhases(evs).find((p) => p.phase === 'A');
  assert.equal(A.turns, 2);
  assert.equal(A.toolCalls.total, 3);
  assert.deepEqual(A.toolCalls.byTool, { Read: 2, Bash: 1 });
});

test('kb hit pairing: call counted, hit only when result non-empty & no error', () => {
  const evs = [
    ev(1, { texts: ['⟦TRACK phase name=A⟧'], tu: [{ id: 'k1', name: 'kb-consume' }, { id: 'k2', name: 'dev-wiki' }] }),
    ev(2, { role: 'user', tr: [{ id: 'k1', isError: false, len: 200 }] }),
    ev(3, { role: 'user', tr: [{ id: 'k2', isError: false, len: 0 }] }),
  ];
  const A = buildPhases(evs).find((p) => p.phase === 'A');
  assert.equal(A.kb.calls, 2);
  assert.equal(A.kb.hits, 1);
});

test('codegraph prefix counts as kb tool', () => {
  const evs = [
    ev(1, { texts: ['⟦TRACK phase name=A⟧'], tu: [{ id: 'c1', name: 'mcp__codegraph__codegraph_context' }] }),
    ev(2, { role: 'user', tr: [{ id: 'c1', isError: false, len: 500 }] }),
  ];
  const A = buildPhases(evs).find((p) => p.phase === 'A');
  assert.equal(A.kb.calls, 1);
  assert.equal(A.kb.hits, 1);
});

test('subagent (isSidechain) counted', () => {
  const evs = [
    ev(1, { texts: ['⟦TRACK phase name=A⟧'] }),
    ev(2, { sc: true, usage: U(9) }),
  ];
  const A = buildPhases(evs).find((p) => p.phase === 'A');
  assert.equal(A.subagents, 1);
});

test('gate sentinel attaches result to same-named phase, absent stays null', () => {
  const evs = [
    ev(1, { texts: ['⟦TRACK phase name=方案设计⟧'] }),
    ev(2, { texts: ['⟦TRACK gate phase=方案设计 result=PASS⟧'] }),
    ev(3, { texts: ['⟦TRACK phase name=TDD实现⟧'] }),
  ];
  const ph = buildPhases(evs);
  assert.equal(ph.find((p) => p.phase === '方案设计').gate, 'PASS');
  assert.equal(ph.find((p) => p.phase === 'TDD实现').gate, null);
});

test('unpaired kb tool_use: call counted, no hit, does not throw', () => {
  const evs = [
    ev(1, { texts: ['⟦TRACK phase name=A⟧'], tu: [{ id: 'k1', name: 'kb-consume' }] }),
  ];
  const A = buildPhases(evs).find((p) => p.phase === 'A');
  assert.equal(A.kb.calls, 1);
  assert.equal(A.kb.hits, 0);
});

test('no sentinels at all: everything to __unattributed__, does not throw', () => {
  const evs = [ev(1, { usage: U(10) }), ev(2, { usage: U(5) })];
  const ph = buildPhases(evs);
  assert.equal(ph.length, 1);
  assert.equal(ph[0].phase, '__unattributed__');
  assert.equal(ph[0].tokens.total, 15);
});

test('tool ok/err split from is_error and empty result', () => {
  const evs = [
    ev(1, { texts: ['⟦TRACK phase name=A⟧'], tu: [{ id: 't1', name: 'Bash' }, { id: 't2', name: 'Bash' }, { id: 't3', name: 'Read' }] }),
    ev(2, { role: 'user', tr: [{ id: 't1', isError: false, len: 20 }, { id: 't2', isError: true, len: 5 }, { id: 't3', isError: false, len: 0 }] }),
  ];
  const A = buildPhases(evs).find((p) => p.phase === 'A');
  assert.equal(A.toolCalls.ok, 1);
  assert.equal(A.toolCalls.err, 2); // 一个 is_error，一个空结果
});

test('cross-phase tool_result pairs to originating phase', () => {
  const evs = [
    ev(1, { texts: ['⟦TRACK phase name=A⟧'], tu: [{ id: 'k1', name: 'kb-consume' }] }),
    ev(2, { texts: ['⟦TRACK phase name=B⟧'] }),
    ev(3, { role: 'user', tr: [{ id: 'k1', isError: false, len: 200 }] }),
  ];
  const ph = buildPhases(evs);
  const A = ph.find((p) => p.phase === 'A');
  assert.equal(A.kb.hits, 1); // 结果在 B 阶段回来，仍结算到 A
  assert.equal(A.toolCalls.ok, 1);
});

test('model dedup and subagentTypes from Task', () => {
  const evs = [
    ev(1, { texts: ['⟦TRACK phase name=A⟧'], model: 'opus', tu: [{ id: 's1', name: 'Task', subagentType: 'spec-reviewer' }] }),
    ev(2, { model: 'opus', tu: [{ id: 's2', name: 'Task', subagentType: 'spec-reviewer' }] }),
  ];
  const A = buildPhases(evs).find((p) => p.phase === 'A');
  assert.deepEqual(A.models, ['opus']);
  assert.deepEqual(A.subagentTypes, ['spec-reviewer']);
  assert.equal(A.subagentCalls, 2);
});

test('user correction heuristic counts once per message', () => {
  const evs = [
    ev(1, { texts: ['⟦TRACK phase name=A⟧'] }),
    ev(2, { role: 'user', texts: ['不对，这里搞错了'] }),
    ev(3, { role: 'user', texts: ['继续'] }),
  ];
  const A = buildPhases(evs).find((p) => p.phase === 'A');
  assert.equal(A.corrections, 1);
});

test('wf-end result and wf meta captured', () => {
  const evs = [
    ev(1, { texts: ['⟦TRACK wf rdc=r1 id=w1 title="t" owner=张三 doc=feishu/x days=5.5⟧'] }),
    ev(2, { texts: ['⟦TRACK phase name=A⟧'] }),
    ev(3, { texts: ['⟦TRACK wf-end result=SUCCESS⟧'] }),
  ];
  const ph = buildPhases(evs);
  const A = ph.find((p) => p.phase === 'A');
  assert.equal(A.owner, '张三');
  assert.equal(A.days, 5.5);
  assert.equal(A.wfResult, 'SUCCESS');
});

test('deriveIntent skips skill prefix and @refs, keeps intent', () => {
  assert.equal(deriveIntent('Base directory for this skill: D:\\x\n给关系图谱加缓存'), '给关系图谱加缓存');
  assert.equal(deriveIntent('新增需求：资质筛查支持批量 @ent-web/x /superpowers:brainstorming'), '新增需求资质筛查支持批量 ent-web');
  assert.equal(deriveIntent('<system-reminder>x</system-reminder>'), '');
  assert.equal(deriveIntent('[Image: source: C:/x.png]'), '');
});

test('deriveIntent keeps project name from @ref, drops bare code symbol', () => {
  assert.equal(deriveIntent('对 @ent-web 执行一下检查'), '对 ent-web 执行一下检查');
  assert.equal(deriveIntent('handleSelectReport'), ''); // 纯代码符号丢弃
  assert.equal(deriveIntent('select'), '');
});

test('fallback rdc from first user intent when no wf sentinel', () => {
  const evs = [
    ev(1, { role: 'user', texts: ['根据本周工作内容写一个本周周报'] }),
    ev(2, { texts: ['⟦TRACK phase name=A⟧'], usage: U(100) }),
    ev(3, { usage: U(50) }),
  ];
  const ph = buildPhases(evs);
  // 所有 null-rdc 阶段都被归因到推断出的 rdc
  assert.equal(ph.every((p) => p.rdc === '根据本周工作内容写一个本周周报'), true);
  assert.equal(ph.every((p) => p.rdcInferred === true), true);
  assert.equal(ph.every((p) => p.wf === 'auto:根据本周工作内容写一个本周周报'), true);
});

test('wf sentinel takes precedence over fallback intent', () => {
  const evs = [
    ev(1, { role: 'user', texts: ['随便说点什么当意图'] }),
    ev(2, { texts: ['⟦TRACK wf rdc=real-rdc id=w1⟧⟦TRACK phase name=A⟧'] }),
  ];
  const A = buildPhases(evs).find((p) => p.phase === 'A');
  assert.equal(A.rdc, 'real-rdc');
  assert.equal(A.rdcInferred, false);
});
