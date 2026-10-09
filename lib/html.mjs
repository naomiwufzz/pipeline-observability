// html.mjs
export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export function fmtDur(ms) {
  const min = Math.round(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}
export function fmtTok(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}
export function fmtCost(cny) {
  return cny == null ? '—' : `¥${cny.toFixed(2)}`;
}
function pct(r) { return r == null ? '—' : `${Math.round(r * 100)}%`; }
function num1(n) { return n == null ? '—' : (Math.round(n * 10) / 10).toString(); }
function rateClass(r) { return r == null ? 'gray' : (r >= 0.999 ? 'green' : (r >= 0.8 ? 'amber' : 'red')); }
// 简化模型名：claude-opus-4-7-... → Opus 4.7
function shortModel(m) {
  if (!m) return '—';
  const map = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' };
  for (const k of Object.keys(map)) {
    const re = new RegExp(`claude-${k}-(\\d+)-?(\\d+)?`);
    const mm = m.match(re);
    if (mm) return `${map[k]} ${mm[1]}${mm[2] ? '.' + mm[2] : ''}`;
    if (m.includes(k)) return map[k];
  }
  return m;
}
// 阶段门禁 → 徽标
function phaseBadge(p) {
  if (p.gate === 'PASS') return '<span class="badge ok">✓ 通过</span>';
  if (p.gate === 'PARTIAL') return '<span class="badge partial">⚠ 部分通过</span>';
  if (p.gate === 'FAIL') return '<span class="badge fail">✗ 未通过</span>';
  return '<span class="badge none">— 未记录</span>';
}
// 从 byTool 取用到的工具/技能名作标签（去 KB 无关噪声，最多 8 个）
function toolTags(p) {
  const names = Object.keys(p.toolCalls.byTool || {});
  if (names.length === 0) return '';
  return names.slice(0, 8).map((n) => `<span class="tag">${esc(n)}</span>`).join('');
}

// —— 单阶段卡（对应目标图中每个流程阶段块）——
function phaseCard(p) {
  const name = p.phase === '__unattributed__' ? '未标记阶段' : p.phase;
  const nth = p.nth > 1 ? ` <span class="nth">第${p.nth}次</span>` : '';
  const model = shortModel(p.models && p.models[0]);
  const ok = p.toolCalls.ok || 0; const err = p.toolCalls.err || 0;
  const toolLine = `工具: ${ok}✓/${err}✗ · Sub-Agent: ${p.subagentCalls || 0} · KB: ${p.kb.hits}/${p.kb.calls}`;
  const cls = p.gate === 'FAIL' ? 'pc fail' : (p.gate === 'PARTIAL' ? 'pc partial' : (p.gate === 'PASS' ? 'pc ok' : 'pc none'));
  return `<div class="${cls}">
    <div class="pc-head"><span class="pc-name">${esc(name)}${nth}</span>${phaseBadge(p)}</div>
    <div class="pc-meta">门禁: ${esc(p.gate ?? '—')} · 模型: ${esc(model)} · 耗时: ${fmtDur(p.durationMs)} · Token: ${fmtTok(p.tokens.total)}</div>
    <div class="pc-meta sub">${toolLine} · 轮数: ${p.turns} · 成本: ${fmtCost(p.cost)}</div>
    <div class="pc-tags">${toolTags(p)}</div>
  </div>`;
}

// —— 需求信息区（对应目标图顶部信息卡）——
function reqInfo(w) {
  const m = w.meta || {};
  const d0 = new Date(w.tStart).toISOString().slice(0, 10);
  const d1 = new Date(w.tEnd).toISOString().slice(0, 10);
  const rows = [];
  rows.push(`<div><span class="k">工作流 ID</span><span class="v">${esc(w.wf)}</span></div>`);
  if (m.owner) rows.push(`<div><span class="k">负责人</span><span class="v">${esc(m.owner)}</span></div>`);
  rows.push(`<div><span class="k">需求标题</span><span class="v">${esc(w.title || '—')}</span></div>`);
  if (m.days != null) rows.push(`<div><span class="k">投入人天</span><span class="v">${m.days}</span></div>`);
  if (m.doc) rows.push(`<div><span class="k">关联文档</span><span class="v">${esc(m.doc)}</span></div>`);
  rows.push(`<div><span class="k">日期范围</span><span class="v">${d0} ～ ${d1}</span></div>`);
  return `<div class="section"><div class="sec-title">📋 需求信息</div><div class="req-grid">${rows.join('')}</div></div>`;
}

function taskBadge(task) {
  if (!task) return '';
  const map = { success: ['ok', '✓ 成功'], fail: ['fail', '✗ 失败'], abandon: ['none', '⊘ 放弃'], unknown: ['none', '— 未知'] };
  const [cls, label] = map[task.value] || map.unknown;
  const src = task.source === 'sentinel' ? '' : ' <span class="src">(推断)</span>';
  return `<span class="badge ${cls}">${label}${src}</span>`;
}

// —— 汇总结果区（对应目标图底部三张大卡 + 指标行）——
function summary(w) {
  const t = w.totals; const mt = w.metrics || {};
  const big = (label, val, cls = '') => `<div class="big"><div class="big-label">${label}</div><div class="big-val ${cls}">${val}</div></div>`;
  const bigs = big('Total Tokens', fmtTok(t.tokens))
    + big('Total Duration', fmtDur(t.durationMs))
    + big('Gate Pass Rate', pct(w.gatePassRate), rateClass(w.gatePassRate))
    + big('Total Cost', fmtCost(t.cost));
  const metric = (label, val, cls = '') => `<span class="m"><b class="${cls}">${val}</b> ${label}</span>`;
  const line = [
    metric('任务结果', taskBadge(mt.task)),
    metric('工具成功率', pct(mt.toolSuccessRate), rateClass(mt.toolSuccessRate)),
    metric('Replan 率', pct(mt.replanRate)),
    metric('平均循环', num1(mt.avgLoops)),
    metric('用户纠正率', pct(mt.correctionRate)),
    metric('Sub-Agent 调用', t.subagentCalls),
    metric('KB 命中', `${t.kb.hits}/${t.kb.calls}`),
  ].join('');
  return `<div class="section summary"><div class="sec-title">📊 汇总结果</div>
    <div class="bigs">${bigs}</div>
    <div class="metrics">${line}</div></div>`;
}

// —— 单工作流报告卡（= 目标图整张卡）——
function wfCard(w) {
  const cards = w.phases.map(phaseCard).join('');
  return `<details class="wf"><summary>🚀 工作流 ${esc(w.wf)} · ${esc(w.title || '')} · ${w.phaseCount}阶段 · ${fmtTok(w.totals.tokens)} · ${fmtDur(w.totals.durationMs)} · ${fmtCost(w.totals.cost)}</summary>
    ${reqInfo(w)}
    <div class="section"><div class="sec-title">🔄 流程采集信息（${w.phaseCount} 阶段）</div><div class="phases">${cards}</div></div>
    ${summary(w)}
  </details>`;
}

function rdcCard(r) {
  const wfs = r.workflows.map(wfCard).join('');
  const mt = r.metrics || {};
  const inferred = r.rdcInferred ? ' <span class="infer">推断</span>' : '';
  return `<details class="rdc"><summary><b>${esc(r.rdc)}</b>${inferred} ${esc(r.title)} · ${r.workflowCount}工作流 · 门禁 <span class="${rateClass(r.gatePassRate)}">${pct(r.gatePassRate)}</span> · 工具成功 <span class="${rateClass(mt.toolSuccessRate)}">${pct(mt.toolSuccessRate)}</span> · ${fmtTok(r.totals.tokens)} · ${fmtCost(r.totals.cost)}</summary>${wfs}</details>`;
}

// —— 时间窗口对比条（满足「优化前后变化」）——
function delta(cur, prev, higherBetter = true) {
  if (cur == null || prev == null) return '';
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return '<span class="d flat">—</span>';
  const good = higherBetter ? d > 0 : d < 0;
  const arrow = d > 0 ? '▲' : '▼';
  return `<span class="d ${good ? 'up' : 'down'}">${arrow}${Math.abs(Math.round(d * 100))}pt</span>`;
}
function compareBar(cmp) {
  if (!cmp) return '';
  const { recent: R, previous: P, windowDays } = cmp;
  if (R.workflowCount === 0 && P.workflowCount === 0) return '';
  const cell = (label, cur, prev, hb = true, fmt = pct) =>
    `<div class="cmp-cell"><div class="cmp-label">${label}</div>`
    + `<div class="cmp-val">${fmt(cur)} ${delta(cur, prev, hb)}</div>`
    + `<div class="cmp-prev">前值 ${fmt(prev)}</div></div>`;
  return `<div class="section cmp"><div class="sec-title">📈 优化前后对比（近 ${windowDays} 天 vs 之前）</div>
    <div class="cmp-grid">
      ${cell('门禁通过率', R.gatePassRate, P.gatePassRate)}
      ${cell('工具成功率', R.metrics.toolSuccessRate, P.metrics.toolSuccessRate)}
      ${cell('用户纠正率', R.metrics.correctionRate, P.metrics.correctionRate, false)}
      ${cell('Replan 率', R.metrics.replanRate, P.metrics.replanRate, false)}
      ${cell('平均循环', R.metrics.avgLoops, P.metrics.avgLoops, false, num1)}
    </div>
    <div class="note">近 ${windowDays} 天 ${R.workflowCount} 个工作流 · 之前 ${P.workflowCount} 个。绿色=改善，红色=退化。</div></div>`;
}

// —— 顶部 KPI 总览：跨全部 RDC 汇总关键数字，一眼看全局 ——
function overview(rdcs) {
  if (rdcs.length === 0) return '';
  let tokens = 0; let cost = 0; let wfCount = 0; let toolOk = 0; let toolErr = 0;
  const allPhases = [];
  for (const r of rdcs) {
    tokens += r.totals.tokens; cost += r.totals.cost; wfCount += r.workflowCount;
    toolOk += r.totals.toolOk; toolErr += r.totals.toolErr;
    for (const w of r.workflows) for (const p of w.phases) allPhases.push(p);
  }
  const gates = allPhases.filter((p) => p.gate != null);
  const gatePass = gates.length ? gates.filter((p) => p.gate === 'PASS').length / gates.length : null;
  const toolSucc = (toolOk + toolErr) ? toolOk / (toolOk + toolErr) : null;
  // 任务成功率：仅统计有明确结果（success/fail）的工作流
  let succ = 0; let resolved = 0;
  for (const r of rdcs) for (const w of r.workflows) {
    const v = w.metrics?.task?.value;
    if (v === 'success') { succ++; resolved++; } else if (v === 'fail') { resolved++; }
  }
  const taskRate = resolved ? succ / resolved : null;
  const kpi = (label, val, cls = '') => `<div class="kpi"><div class="kpi-val ${cls}">${val}</div><div class="kpi-label">${label}</div></div>`;
  return `<div class="section overview"><div class="kpis">
    ${kpi('总成本', fmtCost(cost))}
    ${kpi('总 Token', fmtTok(tokens))}
    ${kpi('工作流', String(wfCount))}
    ${kpi('RDC', String(rdcs.length))}
    ${kpi('门禁通过率', pct(gatePass), rateClass(gatePass))}
    ${kpi('工具成功率', pct(toolSucc), rateClass(toolSucc))}
    ${kpi('任务成功率', pct(taskRate), rateClass(taskRate))}
  </div></div>`;
}

const CSS = `
body{font-family:system-ui,'Microsoft YaHei',sans-serif;margin:0;background:#f5f6f8;color:#222}
.wrap{max-width:960px;margin:0 auto;padding:20px}
.topbar{background:linear-gradient(90deg,#f0a020,#f5b942);color:#fff;font-size:19px;font-weight:700;
  padding:14px 20px;border-radius:10px;margin-bottom:16px;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.1)}
.section{background:#fff;border:1px solid #eceef1;border-radius:10px;padding:14px 16px;margin:12px 0}
.sec-title{font-weight:700;font-size:15px;color:#33475b;margin-bottom:10px;border-left:4px solid #f0a020;padding-left:8px}
.req-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;font-size:13px}
.req-grid .k{color:#8a94a6;margin-right:8px;display:inline-block;min-width:70px}
.req-grid .v{color:#222;font-weight:500}
.phases{display:flex;flex-direction:column;gap:10px}
.pc{border:1px solid #e5e8ec;border-radius:8px;padding:10px 12px;border-left-width:4px}
.pc.ok{border-left-color:#22a06b;background:#f4fbf7}
.pc.partial{border-left-color:#e8a317;background:#fffaf0}
.pc.fail{border-left-color:#d64545;background:#fdf4f4}
.pc.none{border-left-color:#c2c8d0;background:#fafbfc}
.pc-head{display:flex;justify-content:space-between;align-items:center}
.pc-name{font-weight:700;font-size:14px;color:#2b3a4a}
.nth{font-size:11px;color:#e8a317;font-weight:500}
.pc-meta{font-size:12px;color:#5a6472;margin-top:5px}
.pc-meta.sub{color:#8a94a6}
.pc-tags{margin-top:6px;display:flex;flex-wrap:wrap;gap:4px}
.tag{background:#eef1f5;color:#5a6472;font-size:11px;padding:1px 7px;border-radius:10px}
.badge{font-size:12px;font-weight:600;padding:2px 8px;border-radius:12px}
.badge.ok{background:#e3f5ec;color:#22a06b}
.badge.partial{background:#fdf1dc;color:#c9820b}
.badge.fail{background:#fbe5e5;color:#d64545}
.badge.none{background:#eef0f3;color:#98a2b3}
.badge .src{font-weight:400;opacity:.7}
.summary .bigs{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.big{background:#fff8ec;border:1px solid #f3e2c2;border-radius:10px;padding:14px;text-align:center}
.big-label{font-size:12px;color:#a0894f;font-weight:600}
.big-val{font-size:24px;font-weight:800;color:#e08a1e;margin-top:4px}
.big-val.green{color:#22a06b}.big-val.amber{color:#c9820b}.big-val.red{color:#d64545}
.metrics{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13px;color:#5a6472;
  border-top:1px dashed #e5e8ec;padding-top:10px}
.metrics .m b{font-size:14px;color:#2b3a4a;margin-right:2px}
.cmp-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
.cmp-cell{background:#f7fafc;border:1px solid #e5edf2;border-radius:8px;padding:10px;text-align:center}
.cmp-label{font-size:12px;color:#8a94a6}
.cmp-val{font-size:17px;font-weight:700;color:#2b3a4a;margin:4px 0}
.cmp-prev{font-size:11px;color:#a8b0bd}
.d{font-size:12px;font-weight:700;margin-left:4px}
.d.up{color:#22a06b}.d.down{color:#d64545}.d.flat{color:#98a2b3}
.rdc{background:transparent;margin:16px 0}
.rdc>summary{font-size:15px;padding:8px 10px;background:#fff;border:1px solid #eceef1;border-radius:8px;cursor:pointer}
.wf{margin:10px 0}
.wf>summary{font-size:14px;font-weight:600;padding:8px 10px;background:#fbfcfd;border:1px solid #eceef1;border-radius:8px;cursor:pointer;color:#33475b}
.green{color:#22a06b;font-weight:700}.amber{color:#c9820b;font-weight:700}.red{color:#d64545;font-weight:700}.gray{color:#98a2b3}
.note{color:#a8b0bd;font-size:12px;margin-top:8px}
.infer{background:#eef0f3;color:#98a2b3;font-size:11px;padding:1px 6px;border-radius:8px;font-weight:500}
.overview{background:linear-gradient(135deg,#fff8ec,#fef3e0);border-color:#f3e2c2}
.kpis{display:grid;grid-template-columns:repeat(7,1fr);gap:10px}
.kpi{text-align:center;padding:6px 4px}
.kpi-val{font-size:22px;font-weight:800;color:#e08a1e}
.kpi-val.green{color:#22a06b}.kpi-val.amber{color:#c9820b}.kpi-val.red{color:#d64545}.kpi-val.gray{color:#98a2b3}
.kpi-label{font-size:12px;color:#a0894f;margin-top:2px}
.zone-title{font-size:15px;font-weight:700;color:#33475b;margin:20px 0 6px;padding-left:8px;border-left:4px solid #22a06b}
.zone-title.infer-zone{border-left-color:#c2c8d0;color:#8a94a6}
.zone-note{font-size:12px;color:#a8b0bd;margin-bottom:8px}
details.zone>summary{font-size:14px;font-weight:600;color:#8a94a6;cursor:pointer;padding:8px 10px;background:#f7f8fa;border:1px dashed #d5dae0;border-radius:8px}
@media(max-width:720px){.kpis{grid-template-columns:repeat(4,1fr)}.summary .bigs{grid-template-columns:repeat(2,1fr)}.cmp-grid{grid-template-columns:repeat(2,1fr)}}
`;

export function renderHtml(rdcs, opts = {}) {
  const cmp = opts.compare ? compareBar(opts.compare) : '';
  // 分区：哨兵确认（主动追踪，重点）置顶展示；推断归因（历史会话）收进折叠区。
  const confirmed = rdcs.filter((r) => !r.rdcInferred);
  const inferred = rdcs.filter((r) => r.rdcInferred);
  // KPI 总览只统计哨兵确认的数据，数字干净可信；推断量级在折叠区标题另标。
  const overviewRdcs = confirmed.length ? confirmed : rdcs;

  let body = '';
  if (confirmed.length) {
    body += `<div class="zone-title">✅ 哨兵确认的工作流（${confirmed.length}）</div>`;
    body += `<div class="zone-note">主动打了 ⟦TRACK⟧ 哨兵的会话，数据可信。点击展开看阶段明细。</div>`;
    body += confirmed.map(rdcCard).join('\n');
  }
  if (inferred.length) {
    const it = inferred.reduce((a, r) => ({ tok: a.tok + r.totals.tokens, cost: a.cost + r.totals.cost }), { tok: 0, cost: 0 });
    body += `<details class="zone"><summary>🕓 推断归因的历史会话（${inferred.length} 个 · ${fmtTok(it.tok)} · ${fmtCost(it.cost)}）— 未打哨兵，按首条消息推断，点击展开</summary>`
      + `<div class="zone-note" style="margin-top:8px">以下 RDC 由会话首条消息自动提炼，仅供回溯量级参考。想纳入正式统计请补打 ⟦TRACK wf⟧ 哨兵后重扫。</div>`
      + inferred.map(rdcCard).join('\n') + `</details>`;
  }
  if (!body) body = '<div class="section">暂无数据，先跑 collect.mjs。</div>';

  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>全链路可观测性数据追溯</title>
<style>${CSS}</style></head><body><div class="wrap">
<div class="topbar">🔍 全链路可观测性数据追溯</div>
${confirmed.length ? '<p class="note" style="margin-bottom:6px">总览数字仅统计哨兵确认的工作流；推断历史见下方折叠区。</p>' : ''}
${overview(overviewRdcs)}
${cmp}
<p class="note">阶段状态/任务结果为结构推断（可用 ⟦TRACK wf-end⟧ / gate 哨兵校准）。门禁/成本按价格表估算，成本按各阶段首选模型计。</p>
${body}
</div></body></html>`;
}



