/**
 * URL 管理服务配置
 *
 * 2026-08-08 新增：URL管理模块的独立配置
 * 2026-08-09 增强：重试策略、预检测、自适应TTL、并发控制
 */

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

export const urlManagerConfig = {
  /** URL缓存TTL (默认30分钟) */
  cacheTtl: parseNumber(process.env.URL_CACHE_TTL, 30 * 60 * 1000),

  /** 并发检查数（同时进行的URL检查/刷新操作数） */
  concurrency: parseNumber(process.env.URL_CHECK_CONCURRENCY, 5),

  /** Python 进程最大并发数（全局信号量） */
  maxPythonConcurrent: parseNumber(process.env.MAX_PYTHON_CONCURRENT, 3),

  /** Python 进程等待槽位的超时时间（毫秒），超时则放弃 */
  pythonAcquireTimeout: parseNumber(process.env.PYTHON_ACQUIRE_TIMEOUT, 60000),

  /** 单首歌曲刷新超时 (毫秒) */
  refreshTimeout: parseNumber(process.env.URL_REFRESH_TIMEOUT, 30000),

  /** 批量检查单批大小（从50增到100，加速全量检查） */
  batchSize: parseNumber(process.env.URL_BATCH_SIZE, 100),

  /** 批量检查并行分片大小（从10增到20） */
  chunkSize: parseNumber(process.env.URL_CHUNK_SIZE, 20),

  /** 重试策略 */
  retry: {
    /** 最大重试次数（不含首次调用） */
    maxRetries: parseNumber(process.env.URL_REFRESH_MAX_RETRIES, 2),
    /** 基础退避延迟（毫秒） */
    baseDelay: parseNumber(process.env.URL_RETRY_BASE_DELAY, 2000),
    /** 最大退避延迟（毫秒） */
    maxDelay: parseNumber(process.env.URL_RETRY_MAX_DELAY, 15000),
    /** 抖动范围（毫秒） */
    jitterRange: parseNumber(process.env.URL_RETRY_JITTER, 1000),
    /** 单次刷新重试链的总耗时上限（毫秒），超时即放弃，避免失败场景拖 30s+ */
    totalTimeout: parseNumber(process.env.URL_RETRY_TOTAL_TIMEOUT, 15000),
  },

  /** 预检测窗口（毫秒）：URL 过期前多久开始预刷新 */
  preDetectionWindowMs: parseNumber(process.env.URL_PREDETECTION_WINDOW, 10 * 60 * 1000),

  /** 同一首歌的刷新防抖窗口（毫秒）：在此时间内不会重复触发刷新 */
  refreshDebounceMs: parseNumber(process.env.URL_REFRESH_DEBOUNCE, 60000),

  /** 自适应 TTL 基于历史记录的样本数 */
  adaptiveTtlSampleSize: parseNumber(process.env.URL_ADAPTIVE_TTL_SAMPLES, 100),

  /** 自适应 TTL 保守系数（取历史有效期的百分比） */
  adaptiveTtlFactor: parseFloat(process.env.URL_ADAPTIVE_TTL_FACTOR || '0.7'),

  /** 已失效歌曲自动重试间隔（毫秒）：4小时后重新尝试失效歌曲（从12小时缩短） */
  failedSongRetryInterval: parseNumber(process.env.URL_FAILED_RETRY_INTERVAL, 4 * 60 * 60 * 1000),

  /** 预警阈值 */
  alert: {
    /** URL有效率阈值 (低于此值触发预警) */
    validityRateThreshold: parseFloat(process.env.ALERT_VALIDITY_THRESHOLD || '0.8'),
    /** 单曲连续刷新失败次数阈值 */
    maxRefreshFailures: parseNumber(process.env.ALERT_FAILURE_THRESHOLD, 3),
    /** 数据源成功率阈值 */
    sourceSuccessRateThreshold: parseFloat(process.env.ALERT_SOURCE_RATE || '0.5'),
    /** Critical 级别有效率阈值 */
    criticalValidityRate: parseFloat(process.env.ALERT_CRITICAL_VALIDITY || '0.5'),
    /** Critical 级别数据源成功率阈值 */
    criticalSourceRate: parseFloat(process.env.ALERT_CRITICAL_SOURCE_RATE || '0.3'),
  },

  /** 定时任务间隔（毫秒） */
  schedule: {
    /** 热门歌曲检查 (每小时) */
    hotCheckInterval: 60 * 60 * 1000,
    /** 全量检查 (每6小时) */
    fullCheckInterval: 6 * 60 * 60 * 1000,
    /** 预检测（URL即将过期）检查 (每15分钟) */
    preDetectionInterval: 15 * 60 * 1000,
    /** 缓存清理 (每天) */
    cacheCleanupInterval: 24 * 60 * 60 * 1000,
    /** 预警检查 (每5分钟) */
    alertCheckInterval: 5 * 60 * 1000,
    /** 失效重试 (每4小时，从12小时缩短) */
    failedRetryInterval: 4 * 60 * 60 * 1000,
  },

  /** 数据源启用开关 */
  sources: {
    netease: parseBoolean(process.env.NETEASE_API_ENABLED, true),
    qq: parseBoolean(process.env.QQ_API_ENABLED, false),
    kugou: parseBoolean(process.env.KUGOU_API_ENABLED, false),
  },

  /** 预加载阈值：当剩余有效URL比例低于此值时预加载 */
  preloadThreshold: parseNumber(process.env.URL_PRELOAD_THRESHOLD, 0.3),
};

export type UrlManagerConfig = typeof urlManagerConfig;
