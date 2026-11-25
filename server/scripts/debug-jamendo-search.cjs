// 临时调试：重建 dist → 插桩 → 运行搜索并打印 URL/响应（调试完 npm run build 还原）
const { execSync } = require('child_process');
const fs = require('fs');

execSync('npm run build', { cwd: 'D:/music_box/server', stdio: 'inherit' });

const f = 'D:/music_box/server/dist/modules/library/jamendo.service.js';
let s = fs.readFileSync(f, 'utf8');
const target = "const eligible = search.tracks";
const repl = "console.log('[DBG] search n:', search.tracks.length, JSON.stringify(search.tracks.map(t=>({id:t.id,dur:t.duration,dl:t.audiodownload_allowed})).slice(0,5))); const eligible = search.tracks";
if (!s.includes(target)) { console.error('target not found'); process.exit(1); }
fs.writeFileSync(f, s.replace(target, repl));
console.log('[DBG] instrumented');

process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/music_box';
process.env.JAMENDO_CLIENT_ID = 'b50cfeff';
const { importByTag } = require(f);
(async () => {
  const r = await importByTag('piano', 3);
  console.log('RESULT ok:', r.ok, 'n:', r.tracks.length);
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
