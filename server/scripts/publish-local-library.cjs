// 把磁盘缓存编目为曲库永久资产（独立运维脚本，免鉴权；路由版见 /api/audio-source/library/publish）
// 用法: node scripts/publish-local-library.cjs
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const AUDIO_CACHE_DIR = process.env.AUDIO_CACHE_DIR
  ? path.resolve(process.env.AUDIO_CACHE_DIR)
  : path.resolve(process.cwd(), '..', 'data', 'audio-cache');
const AUDIO_LIBRARY_DIR = process.env.AUDIO_LIBRARY_DIR
  ? path.resolve(process.env.AUDIO_LIBRARY_DIR)
  : path.resolve(process.cwd(), '..', 'data', 'audio-library');

const toFilename = (id) => id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.mp3';

async function main() {
  fs.mkdirSync(AUDIO_LIBRARY_DIR, { recursive: true });
  const songs = await prisma.song.findMany({ select: { id: true } });
  const publishedIds = [];
  let linked = 0, copied = 0, skipped = 0, already = 0;

  for (const s of songs) {
    const src = path.join(AUDIO_CACHE_DIR, toFilename(s.id));
    if (!fs.existsSync(src)) { skipped++; continue; }
    const dest = path.join(AUDIO_LIBRARY_DIR, toFilename(s.id));
    if (fs.existsSync(dest)) { already++; publishedIds.push(s.id); continue; }
    try {
      fs.linkSync(src, dest); // NTFS 硬链接零拷贝：缓存被 LRU 淘汰后曲库文件仍存活
      linked++;
      publishedIds.push(s.id);
    } catch {
      try { fs.copyFileSync(src, dest); copied++; publishedIds.push(s.id); }
      catch { skipped++; }
    }
  }

  let cataloged = 0;
  if (publishedIds.length) {
    await prisma.$executeRawUnsafe(
      `update songs set url_source = 'self-hosted', audio_url = '/audio-lib/' || regexp_replace(id, '[^a-zA-Z0-9_-]', '_', 'g') || '.mp3', url_checked_at = now(), url_failure_count = 0 where id = any($1::text[])`,
      publishedIds,
    );
    cataloged = publishedIds.length;
  }

  const libBytes = fs.readdirSync(AUDIO_LIBRARY_DIR).reduce((a, f) => {
    try { return a + fs.statSync(path.join(AUDIO_LIBRARY_DIR, f)).size; } catch { return a; }
  }, 0);

  console.log(`=== 曲库发布完成 ===`);
  console.log(`published(already)=${already} linked=${linked} copied=${copied} skipped(no cache)=${skipped}`);
  console.log(`cataloged songs: ${cataloged}`);
  console.log(`library dir: ${AUDIO_LIBRARY_DIR} (${(libBytes / 1048576 / 1024).toFixed(2)}GB, 实际占用≈0（硬链接）)`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
