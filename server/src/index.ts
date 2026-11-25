import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { logger } from './lib/logger';
import { getCacheSize } from './lib/redis';
import { APP_VERSION, CHANGELOG } from './version';
import authRoutes from './modules/auth/auth.routes';
import songsRoutes from './modules/songs/songs.routes';
import genresRoutes from './modules/genres/genres.routes';
import languagesRoutes from './modules/languages/languages.routes';
import scenesRoutes from './modules/scenes/scenes.routes';
import moodsRoutes from './modules/moods/moods.routes';
import decadesRoutes from './modules/decades/decades.routes';
import tagsRoutes from './modules/tags/tags.routes';
import searchRoutes from './modules/search/search.routes';
import statsRoutes from './modules/stats/stats.routes';
import auditRoutes from './modules/audit/audit.routes';
import usersRoutes from './modules/users/users.routes';
import playlistsRoutes from './modules/playlists/playlists.routes';
import crawlerRoutes from './modules/crawler/crawler.routes';
import contentRoutes from './modules/content/content.routes';
import syncRoutes from './modules/sync/sync.routes';
import listeningRoutes from './modules/listening/listening.routes';
import recommendationRoutes from './modules/recommendation/recommendation.routes';
import emotionDnaRoutes from './modules/emotion-dna/emotion-dna.routes';
import socialDnaRoutes from './modules/social-dna/social-dna.routes';
import capsuleRoutes from './modules/capsules/capsule.routes';
import timeMachineRoutes from './modules/time-machine/time-machine.routes';
import genomeRoutes from './modules/genome/genome.routes';
import commentsRoutes from './modules/comments/comments.routes';
import { createRadioController } from './modules/radio/radio.controller';
import urlManagerRoutes from './modules/url-manager/url-manager.routes';
import { urlSchedulerService } from './modules/url-manager/url-manager.scheduler';
import cacheAdminRoutes from './modules/audio-cache/cache-admin.routes';
import audioRoutes from './modules/audio-cache/audio.routes';
import localLibraryRoutes from './modules/library/local-library.routes';
import refreshTrackRoutes from './modules/url-manager/refresh-track.routes';
import llmAdminRoutes from './modules/llm/llm-admin.routes';
import coverRoutes from './modules/cover/cover.routes';
import { createWeatherRoutes } from './modules/weather/weather.routes';
import { startScheduler } from './scheduler';

import { PrismaClient } from '@prisma/client';

// BigInt序列化支持
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const prisma = new PrismaClient();
const app = express();
// HTTP 服务器引用（供优雅关闭时关闭，停止接收新请求）
let httpServer: import('http').Server | null = null;

// 信任代理（生产环境通常需要）
if (config.trustProxy) {
  app.set('trust proxy', 1);
}

