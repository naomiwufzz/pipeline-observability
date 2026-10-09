// session.mjs
import { parseSentinels } from './sentinel.mjs';

const DEFAULT_KB = ['kb-consume', 'dev-wiki', 'kb-search'];
const KB_PREFIX = ['codegraph_', 'mcp__codegraph__'];

// 用户纠正启发式：命中任一词，则该条 user 消息计一次纠正。
// 只收「对既有产出表达不满/要求返工」的词，避开「不要/别」等高频泛用词以降噪。
const CORRECTION_RE = /(不对|错了|搞错|弄错|写错|改错|不是这样|不该这么|不应该这么|重来|重写|回退|撤销|revert|rollback|白改|方向错|理解错)/i;

// 非任务意图的噪声行前缀：skill 调用前缀、系统注入、图片占位等，归因时跳过。
const NOISE_PREFIX = ['Base directory for this skill:', 'Caveat:', '[Request', '[Image', '<', 'Contents of',
  'This may or may not', 'This session is being', 'The user opened', 'DO NOT respond'];
// 从一段真人 user 文本里提炼「意图行」：跳过 skill/系统前缀行，取首行有实义的中文/描述行。
function pickIntentLine(text) {
  if (!text) return '';
  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line) continue;
    if (NOISE_PREFIX.some((p) => line.startsWith(p))) continue;
    // @引用取其首段路径的项目名（@ent-web/src/x → ent-web），保留归因价值；去掉 /skill 调用。
    const cleaned = line
      .replace(/@([\w-]+)[/\\][^\s]*/g, '$1')   // @proj/path → proj
      .replace(/@"?([^\s"]+)"?/g, '$1')          // @文件.pdf → 文件.pdf（保留名字）
      .replace(/\/[\w:-]+/g, '')                  // 去 /skill 调用
      .replace(/\s+/g, ' ').trim();
    // 过滤代码噪声：无中文时，纯标识符（select/handleX）或以符号/括号开头（&hover {、.foo）的丢弃
    const hasCJK = /[一-龥]/.test(cleaned);
    const looksLikeCode = !hasCJK && (/^[A-Za-z_$][\w$]*$/.test(cleaned) || /^[^A-Za-z0-9一-龥]/.test(cleaned));
    if (cleaned.length >= 4 && !looksLikeCode) return cleaned;
  }
  return '';
}
// 把意图行压成一个可读的 fallback rdc slug（限长，去标点）。
export function deriveIntent(text) {
  const line = pickIntentLine(text);
  if (!line) return '';
  return line.replace(/["'`，。：、！？,.:!?]/g, '').slice(0, 24);
}

function isKb(name, kbTools) {
  return kbTools.includes(name) || KB_PREFIX.some((p) => name.startsWith(p));
}

function emptyPhase(rdc, wf, phase, nth, ts) {
  return {
    rdc, wf, phase, nth, title: '', sessionId: '', tStart: ts, tEnd: ts, durationMs: 0,
    status: 'done', gate: null, rdcInferred: false,
    owner: '', doc: '', days: null, wfResult: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 },
    turns: 0,
    toolCalls: { total: 0, ok: 0, err: 0, byTool: {} },
    subagents: 0, subagentCalls: 0,
    corrections: 0,
    models: [], subagentTypes: [],
    kb: { calls: 0, hits: 0, refs: 0 },
    _models: new Set(), _subs: new Set(),
  };
}

export function buildPhases(events, opts = {}) {
  const kbTools = opts.kbTools || DEFAULT_KB;
  const evs = [...events].sort((a, b) => a.ts - b.ts);
  const phases = [];
  let cur = null;
  let rdc = null;
  let wf = null;
  let title = '';
  let owner = '';
  let doc = '';
  let days = null;
  let firstIntent = ''; // 无 wf 哨兵时用作 fallback rdc（首条真人消息提炼的意图）
  // 会话级 pending：tool_use.id -> phase。tool_result 可能跨消息/跨阶段回来，
  // 挂在所属阶段上结算，避免跨阶段配对丢失。
  const pending = new Map();

  const open = (name, nth, ts) => {
    cur = emptyPhase(rdc, wf, name, nth, ts);
    cur.title = title;
    cur.owner = owner; cur.doc = doc; cur.days = days;
    phases.push(cur);
  };
  const ensureUnattributed = (ts) => {
    if (!cur) open('__unattributed__', 0, ts);
  };

  for (const e of evs) {
    const sentinels = e.texts.flatMap((t) => parseSentinels(t));
    for (const s of sentinels) {
      if (s.kind === 'wf') {
        rdc = s.rdc; wf = s.id; title = s.title || title;
        // wf 级元信息：存为循环级变量，open 时注入到每个阶段；当前阶段（若已开）即时回填
        if (s.owner) owner = s.owner;
        if (s.doc) doc = s.doc;
        if (s.days != null) days = s.days;
        if (cur) { cur.owner = owner; cur.doc = doc; cur.days = days; }
      } else if (s.kind === 'wf-end') {
        if (cur) cur.wfResult = s.result;
      } else if (s.kind === 'phase') { open(s.name, s.nth, e.ts); }
      else if (s.kind === 'gate') {
        for (let i = phases.length - 1; i >= 0; i--) {
          if (phases[i].phase === s.phase) { phases[i].gate = s.result; break; }
        }
      }
    }
    ensureUnattributed(e.ts);
    if (cur.rdc == null && rdc != null) { cur.rdc = rdc; cur.wf = wf; cur.title = title; }
    cur.sessionId = e.sessionId || cur.sessionId;
    cur.tEnd = e.ts;
    cur.durationMs = cur.tEnd - cur.tStart;

    if (e.role === 'assistant') {
      cur.turns += 1;
      if (e.model && !cur._models.has(e.model)) { cur._models.add(e.model); cur.models.push(e.model); }
      if (e.usage) {
        for (const k of ['input', 'output', 'cacheRead', 'cacheCreate', 'total']) {
          cur.tokens[k] += e.usage[k];
        }
      }
      if (e.isSidechain) cur.subagents += 1;
      for (const tu of e.toolUses) {
        cur.toolCalls.total += 1;
        cur.toolCalls.byTool[tu.name] = (cur.toolCalls.byTool[tu.name] || 0) + 1;
        const kb = isKb(tu.name, kbTools);
        if (kb) cur.kb.calls += 1;
        if (tu.name === 'Task') {
          cur.subagentCalls += 1;
          if (tu.subagentType && !cur._subs.has(tu.subagentType)) { cur._subs.add(tu.subagentType); cur.subagentTypes.push(tu.subagentType); }
        }
        pending.set(tu.id, cur);
        cur._kbPending = cur._kbPending || new Set();
        if (kb) cur._kbPending.add(tu.id);
      }
    } else if (e.role === 'user') {
      // 用户纠正启发式：只看真人 user 文本（tool_result 不带 texts），命中即 +1
      for (const t of e.texts) { if (CORRECTION_RE.test(t)) { cur.corrections += 1; break; } }
      // 归因 fallback：记住首条能提炼出意图的真人消息
      if (!firstIntent) { for (const t of e.texts) { const d = deriveIntent(t); if (d) { firstIntent = d; break; } } }
    }
    for (const tr of e.toolResults) {
      const owner = pending.get(tr.id);
      if (!owner) continue;
      pending.delete(tr.id);
      const good = !tr.isError && tr.len > 0;
      if (good) owner.toolCalls.ok += 1; else owner.toolCalls.err += 1;
      if (owner._kbPending && owner._kbPending.has(tr.id)) {
        owner._kbPending.delete(tr.id);
        if (good) { owner.kb.hits += 1; owner.kb.refs += 1; }
      }
    }
  }
  // 归因 fallback：整个会话都没打 wf 哨兵时，用首条消息提炼的意图作 rdc，
  // 并标 rdcInferred=true（渲染层标注「推断」，与哨兵确认的区分开）。
  if (wf == null && firstIntent) {
    const fbRdc = firstIntent;
    const fbWf = `auto:${firstIntent}`; // 同会话归为一个 fallback 工作流
    for (const p of phases) {
      if (p.rdc == null) {
        p.rdc = fbRdc; p.wf = fbWf; p.rdcInferred = true;
        if (!p.title) p.title = firstIntent;
      }
    }
  }
  return phases.map(({ _kbPending, _models, _subs, ...p }) => p);
}
