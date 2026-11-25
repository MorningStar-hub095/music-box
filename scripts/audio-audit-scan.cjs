/** 音频文件有效性 + 重复检测扫描 */
const fs = require('fs');
const path = require('path');

const ROOTS = ['D:/music_box/data/audio-cache', 'D:/music_box/data/web-public-audio-backup/audio', 'D:/music_box/music'];

function isMp3(buf) {
  if (buf.length < 4) return { ok: false, why: 'too-small' };
  // ID3 标签
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return { ok: true, kind: 'ID3' };
  // MPEG 帧同步 (0xFF Ex/Fx)
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return { ok: true, kind: 'MPEG-frame' };
  // 常见误存内容
  const head = buf.slice(0, 64).toString('latin1').toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return { ok: false, why: 'html-page' };
  if (head.startsWith('{') || head.startsWith('{"code"')) return { ok: false, why: 'json-error' };
  if (buf[0] === 0x50 && buf[1] === 0x4b) return { ok: false, why: 'zip-container' };
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return { ok: false, why: 'gif' };
  if (buf[0] === 0x89 && buf[1] === 0x50) return { ok: false, why: 'png' };
  return { ok: false, why: 'unknown-magic(' + buf.slice(0, 4).toString('hex') + ')' };
}

const report = { total: 0, ok: 0, bad: [], tiny: [], bySize: new Map() };
const dupBySize = new Map();

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  const files = fs.readdirSync(root, { recursive: true }).filter((f) => /\.(mp3|wav|flac|m4a|aac|ogg)$/i.test(f));
  for (const f of files) {
    const full = path.join(root, f);
    const st = fs.statSync(full);
    if (!st.isFile()) continue;
    report.total++;
    const fd = fs.openSync(full, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    const magic = isMp3(buf);
    if (magic.ok) report.ok++;
    else report.bad.push({ file: full, size: st.size, why: magic.why, head: buf.toString('latin1').replace(/[^\x20-\x7e]/g, '.').slice(0, 40) });
    if (st.size < 100 * 1024 && st.size > 0) report.tiny.push({ file: full, size: st.size });
    if (st.size === 0) report.bad.push({ file: full, size: 0, why: 'zero-size', head: '' });
    const key = st.size + '@' + root;
    dupBySize.set(st.size, [...(dupBySize.get(st.size) || []), full]);
  }
}

console.log(`总文件数=${report.total} 魔数正常=${report.ok}`);
console.log(`\n--- 异常文件 (${report.bad.length}) ---`);
report.bad.slice(0, 40).forEach((b) => console.log(`${b.size}\t${b.why}\t${b.file.replace('D:/music_box/', '')}\thead=${b.head}`));
console.log(`\n--- 小于 100KB 的文件 (${report.tiny.length}) ---`);
report.tiny.slice(0, 40).forEach((t) => console.log(`${t.size}\t${t.file.replace('D:/music_box/', '')}`));

// 同大小疑似重复（≥2 个文件，且大于 500KB）
const dups = [...dupBySize.entries()].filter(([s, list]) => list.length >= 2 && s > 500 * 1024);
console.log(`\n--- 同大小疑似重复组 (${dups.length} 组) ---`);
for (const [size, list] of dups.slice(0, 20)) {
  console.log(`${size} bytes ×${list.length}:`);
  list.forEach((f) => console.log('   ' + f.replace('D:/music_box/', '')));
}
