// 缓存音频文件分析：容器识别 + 时长估算（MP3 帧解析 / M4A mvhd）+ 与 DB 时长对比
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

const CACHE_DIR = 'D:/music_box/data/audio-cache';

function toFilename(trackId) {
  return trackId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.mp3';
}

function readMvhd(buf) {
  // 在文件中查找 mvhd box
  const idx = buf.indexOf(Buffer.from('mvhd'));
  if (idx === -1) return null;
  const ver = buf[idx + 4];
  if (ver === 0) {
    const timescale = buf.readUInt32BE(idx + 12);
    const dur = buf.readUInt32BE(idx + 16);
    return { timescale, dur, seconds: dur / timescale };
  }
  return null;
}

const BITRATES = { // MPEG1 Layer3
  1: 32, 2: 40, 3: 48, 4: 56, 5: 64, 6: 80, 7: 96, 8: 112, 9: 128, 10: 160, 11: 192, 12: 224, 13: 256, 14: 320
};
const SAMPLE_RATES = { 0: 44100, 1: 48000, 2: 32000 };

function mp3Info(buf) {
  // 跳过 ID3v2
  let off = 0;
  if (buf.length > 10 && buf.slice(0, 3).toString() === 'ID3') {
    const sz = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    off = 10 + sz;
  }
  // 找第一个帧头
  for (let i = off; i < Math.min(off + 65536, buf.length - 4); i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      const verBits = (buf[i + 1] >> 3) & 3; // 3=MPEG1
      const layerBits = (buf[i + 1] >> 1) & 3; // 1=Layer3
      const brIdx = (buf[i + 2] >> 4) & 15;
      const srIdx = (buf[i + 3] >> 2) & 3;
      if (verBits === 3 && layerBits === 1 && brIdx >= 1 && brIdx <= 14 && srIdx <= 2) {
        const bitrate = BITRATES[brIdx] * 1000;
        const sampleRate = SAMPLE_RATES[srIdx];
        // 查找 Xing/Info (VBR 头, 通常在前几帧)
        const searchEnd = Math.min(i + 4096, buf.length);
        const xingIdx = buf.indexOf(Buffer.from('Xing'), i, searchEnd);
        const infoIdx = buf.indexOf(Buffer.from('Info'), i, searchEnd);
        const x = xingIdx !== -1 ? xingIdx : infoIdx;
        if (x !== -1) {
          const flags = buf.readUInt32BE(x + 4);
          if (flags & 1) {
            const frames = buf.readUInt32BE(x + 8);
            const samplesPerFrame = 1152;
            return { bitrate, sampleRate, seconds: frames * samplesPerFrame / sampleRate, vbr: true };
          }
        }
        // CBR 估算
        const audioBytes = buf.length - i;
        return { bitrate, sampleRate, seconds: audioBytes * 8 / bitrate, vbr: false };
      }
    }
  }
  return null;
}

async function main() {
  const songs = await prisma.$queryRawUnsafe(
    `select id, title, duration, playable, archived, audio_url from songs order by id`
  );
  const byFile = new Map(songs.map(s => [toFilename(s.id), s]));
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.toLowerCase().endsWith('.mp3'));
  console.log('cache files:', files.length, 'songs:', songs.length);

  const results = [];
  let unmapped = 0;
  for (const f of files) {
    const full = path.join(CACHE_DIR, f);
    const size = fs.statSync(full).size;
    const fd = fs.openSync(full, 'r');
    const head = Buffer.alloc(Math.min(size, 2 * 1024 * 1024));
    fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    const isM4a = head.indexOf(Buffer.from('ftyp'), 4) !== -1 && head.indexOf(Buffer.from('ftyp'), 4) < 32;
    let info;
    if (isM4a) {
      info = readMvhd(head);
      if (info) info = { ...info, container: 'm4a' };
      else info = { container: 'm4a-unknown' };
    } else {
      const m = mp3Info(head);
      info = m ? { ...m, container: 'mp3' } : { container: 'unknown' };
    }
    const s = byFile.get(f);
    if (!s) unmapped++;
    results.push({
      file: f, size, sizeMB: +(size / 1048576).toFixed(2),
      container: info.container || '?',
      seconds: info.seconds ? Math.round(info.seconds) : null,
      vbr: info.vbr ?? null,
      dbDuration: s?.duration ?? null,
      playable: s?.playable ?? null,
      archived: s?.archived ?? null,
      title: s?.title ?? null,
      songId: s?.id ?? null,
    });
  }
  console.log('unmapped files:', unmapped);

  // 分类统计
  const cnt = (pred, label) => {
    const n = results.filter(pred).length;
    console.log(label, n);
    return n;
  };
  console.log('=== 容器分布 ===');
  const cont = {};
  for (const r of results) cont[r.container] = (cont[r.container] || 0) + 1;
  console.table(Object.entries(cont).map(([k, v]) => ({ container: k, n: v })));

  // 试听片段判定：时长 < 90s（DB 时长未知或远大于实际时长）
  const clips = results.filter(r => r.seconds !== null && r.seconds < 90 && r.container !== 'unknown');
  console.log('=== 疑似试听片段 (<90s):', clips.length, '===');
  for (const c of clips) console.log(`${c.file}  ${c.seconds}s  db=${c.dbDuration}s  ${c.sizeMB}MB  ${c.title}`);

  const unknown = results.filter(r => r.container === 'unknown' || r.container === 'm4a-unknown');
  console.log('=== 无法解析容器/时长:', unknown.length, '===');
  for (const u of unknown.slice(0, 20)) console.log(`${u.file} ${u.sizeMB}MB`);

  const out = 'D:/music_box/output/cache-check-20261117.json';
  fs.writeFileSync(out, JSON.stringify(results, null, 1));
  console.log('detail ->', out);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
