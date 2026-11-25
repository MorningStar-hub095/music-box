import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';

/**
 * 自有版权曲库路由（2026-11-03 新增）
 *
 * 用途：提供本人拥有权利或已获授权的音频文件的播放入口，替代对第三方
 * （如网易云）外链音频的代理，规避公网分发的版权风险。
 *
 * 使用方式：
 *  1. 在 LOCAL_MUSIC_DIR（默认 <项目根>/local-music）放入音频文件（mp3/flac/wav/m4a/ogg）
 *  2. 同目录放置 library.json 清单，格式：
 *     [ { "id": "local-001", "title": "歌名", "artist": "歌手", "album": "专辑",
 *         "file": "a.mp3", "coverColor": "#17C3B2" } ]
 *     （file 必须是目录内的纯文件名；无清单时 tracks 返回空列表）
 *  3. 播放地址：GET /api/library/audio/<file>
 *
 * 演示模式（DEMO_MODE=true）下本路由是唯一可用的音频来源；
 * 非 Demo 环境同样可用（本地自托管场景）。
 */
const router = Router();

const ALLOWED_EXT = new Set(['.mp3', '.flac', '.wav', '.m4a', '.ogg']);

/** 清单文件结构 */
interface LibraryEntry {
  id: string;
  title: string;
  artist: string;
  album?: string;
  file: string;
  coverColor?: string;
}

function readManifest(): LibraryEntry[] {
  const manifestPath = path.join(config.localMusicDir, 'library.json');
  if (!fs.existsSync(manifestPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e: any) =>
        e && typeof e.file === 'string' &&
        ALLOWED_EXT.has(path.extname(e.file).toLowerCase()) &&
        !e.file.includes('/') && !e.file.includes('\\') && e.file !== '..'
    );
  } catch {
    return [];
  }
}

// 曲库清单（含播放地址），供前端浏览
router.get('/tracks', (_req: Request, res: Response) => {
  const tracks = readManifest().map((e) => ({
    id: e.id,
    title: e.title,
    artist: e.artist,
    album: e.album || '',
    coverColor: e.coverColor || '#17C3B2',
    audioUrl: `/api/library/audio/${encodeURIComponent(e.file)}`,
    platform: 'local',
    playable: true,
  }));
  res.json({ success: true, data: tracks });
});

// 音频文件（res.sendFile 内置 Range 支持，播放器可拖拽进度条）
router.get('/audio/:filename', (req: Request, res: Response) => {
  const filename = path.basename(req.params.filename); // basename 防路径穿越
  if (!ALLOWED_EXT.has(path.extname(filename).toLowerCase())) {
    return res.status(400).json({ error: '不支持的音频格式' });
  }
  const filePath = path.resolve(config.localMusicDir, filename);
  // 双重保险：解析后必须仍在曲库目录内
  if (!filePath.startsWith(path.resolve(config.localMusicDir) + path.sep)) {
    return res.status(400).json({ error: '非法路径' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '音频不存在' });
  }
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(500).end('音频服务异常');
    }
  });
});

export default router;
