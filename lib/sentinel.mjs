const RE = /⟦TRACK\s+([^⟧]*)⟧/g;

// 解析 key=value，支持 value 用双引号包裹（可含空格）
function parseFields(body) {
  const fields = {};
  const re = /(\w+)=("([^"]*)"|(\S+))/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    fields[m[1]] = m[3] !== undefined ? m[3] : m[4];
  }
  return fields;
}

export function parseSentinels(text) {
  const out = [];
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(text)) !== null) {
    const body = m[1].trim();
    const sp = body.indexOf(' ');
    const kind = (sp === -1 ? body : body.slice(0, sp)).trim();
    const f = parseFields(sp === -1 ? '' : body.slice(sp + 1));
    if (kind === 'wf' && f.rdc && f.id) {
      // owner/doc/days 为可选元信息（CC transcript 无对应硬数据，打了才显示）
      out.push({
        kind: 'wf', rdc: f.rdc, id: f.id, title: f.title ?? '',
        owner: f.owner ?? '', doc: f.doc ?? '',
        days: f.days != null && f.days !== '' ? Number(f.days) : null,
      });
    } else if (kind === 'wf-end' && ['SUCCESS', 'FAIL', 'ABANDON'].includes(f.result)) {
      out.push({ kind: 'wf-end', result: f.result });
    } else if (kind === 'phase' && f.name) {
      out.push({ kind: 'phase', name: f.name, nth: f.nth ? Number(f.nth) : 1 });
    } else if (kind === 'gate' && f.phase && ['PASS', 'FAIL', 'PARTIAL'].includes(f.result)) {
      out.push({ kind: 'gate', phase: f.phase, result: f.result });
    }
  }
  return out;
}
