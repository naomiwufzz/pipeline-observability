// render.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate, compareWindows, DEFAULT_PRICES } from './lib/aggregate.mjs';
import { renderHtml } from './lib/html.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.PIPELINE_OBSERVABILITY_OUT ?? join(HERE, 'workspace-cache');
const LEDGER = join(OUT, 'phases.ndjson');
const HTML = join(OUT, 'dashboard.html');

// 读 config：价格表 prices 与内置 DEFAULT_PRICES 浅合并（config 覆盖/补充同名型号，
// 其余型号回落到内置默认），对比窗口 compareWindowDays。
let cfg = {};
const configPath = process.env.PIPELINE_OBSERVABILITY_CONFIG ?? join(HERE, 'config.json');
try { cfg = JSON.parse(readFileSync(configPath, 'utf8')); } catch { /* use defaults */ }
const prices = { ...DEFAULT_PRICES, ...(cfg.prices || {}) };
const windowDays = cfg.compareWindowDays || 7;

const phases = [];
if (existsSync(LEDGER)) {
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { phases.push(JSON.parse(line)); } catch { /* skip */ }
  }
}
const rdcs = aggregate(phases, { prices });
const compare = compareWindows(rdcs, { windowDays, prices });
writeFileSync(HTML, renderHtml(rdcs, { compare }));
console.log(`render: ${phases.length} phase(s) -> ${HTML}`);
