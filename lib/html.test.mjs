// html.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml, esc, fmtDur, fmtTok } from './html.mjs';

test('esc escapes html special chars', () => {
  assert.equal(esc('<b>&"x'), '&lt;b&gt;&amp;&quot;x');
});

test('fmtDur / fmtTok formatting', () => {
  assert.equal(fmtDur(3 * 3600e3 + 42 * 60e3), '3h 42min');
  assert.equal(fmtDur(5 * 60e3), '5min');
  assert.equal(fmtTok(382000), '382K');
  assert.equal(fmtTok(900), '900');
});

const TOTALS = { tokens: 382000, durationMs: 3600e3, turns: 8, toolCalls: 12, toolOk: 10, toolErr: 2, subagents: 1, subagentCalls: 1, corrections: 0, cost: 12.8, kb: { calls: 3, hits: 2, refs: 2 } };
const METRICS = { toolSuccessRate: 0.83, replanRate: 0, avgLoops: 8, correctionRate: 0, task: { value: 'success', source: 'sentinel' } };
const META = { owner: '张三', doc: 'feishu/x', days: 5.5 };

test('renderHtml: self-contained, escapes title, shows rdc', () => {
  const rdcs = [{
    rdc: 'r1', title: '<script>x</script>', workflowCount: 1,
    dateRange: [1000, 2000], gatePassRate: 1, totals: TOTALS, metrics: METRICS, meta: META,
    workflows: [{
      wf: 'w1', rdc: 'r1', title: 't', phaseCount: 1, gatePassRate: 1,
      tStart: 1000, tEnd: 2000, totals: TOTALS, metrics: METRICS, meta: META,
      phases: [{ rdc: 'r1', wf: 'w1', phase: '方案设计', nth: 1, status: 'done', gate: 'PASS',
        durationMs: 3600e3, turns: 8, cost: 12.8, models: ['claude-opus-4-7'], subagentCalls: 1,
        tokens: { total: 382000 }, toolCalls: { total: 12, ok: 10, err: 2, byTool: { Read: 5, Bash: 7 } }, subagents: 1, kb: { calls: 3, hits: 2, refs: 2 } }],
    }],
  }];
  const html = renderHtml(rdcs);
  assert.equal(html.startsWith('<!DOCTYPE html>'), true);
  assert.equal(html.includes('<script>x</script>'), false);
  assert.equal(html.includes('&lt;script&gt;'), true);
  assert.equal(html.includes('r1'), true);
  assert.equal(html.includes('方案设计'), true);
  assert.equal(html.includes('Opus 4.7'), true); // 模型简化
  assert.equal(html.includes('¥12.80'), true);    // 成本（人民币）
  assert.equal(html.includes('张三'), true);       // owner meta
});

test('renderHtml: comparison bar rendered when compare provided', () => {
  const cmp = {
    windowDays: 7,
    recent: { workflowCount: 2, gatePassRate: 0.9, metrics: { toolSuccessRate: 0.95, correctionRate: 0.1, replanRate: 0.2, avgLoops: 6 }, totals: TOTALS },
    previous: { workflowCount: 3, gatePassRate: 0.7, metrics: { toolSuccessRate: 0.8, correctionRate: 0.3, replanRate: 0.4, avgLoops: 9 }, totals: TOTALS },
  };
  const html = renderHtml([], { compare: cmp });
  assert.equal(html.includes('优化前后对比'), true);
  assert.equal(html.includes('前值'), true);
});

test('renderHtml: empty rdcs still valid html', () => {
  const html = renderHtml([]);
  assert.equal(html.startsWith('<!DOCTYPE html>'), true);
  assert.equal(html.includes('</html>'), true);
});
