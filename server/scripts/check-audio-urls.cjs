// 全量验证 songs.audio_url 可访问性
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

const CONC = 15, TIMEOUT = 12000;

async function checkUrl(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  const started = Date.now();
  try {
    // 用 Range GET（0-0 字节）而非 HEAD，部分 CDN 不支持 HEAD
    const res = await fetch(url, { signal: ctrl.signal, headers: { Range: 'bytes=0-1' }, redirect: 'follow' });
    clearTimeout(t);
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const cr = res.headers.get('content-range') || '';
    const status = res.status;
    await res.body?.cancel().catch(() => {});
    let verdict;
    if ((status === 200 || status === 206) && (ct.includes('audio') || ct.includes('octet') || cr)) verdict = 'VALID';
    else if ([403, 404, 410].includes(status)) verdict = 'DEAD-' + status;
    else verdict = 'OTHER-' + status + ':' + ct.slice(0, 30);
    return { status, ct, ms: Date.now() - started, verdict };
  } catch (e) {
    clearTimeout(t);
    const msg = (e.name === 'AbortError') ? 'TIMEOUT' : ('ERR:' + (e.cause?.code || e.message).slice(0, 40));
    return { status: 0, ct: '', ms: Date.now() - started, verdict: msg };
  }
}

async function main() {
  const songs = await prisma.$queryRawUnsafe(
    `select id, platform, title, audio_url from songs where audio_url is not null and audio_url <> '' order by id`
  );
  console.log('to check:', songs.length);
  const results = [];
  let i = 0;
  const worker = async () => {
    while (i < songs.length) {
      const s = songs[i++];
      const r = await checkUrl(s.audio_url);
      results.push({ id: s.id, platform: s.platform, title: s.title, ...r });
      if (results.length % 100 === 0) console.log('progress', results.length);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));

  const summary = {};
  for (const r of results) {
    const key = r.verdict.split(':')[0];
    summary[key] = (summary[key] || 0) + 1;
  }
  console.log('=== verdict summary ===');
  console.table(Object.entries(summary).map(([k, v]) => ({ verdict: k, n: v })));

  const out = 'D:/music_box/output/url-check-20261117.json';
  fs.writeFileSync(out, JSON.stringify({ checkedAt: new Date().toISOString(), summary, results }, null, 1));
  console.log('detail ->', out);

  // 给出若干 VALID 与 DEAD 样例
  const valid = results.filter(r => r.verdict === 'VALID');
  console.log('valid sample:', valid.slice(0, 5).map(r => `${r.id} ${r.status} ${r.ct}`));
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
