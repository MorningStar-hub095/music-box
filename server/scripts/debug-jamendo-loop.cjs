// 插桩 importTrackObjects 循环：打印每首曲子的分支决策
const { execSync } = require('child_process');
const fs = require('fs');

execSync('npm run build', { cwd: 'D:/music_box/server', stdio: 'pipe' });

const f = 'D:/music_box/server/dist/modules/library/jamendo.service.js';
let s = fs.readFileSync(f, 'utf8');
if (!s.includes('[DBG]')) {
  s = s.replace(
    "for (const t of tracks) {",
    "for (const t of tracks) { console.log('[DBG] track:', t && t.id, 'name:', t && t.name, 'dur:', t && t.duration, 'dl_allowed:', t && t.audiodownload_allowed, 'dl:', t && (t.audiodownload || t.audio || '').slice(0, 60));",
  );
  s = s.replace(
    "outcome.skipped.push({ trackId: jamendoId, reason: `download_failed(${status},${body.length}B)` });",
    "console.log('[DBG] download_failed:', status, body.length); outcome.skipped.push({ trackId: jamendoId, reason: `download_failed(${status},${body.length}B)` });",
  );
  s = s.replace(
    "outcome.skipped.push({ trackId: jamendoId, reason: `validate:${v.reason}` });",
    "console.log('[DBG] validate_fail:', v.reason); outcome.skipped.push({ trackId: jamendoId, reason: `validate:${v.reason}` });",
  );
  s = s.replace(
    "outcome.imported++;",
    "console.log('[DBG] imported OK:', jamendoId); outcome.imported++;",
  );
  fs.writeFileSync(f, s);
  console.log('[DBG] instrumented v2');
}

process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/music_box';
process.env.JAMENDO_CLIENT_ID = 'b50cfeff';
const { importByTag } = require(f);
(async () => {
  const r = await importByTag('piano', 3);
  console.log('RESULT', JSON.stringify(r).slice(0, 500));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
