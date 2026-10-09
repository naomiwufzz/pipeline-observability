// aggregate.mjs
// 默认价格表（人民币 ¥ / 百万 token）。部署方应通过本地 config.json 覆盖。
// 公开仓库只保留中性的占位默认值,不包含任何平台采购价或折扣信息。
export const DEFAULT_PRICES = {
  _default:            { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, discount: 1 },
};

// 合成/占位模型：不产生真实计费，成本记 0。
const ZERO_COST_MODELS = ['<synthetic>', 'synthetic', '<none>'];

function priceFor(model, prices) {
  if (!model) return prices._default;
  if (ZERO_COST_MODELS.includes(model)) return null; // null → 0 成本
  let best = null; let bestLen = -1;
  for (const key of Object.keys(prices)) {
    if (key === '_default') continue;
    if (model.startsWith(key) && key.length > bestLen) { best = prices[key]; bestLen = key.length; }
  }
  return best || prices._default;
}

// 单阶段成本（¥）：阶段可能跨多个模型，无法精确到 token 级归属，
// 用该阶段首选模型（models[0]）作代表估算；合成模型记 0；实际金额 = 原价 × discount。
function phaseCost(p, prices) {
  const pr = priceFor((p.models && p.models[0]) || '', prices);
  if (!pr) return 0;
  const t = p.tokens;
  const gross = (t.input * pr.input + t.output * pr.output
    + t.cacheRead * pr.cacheRead + t.cacheCreate * pr.cacheCreate) / 1e6;
  return gross * (pr.discount != null ? pr.discount : 1);
}

function blankTotals() {
  return {
    tokens: 0, durationMs: 0, turns: 0, toolCalls: 0, toolOk: 0, toolErr: 0,
    subagents: 0, subagentCalls: 0, corrections: 0, cost: 0,
    kb: { calls: 0, hits: 0, refs: 0 },
  };
}
function addTotals(t, p, prices) {
  t.tokens += p.tokens.total;
  t.durationMs += p.durationMs;
  t.turns += p.turns;
  t.toolCalls += p.toolCalls.total;
  t.toolOk += p.toolCalls.ok || 0;
  t.toolErr += p.toolCalls.err || 0;
  t.subagents += p.subagents;
  t.subagentCalls += p.subagentCalls || 0;
  t.corrections += p.corrections || 0;
  t.cost += phaseCost(p, prices);
  t.kb.calls += p.kb.calls;
  t.kb.hits += p.kb.hits;
  t.kb.refs += p.kb.refs;
}
function passRate(phases) {
  const withGate = phases.filter((p) => p.gate != null);
  if (withGate.length === 0) return null;
  return withGate.filter((p) => p.gate === 'PASS').length / withGate.length;
}

// —— 派生指标 ——
function toolSuccessRate(t) {
  const denom = t.toolOk + t.toolErr;
  return denom === 0 ? null : t.toolOk / denom;
}
// Replan 率：回退重进阶段数(nth>1) / 阶段总数
function replanRate(phases) {
  if (phases.length === 0) return null;
  return phases.filter((p) => p.nth > 1).length / phases.length;
}
// 平均循环次数：每阶段的助手轮数均值
function avgLoops(phases) {
  const real = phases.filter((p) => p.phase !== '__unattributed__');
  if (real.length === 0) return null;
  return real.reduce((s, p) => s + p.turns, 0) / real.length;
}
// 用户纠正率：发生纠正的阶段数 / 阶段总数（阶段级，避免被长会话稀释）
function correctionRate(phases) {
  const real = phases.filter((p) => p.phase !== '__unattributed__');
  if (real.length === 0) return null;
  return real.filter((p) => (p.corrections || 0) > 0).length / real.length;
}
// 任务成功：优先显式 wf-end；否则由末阶段门禁推断（FAIL→failed，其余→unknown）
function taskResult(phases) {
  const explicit = phases.find((p) => p.wfResult != null);
  if (explicit) return { value: explicit.wfResult.toLowerCase(), source: 'sentinel' };
  const last = phases[phases.length - 1];
  if (last && last.gate === 'FAIL') return { value: 'fail', source: 'inferred' };
  if (last && last.gate === 'PASS') return { value: 'success', source: 'inferred' };
  return { value: 'unknown', source: 'none' };
}
function metrics(phases, totals) {
  return {
    toolSuccessRate: toolSuccessRate(totals),
    replanRate: replanRate(phases),
    avgLoops: avgLoops(phases),
    correctionRate: correctionRate(phases),
    task: taskResult(phases),
  };
}
function metaFor(phases) {
  return {
    owner: phases.find((p) => p.owner)?.owner || '',
    doc: phases.find((p) => p.doc)?.doc || '',
    days: phases.find((p) => p.days != null)?.days ?? null,
  };
}

