import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';

// 桌面安装版通过 MB_ENV_FILE 指向用户数据目录下的可写 env 文件；默认加载 cwd 下的 .env
dotenv.config(process.env.MB_ENV_FILE ? { path: process.env.MB_ENV_FILE } : {});

// 项目根目录（兼容 ts-node 的 src/ 与编译后的 dist/ 两种运行位置）
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const TOOLS_DIR = process.env.TOOLS_DIR || path.join(PROJECT_ROOT, 'tools');
export const MUSIC_CRAWLER_SCRIPT = path.join(TOOLS_DIR, 'music_crawler.py');
export const AUTO_CLASSIFIER_SCRIPT = path.join(TOOLS_DIR, 'auto_classifier.py');

// 环境判断
const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// 开发环境固定的 JWT 密钥（保证重启后 token 不失效）
const DEV_JWT_SECRET = 'music-box-dev-secret-2024-do-not-use-in-prod';

// JWT密钥安全校验
function validateJwtSecret(secret: string | undefined): string {
  const defaultSecret = 'music-box-secret-key';
  
  // 生产环境强制要求设置强密钥
  if (isProduction) {
    if (!secret || secret === defaultSecret) {
      console.error('[SECURITY] 生产环境必须设置强随机JWT密钥！');
      console.error('[SECURITY] 请设置环境变量 JWT_SECRET（至少32字符）');
      process.exit(1);
    }
    if (secret.length < 32) {
      console.error('[SECURITY] JWT密钥长度不足32字符！');
      process.exit(1);
    }
  }
  
  // 开发/测试环境：使用固定密钥，避免重启后 token 失效导致前端所有请求 401
  if (!secret || secret === defaultSecret) {
    console.warn('[SECURITY] 警告: 使用开发固定JWT密钥，生产环境请务必设置 JWT_SECRET 环境变量！');
    return DEV_JWT_SECRET;
  }
  
  return secret;
}

// 桌面端共享 API Key 安全校验（仿 validateJwtSecret）
function validateDesktopApiKey(key: string | undefined): string {
  const defaultKey = 'mb-desktop-secret-key';
  if (isProduction) {
    if (!key || key === defaultKey) {
      console.error('[SECURITY] 生产环境必须设置强随机的 DESKTOP_API_KEY！');
      console.error('[SECURITY] 当前使用默认值，存在认证绕过风险');
      process.exit(1);
    }
    if (key.length < 24) {
      console.error('[SECURITY] DESKTOP_API_KEY 长度不足24字符！');
      process.exit(1);
    }
  }
  if (!key || key === defaultKey) {
    console.warn('[SECURITY] 警告: 使用默认 DESKTOP_API_KEY，生产环境请务必更换！');
  }
  return key || defaultKey;
}

// 解析数字环境变量
function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

// 解析布尔环境变量
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

