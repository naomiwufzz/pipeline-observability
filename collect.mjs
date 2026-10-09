// collect.mjs
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectBatch, readOffsets, writeOffsets } from './lib/ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = process.env.PIPELINE_OBSERVABILITY_SOURCE ?? join(HERE, 'input');
const OUT = process.env.PIPELINE_OBSERVABILITY_OUT ?? join(HERE, 'workspace-cache');
const LEDGER = join(OUT, 'phases.ndjson');
const OFFSETS = join(OUT, 'offsets.json');

function loadLedgerBySession() {
  const map = new Map();
  if (!existsSync(LEDGER)) return map;
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (!map.has(rec.sessionId)) map.set(rec.sessionId, []);
      map.get(rec.sessionId).push(line);
    } catch { /* skip */ }
  }
  return map;
}

function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const offsets = readOffsets(OFFSETS);
  const bySession = loadLedgerBySession();
  const files = readdirSync(SRC).filter((f) => f.endsWith('.jsonl'));
  const { changed, failed, skipped, updates } = collectBatch(files, offsets, {
    statSize: (f) => statSync(join(SRC, f)).size,
    readText: (f) => readFileSync(join(SRC, f), 'utf8'),
  });
  for (const [sid, lines] of updates) bySession.set(sid, lines);
  for (const s of skipped) console.error(`collect: skip ${s.file} (${s.code})`);
  const out = [...bySession.keys()].sort()
    .flatMap((sid) => bySession.get(sid)).join('\n');
  writeFileSync(LEDGER, out + (out ? '\n' : ''));
  writeOffsets(OFFSETS, offsets);
  console.log(`collect: ${changed} session(s) updated, ${files.length} scanned${failed ? `, ${failed} skipped` : ''}`);
}

main();