export function aggregate(phases, opts = {}) {
  const prices = opts.prices || DEFAULT_PRICES;
  // 过滤：rdc 为 null，或 rdc/wf/phase 是占位符（含 < > 的字面量示例）
  const isPlaceholder = (s) => s != null && (s.includes('<') || s.includes('>'));
  const keep = phases.filter((p) =>
    !(p.phase === '__unattributed__' && p.rdc == null) &&
    !isPlaceholder(p.rdc) && !isPlaceholder(p.wf)
  );
  const byRdc = new Map();
  for (const p of keep) {
    if (!byRdc.has(p.rdc)) byRdc.set(p.rdc, new Map());
    const wfMap = byRdc.get(p.rdc);
    if (!wfMap.has(p.wf)) wfMap.set(p.wf, []);
    wfMap.get(p.wf).push(p);
  }

  const rdcs = [];
  for (const [rdc, wfMap] of byRdc) {
    const workflows = [];
    for (const [wf, ps] of wfMap) {
      ps.sort((a, b) => a.tStart - b.tStart);
      ps.forEach((p, i) => {
        p.status = (i === ps.length - 1 && p.gate === 'FAIL') ? 'blocked' : 'done';
        p.cost = phaseCost(p, prices); // 阶段级成本，供渲染层明细用
      });
      const totals = blankTotals();
      ps.forEach((p) => addTotals(totals, p, prices));
      workflows.push({
        wf, rdc, title: (ps.find((p) => p.title)?.title) || '',
        rdcInferred: ps.some((p) => p.rdcInferred),
        phaseCount: ps.length, gatePassRate: passRate(ps), totals,
        metrics: metrics(ps, totals), meta: metaFor(ps),
        tStart: ps[0].tStart, tEnd: ps[ps.length - 1].tEnd, phases: ps,
      });
    }
    workflows.sort((a, b) => a.tStart - b.tStart);
    const totals = blankTotals();
    const allPhases = workflows.flatMap((w) => w.phases);
    allPhases.forEach((p) => addTotals(totals, p, prices));
    rdcs.push({
      rdc, title: workflows.find((w) => w.title)?.title || rdc,
      rdcInferred: workflows.every((w) => w.rdcInferred),
      workflowCount: workflows.length,
      dateRange: [Math.min(...workflows.map((w) => w.tStart)), Math.max(...workflows.map((w) => w.tEnd))],
      gatePassRate: passRate(allPhases), totals,
      metrics: metrics(allPhases, totals), meta: metaFor(allPhases), workflows,
    });
  }
  rdcs.sort((a, b) => b.dateRange[1] - a.dateRange[1]);
  return rdcs;
}

// 时间窗口对比：把 rdcs 按最近 windowDays 天切成 recent / previous 两组，
// 各自汇总关键指标，供看板顶部展示「优化前后变化」。
export function compareWindows(rdcs, opts = {}) {
  const windowDays = opts.windowDays || 7;
  const now = opts.now || Date.now();
  const cutoff = now - windowDays * 86400000;
  const bucket = (list) => {
    const wfs = list.flatMap((r) => r.workflows);
    const allPhases = wfs.flatMap((w) => w.phases);
    const totals = blankTotals();
    allPhases.forEach((p) => addTotals(totals, p, opts.prices || DEFAULT_PRICES));
    return {
      workflowCount: wfs.length,
      gatePassRate: passRate(allPhases),
      metrics: metrics(allPhases, totals),
      totals,
    };
  };
  const recent = rdcs.filter((r) => r.dateRange[1] >= cutoff);
  const previous = rdcs.filter((r) => r.dateRange[1] < cutoff);
  return { windowDays, recent: bucket(recent), previous: bucket(previous) };
}