// 解析数组环境变量（逗号分隔）
function parseArray(value: string | undefined, defaultValue: string[]): string[] {
  if (!value) return defaultValue;
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

// 导出配置
export const config = {
  // 基础配置
  env: process.env.NODE_ENV || 'development',
  isProduction,
  isTest,
  port: parseNumber(process.env.PORT, 49200),
  
  // 数据库配置
  databaseUrl: process.env.DATABASE_URL || (() => { throw new Error('DATABASE_URL environment variable is required'); })(),
  
  // JWT配置
  jwtSecret: validateJwtSecret(process.env.JWT_SECRET),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // 桌面端共享 API Key（用于 HttpClient 调用服务端鉴权端点的回退路径）
  desktopApiKey: validateDesktopApiKey(process.env.DESKTOP_API_KEY),

  // 演示模式：公网 Demo 部署时开启。
  // 开启后：① 外链音频（爬取的第三方源）的流式播放/预下载/缓存全部 403 关闭，
  // 仅保留浏览、搜索、收藏、歌单等非音频功能；② 唯一音频来源为本机自有版权
  // 曲库目录（LOCAL_MUSIC_DIR，经 /api/library/* 提供）。合规说明见 README。
  demoMode: process.env.DEMO_MODE === 'true',

  // 自有版权曲库目录：存放本人拥有权利/已获授权的音频文件（默认项目根下 local-music）
  localMusicDir: process.env.LOCAL_MUSIC_DIR || path.join(PROJECT_ROOT, 'local-music'),

  // 永久音频曲库目录（2026-11-18 三层供给架构）：
  // 与一次性磁盘缓存（audio-cache，受 LRU 淘汰）不同，本目录存放"永久资产"——
  // 内置曲库与自托管源发布的音频文件，永不被淘汰，断网/换机可用。
  // 桌面版经 env 指向 resources/audio-library。
  audioLibraryDir: process.env.AUDIO_LIBRARY_DIR
    ? path.resolve(process.env.AUDIO_LIBRARY_DIR)
    : path.join(PROJECT_ROOT, 'data', 'audio-library'),

  // 音频来源解析（Source-Adapter，2026-11-18）：
  // - neteaseFallbackEnabled=false（默认）：爬虫路径关闭，未命中曲库/缓存的歌直接 404
  //   （与 YesPlayMusic 下架事件同类路径，仅可经环境变量显式开启用于教学演示）
  neteaseFallbackEnabled: parseBoolean(process.env.ENABLE_NETEASE_FALLBACK, false),

  // Jamendo API（CC 授权曲库，https://developer.jamendo.com）
  // client_id 未配置时 adapter 自动进入 stub 模式（搜索/导入返回明确提示）
  jamendo: {
    clientId: process.env.JAMENDO_CLIENT_ID || '',
    apiBase: 'https://api.jamendo.com/v3.0',
    maxImportCount: parseNumber(process.env.JAMENDO_MAX_IMPORT, 50),
  },
  
  // Redis配置（已迁移为内存缓存，此配置保留兼容性）
  redisUrl: process.env.REDIS_URL || '',
  
  // CORS配置
  allowedOrigins: parseArray(process.env.ALLOWED_ORIGINS, [
    'http://localhost:49201',
    'http://localhost:49202',
    'http://localhost:49203',
    'http://localhost:49200',
    // 同源但以 IP 形式访问（桌面应用窗口加载 127.0.0.1 时）
    'http://127.0.0.1:49200',
    'http://127.0.0.1:49201',
    'http://127.0.0.1:49202',
    'http://127.0.0.1:49203',
    // Tauri 桌面应用来源
    'tauri://localhost',
    'https://tauri.localhost',
    'http://tauri.localhost',
    'https://localhost',
    // Electron 桌面应用来源（file:// 来源配合 credentials 有风险，需要时通过 ALLOWED_ORIGINS 显式开启）
    'app://musicbox',
  ]),
  
  // 速率限制配置
  rateLimit: {
    windowMs: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, 60000),
    max: parseNumber(process.env.RATE_LIMIT_MAX, 100),
  },
  authRateLimit: {
    windowMs: parseNumber(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 900000),
    max: parseNumber(process.env.AUTH_RATE_LIMIT_MAX, 20),
  },
  searchRateLimit: {
    windowMs: parseNumber(process.env.SEARCH_RATE_LIMIT_WINDOW_MS, 60000),
    max: parseNumber(process.env.SEARCH_RATE_LIMIT_MAX, 60),
  },
  
  // 缓存配置
  cache: {
    defaultTtl: parseNumber(process.env.CACHE_DEFAULT_TTL, 300),
    searchTtl: parseNumber(process.env.CACHE_SEARCH_TTL, 60),
    hotSearchTtl: parseNumber(process.env.CACHE_HOT_SEARCH_TTL, 300),
  },
  
  // 日志配置
  logLevel: process.env.LOG_LEVEL || 'info',
  enableRequestLogging: parseBoolean(process.env.ENABLE_REQUEST_LOGGING, true),
  
  // 安全配置
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || '10kb',
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  
  // 搜索配置
  search: {
    maxLimit: parseNumber(process.env.SEARCH_MAX_LIMIT, 100),
    maxQueryLength: parseNumber(process.env.SEARCH_MAX_QUERY_LENGTH, 100),
    // 线上搜索（2026-11-18）：本地库 + Jamendo CC 曲库整合
    // - enabled=false 时 /api/search 完全退化为纯本地搜索（离线场景/合规要求）
    // - timeoutMs：线上搜索硬超时，超时后 fail-open 只返回本地结果，绝不阻塞本地响应
    // - maxResults：单次线上搜索返回上限（Jamendo limit 参数）
    online: {
      enabled: parseBoolean(process.env.SEARCH_ONLINE_ENABLED, true),
      timeoutMs: parseNumber(process.env.SEARCH_ONLINE_TIMEOUT_MS, 3000),
      maxResults: parseNumber(process.env.SEARCH_ONLINE_MAX_RESULTS, 10),
      cacheTtl: parseNumber(process.env.SEARCH_ONLINE_CACHE_TTL, 300),
    },
  },
};

// 启动时打印配置摘要（隐藏敏感信息）
if (!isTest) {
  console.log('[CONFIG] 环境:', config.env);
  console.log('[CONFIG] 端口:', config.port);
  console.log('[CONFIG] 数据库:', config.databaseUrl.replace(/\/\/.*@/, '//***@'));
  console.log('[CONFIG] Redis:', config.redisUrl.replace(/\/\/.*@/, '//***@'));
  console.log('[CONFIG] CORS允许来源:', config.allowedOrigins);
}

export default config;