// 安全响应头（禁用跨域隔离策略，避免阻断前端跨源 fetch 请求）
app.use(helmet({
  crossOriginResourcePolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// CORS白名单配置
app.use(cors({
  origin: (origin, callback) => {
    // 允许无origin的请求（如服务器端请求、Postman等）
    if (!origin) return callback(null, true);

    if (config.allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] 拒绝来源: ${origin}`);
      callback(new Error('CORS策略不允许此来源'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Accept', 'Origin', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges'],
}));

// 请求体大小限制
app.use(express.json({ limit: config.requestBodyLimit }));

// 缓存管理路由：必须在全局限流器之前注册，确保不受限流影响
app.use('/api/cache', cacheAdminRoutes);

// 全局速率限制（缓存API已在上方注册，不受此限流器影响）
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: { success: false, error: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// 认证接口更严格的速率限制
const authLimiter = rateLimit({
  windowMs: config.authRateLimit.windowMs,
  max: config.authRateLimit.max,
  message: { success: false, error: '登录尝试过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 搜索接口速率限制
const searchLimiter = rateLimit({
  windowMs: config.searchRateLimit.windowMs,
  max: config.searchRateLimit.max,
  message: { success: false, error: '搜索请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 音频刷新接口专属限流：前端匿名播放器会频繁调用，需更严格限制防止滥用
const refreshTrackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 20,                  // 每 IP 最多 20 次
  message: { success: false, error: '刷新过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 请求日志中间件
if (config.enableRequestLogging) {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(`[SLOW-REQUEST] ${req.method} ${req.path} - ${duration}ms`);
      }
    });
    next();
  });
}

// 健康检查（统一端点，两个路径复用同一 payload，保持对外兼容）：
//   - nginx、scripts/health.js、start-server.cjs、troubleshoot.js 使用 /health
//   - scripts/startup.cjs、vite 开发代理使用 /api/health
function getHealthPayload() {
  const mem = process.memoryUsage();
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    port: config.port,
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + 'MB',
    },
    cacheEntries: getCacheSize(),
    pid: process.pid,
    nodeVersion: process.version,
  };
}
app.get('/health', (_req, res) => {
  res.json(getHealthPayload());
});
app.get('/api/health', (_req, res) => {
  res.json(getHealthPayload());
});

// 版本信息：桌面版主进程启动时据此做「已更新到 vX.Y.Z」弹窗提示；
// 前端与运维脚本亦可用于版本核对
app.get('/api/version', (_req, res) => {
  res.json({
    success: true,
    data: {
      version: APP_VERSION,
      changelog: CHANGELOG,
    },
  });
});

// 公开配置：前端据此展示「演示模式」横幅并降级音频 UI
app.get('/api/config', (_req, res) => {
  res.json({
    demoMode: config.demoMode,
    banner: config.demoMode
      ? '演示模式：为遵守版权法规，第三方音频播放已停用；可浏览、搜索、收藏，自有版权曲库可正常播放。'
      : '',
  });
});

// 自有版权曲库（演示模式下的唯一音频来源；本地自托管同样可用）
app.use('/api/library', localLibraryRoutes);

// 永久音频曲库静态源（2026-11-18 三层供给架构 · 方案 B 自托管模拟层）：
// 库内文件带 Accept-Ranges，换 CDN 时仅需改 audio_url 为绝对地址
import audioSourceRoutes from './modules/library/audio-source.routes';
fs.mkdirSync(config.audioLibraryDir, { recursive: true });
app.use('/audio-lib', express.static(config.audioLibraryDir, {
  acceptRanges: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.mp3')) res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.setHeader('X-Audio-Source', 'self-hosted');
  },
}));

// 音频来源管理（统计/搜索/导入/发布；导入与发布仅管理员）
app.use('/api/audio-source', audioSourceRoutes);

// 认证路由（应用更严格的速率限制）
app.use('/api/auth', authLimiter, authRoutes);

// 公开接口：获取有效的音频 URL（缓存优先，过期才刷新）
// 演示模式：该接口会把第三方直链发给客户端，同样属于版权出口，整体关闭
app.use('/api/refresh-track', refreshTrackLimiter, (req, res, next) => {
  if (config.demoMode) {
    return res.status(403).json({ error: '演示模式下第三方音频已停用（版权合规）', demoMode: true });
  }
  next();
}, refreshTrackRoutes);

// 音频流路由（代理缓存 + 预检测 + 错误上报）
app.use('/api/audio', audioRoutes);

// 封面图片代理路由（2026-11-20 新增：修复网易云防盗链导致封面 403）
// 应用专属限流（复用现有 middleware/rateLimit）：图片代理开销较小，限 300 次/分钟
import { createRateLimit } from './middleware/rateLimit';
const coverLimiter = createRateLimit(60_000, 300, '封面请求过于频繁，请稍后再试');
app.use('/api/cover', coverLimiter, coverRoutes);

// 歌曲路由
app.use('/api/songs', songsRoutes);

// 分类路由
app.use('/api/genres', genresRoutes);
app.use('/api/languages', languagesRoutes);
app.use('/api/scenes', scenesRoutes);
app.use('/api/moods', moodsRoutes);
app.use('/api/decades', decadesRoutes);
app.use('/api/tags', tagsRoutes);

// 搜索路由（应用搜索速率限制）
app.use('/api/search', searchLimiter, searchRoutes);

// 统计路由
app.use('/api/stats', statsRoutes);

// 审计路由
app.use('/api/audit', auditRoutes);

// 用户路由
app.use('/api/users', usersRoutes);

// 播放列表路由
app.use('/api/playlists', playlistsRoutes);

// 爬虫和归档路由
app.use('/api/crawler', crawlerRoutes);

// 内容管理路由
app.use('/api/content', contentRoutes);

// 数据同步路由
app.use('/api/sync', syncRoutes);

// 聆听事件路由
app.use('/api/listening', listeningRoutes);

// 个性化推荐路由
app.use('/api/recommendation', recommendationRoutes);

// 情绪 DNA 指纹路由
app.use('/api/emotion-dna', emotionDnaRoutes);

// 社交 DNA 暗号路由
app.use('/api/social-dna', socialDnaRoutes);

// 时间胶囊路由
app.use('/api/capsules', capsuleRoutes);

// 时光机路由
app.use('/api/time-machine', timeMachineRoutes);

// 基因图谱路由
app.use('/api/genome', genomeRoutes);
app.use('/api/comments', commentsRoutes);
app.use('/api/radio', createRadioController(prisma));

// 天气智能电台路由
app.use('/api/weather', createWeatherRoutes(prisma));

// URL 管理路由
app.use('/api/url-manager', urlManagerRoutes);

// LLM 提供商管理路由
app.use('/api/llm', llmAdminRoutes);

// ==================== 静态文件服务 ====================
// 桌面应用自动更新包托管目录（generic provider feed）：
//   - 目录由环境变量 MB_UPDATES_DIR 指定，默认 <server>/static/updates
//   - 发布流程将 MusicBox-Setup-x.y.z.exe / .blockmap / latest.yml 放入该目录，
//     桌面版 electron-updater 即可从 http://<host>/updates/ 完成检测与下载
//   - 仅静态文件服务，不做任何写操作，未配置/目录为空时不影响其他功能
const updatesDir = process.env.MB_UPDATES_DIR || path.join(__dirname, '..', 'static', 'updates');
try {
  fs.mkdirSync(updatesDir, { recursive: true });
  app.use('/updates', express.static(updatesDir, { maxAge: '1h' }));
  console.log(`[UPDATE-FEED] 更新包托管目录已启用: ${updatesDir} (路由 /updates)`);
} catch (e) {
  console.warn('[UPDATE-FEED] 更新包托管目录创建失败，自动更新托管不可用:', e);
}

// 提供 Web 前端构建产物，使 API 服务器也能直接承载前端页面
const webDistPath = path.join(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  // SPA 回退：所有非 /api 路由都返回 index.html
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    const indexPath = path.join(webDistPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });
  console.log(`[STATIC] 已加载前端静态文件: ${webDistPath}`);
} else {
  console.warn(`[STATIC] 前端静态文件目录不存在: ${webDistPath}`);
}

// ============================================
// 稳定性保护：全局错误处理
// ============================================

// 捕获未处理的 Promise 拒绝（防止进程退出）
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('[STABILITY] 未处理的 Promise 拒绝:', reason?.message || reason);
  // 不退出进程，记录日志即可
});

// 捕获未处理的异常（防止进程退出）
process.on('uncaughtException', (err: Error) => {
  logger.error('[STABILITY] 未捕获的异常:', err.message);
  logger.error('[STABILITY] 堆栈:', err.stack);
  // 不立即退出，给正在处理的请求一些时间完成
  // 只有在严重错误（如内存溢出）时才退出
  if (err.message.includes('ENOMEM') || err.message.includes('out of memory')) {
    logger.error('[STABILITY] 内存溢出，正在优雅关闭...');
    gracefulShutdown('OOM');
  }
});

// 优雅关闭函数
function gracefulShutdown(signal: string) {
  logger.info(`[STABILITY] 收到 ${signal} 信号，正在优雅关闭...`);
  // 停止定时任务
  try {
    urlSchedulerService.stop?.();
  } catch { /* ignore */ }
  // 关闭 HTTP 服务器（停止接收新请求）
  try {
    httpServer?.close();
  } catch { /* ignore */ }
  // 断开数据库连接
  try {
    prisma.$disconnect().catch(() => {});
  } catch { /* ignore */ }
  // 关闭进程（3 秒兜底强制退出，避免卡死）
  setTimeout(() => {
    logger.info('[STABILITY] 进程退出');
    process.exit(0);
  }, 3000).unref();
}

// 注册关闭信号处理
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 内存监控（每5分钟检查一次）；.unref() 避免阻止进程优雅退出
setInterval(() => {
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  if (heapUsedMB > 512) {
    console.warn(`[STABILITY] 内存使用偏高: ${heapUsedMB}MB，触发GC`);
    if (global.gc) global.gc();
  }
}, 5 * 60 * 1000).unref();

// 全局错误处理中间件
app.use((err: any, req: any, res: any, next: any) => {
  logger.error('[UNHANDLED ERROR]', err);
  res.status(500).json({ success: false, error: '服务器内部错误' });
});

// 启动服务（仅在直接运行时启动，避免测试导入时占用端口）
if (require.main === module) {
  // 端口可用性检查
  import('net').then(({ createServer }) => {
    const tester = createServer();
    tester.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[ERROR] 端口 ${config.port} 已被占用，请执行以下操作之一：`);
        console.error(`  1. 终止占用端口的进程后重试`);
        console.error(`  2. 修改 server/.env 中的 PORT 为其他端口`);
        console.error(`  3. 使用环境变量启动: PORT=其他端口 npm run dev`);
        process.exit(1);
      }
      throw err;
    });
    tester.once('listening', () => {
      tester.close(() => {
        httpServer = app.listen(config.port, () => {
          logger.info(`API服务运行在 http://localhost:${config.port}`);
          startScheduler();
          // 启动 URL 管理调度器
          urlSchedulerService.start();
        });
      });
    });
    tester.listen(config.port);
  });
}

export default app;
