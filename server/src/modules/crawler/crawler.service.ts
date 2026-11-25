import prisma from '../../lib/prisma';
import { CrawlStatus } from '@prisma/client';
import { runPython } from '../../lib/python-runner';
import { MUSIC_CRAWLER_SCRIPT, AUTO_CLASSIFIER_SCRIPT } from '../../config';

/**
 * 调用 Python 爬虫脚本搜索歌曲
 * 命令格式：python d:/music_box/tools/music_crawler.py search "关键词" --limit N
 * 返回 JSON 数组，每项包含 id/platform/title/artist/album/albumCover/lyricContent/audioUrl/playable/coverColor
 */
async function callPythonCrawler(keyword: string, limit: number): Promise<any[]> {
  // 5 分钟超时（与 hot100 一致）；失败时抛错而非静默返回空数组，
  // 让上游 crawlSongs 感知失败并记入 CrawlLog。
  let stdout: string;
  try {
    const result = await runPython([
      MUSIC_CRAWLER_SCRIPT,
      'search',
      keyword,
      '--limit',
      String(limit),
    ], { timeout: 300000 });
    stdout = result.stdout;
  } catch (error: any) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    const msg = error?.message || String(error);
    throw new Error(`Python 爬虫调用失败 (keyword=${keyword}): ${msg}${stderr ? ` | stderr: ${stderr}` : ''}`);
  }

  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [];
}

const AUTO_CLASSIFIER_PATH = AUTO_CLASSIFIER_SCRIPT;
const CLASSIFIER_TIMEOUT = 10000; // 单首分类 10s 超时

interface ClassificationResult {
  genres: number[];
  moods: number[];
  scenes: number[];
  languages: number[];
  decades: number[];
}

/**
 * 调用 Python auto_classifier 为单首歌曲生成分类标签。
 * 失败时返回 null（不阻塞入库），由调用方决定是否跳过。
 */
async function classifySong(
  title: string,
  artist: string,
  album: string
): Promise<ClassificationResult | null> {
  try {
    const { stdout } = await runPython([
      AUTO_CLASSIFIER_PATH,
      '--title', title,
      '--artist', artist,
      '--album', album || '',
    ], { timeout: CLASSIFIER_TIMEOUT });
    const parsed = JSON.parse(stdout);
    return {
      genres: Array.isArray(parsed.genres) ? parsed.genres : [],
      moods: Array.isArray(parsed.moods) ? parsed.moods : [],
      scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
      languages: Array.isArray(parsed.languages) ? parsed.languages : [],
      decades: Array.isArray(parsed.decades) ? parsed.decades : [],
    };
  } catch (error) {
    console.warn(`[Crawler] auto_classifier 调用失败 (${title}):`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * 将分类结果写入歌曲关联表（参考 songs.service.ts updateSong 的关联写法）。
 */
async function applyClassification(songId: string, classification: ClassificationResult): Promise<void> {
  await prisma.song.update({
    where: { id: songId },
    data: {
      genres: { deleteMany: {}, create: classification.genres.map((genreId) => ({ genreId })) },
      moods: { deleteMany: {}, create: classification.moods.map((moodId) => ({ moodId })) },
      scenes: { deleteMany: {}, create: classification.scenes.map((sceneId) => ({ sceneId })) },
      languages: { deleteMany: {}, create: classification.languages.map((languageId) => ({ languageId })) },
      decades: { deleteMany: {}, create: classification.decades.map((decadeId) => ({ decadeId })) },
    },
  });
}

export interface CrawlConfig {
  platform: string;
  keyword?: string;
  targetCount?: number;
  batchSize?: number;
  maxRetries?: number;
  crawlSource?: string;
  taskType?: string;
}

export interface CrawlResult {
  crawlLogId: bigint;
  status: CrawlStatus;
  totalCount: number;
  successCount: number;
  failedCount: number;
  newCount: number;
  updatedCount: number;
  songs: Array<{
    id: string;
    title: string;
    artist: string;
    isNew: boolean;
    albumCover?: string;
    platform?: string;
    coverColor?: string;
  }>;
}

export interface CrawlStats {
  totalCrawls: number;
  successfulCrawls: number;
  failedCrawls: number;
  totalSongsCrawled: number;
  averageSuccessRate: number;
  recentCrawls: Array<{
    id: bigint;
    platform: string;
    status: CrawlStatus;
    totalCount: number;
    successCount: number;
    startedAt: Date;
    completedAt: Date | null;
  }>;
}

/**
 * 创建爬虫任务日志（如果已存在相同任务则复用）
 */
export async function createCrawlLog(config: CrawlConfig) {
  try {
    return await prisma.crawlLog.create({
      data: {
        taskType: config.taskType || 'batch_crawl',
        platform: config.platform,
        status: 'running',
        crawlSource: config.crawlSource,
        keyword: config.keyword,
        targetCount: config.targetCount,
        batchSize: config.batchSize || 10,
      },
    });
  } catch (err: any) {
    // 唯一约束冲突：查找已存在的记录并复用
    if (err?.code === 'P2002') {
      const existing = await prisma.crawlLog.findFirst({
        where: {
          taskType: config.taskType || 'batch_crawl',
          keyword: config.keyword,
          status: 'running',
        },
        orderBy: { startedAt: 'desc' },
      });
      if (existing) return existing;
      // 如果没有running状态的，创建一个带时间戳的新记录
      return await prisma.crawlLog.create({
        data: {
          taskType: (config.taskType || 'batch_crawl') + '_' + Date.now(),
          platform: config.platform,
          status: 'running',
          crawlSource: config.crawlSource,
          keyword: config.keyword,
          targetCount: config.targetCount,
          batchSize: config.batchSize || 10,
        },
      });
    }
    throw err;
  }
}

/**
 * 更新爬虫任务状态
 */
export async function updateCrawlLog(
  crawlLogId: bigint,
  data: {
    status?: CrawlStatus;
    totalCount?: number;
    successCount?: number;
    failedCount?: number;
    newCount?: number;
    updatedCount?: number;
    errorMessage?: string;
    completedAt?: Date;
    retryCount?: number;
  }
) {
  return prisma.crawlLog.update({
    where: { id: crawlLogId },
    data,
  });
}

/**
 * 完成爬虫任务
 */
export async function completeCrawlLog(
  crawlLogId: bigint,
  stats: {
    totalCount: number;
    successCount: number;
    failedCount: number;
    newCount: number;
    updatedCount: number;
  }
) {
  return prisma.crawlLog.update({
    where: { id: crawlLogId },
    data: {
      status: stats.failedCount === 0 ? 'success' : 'partial',
      ...stats,
      completedAt: new Date(),
    },
  });
}

/**
 * 失败爬虫任务
 */
export async function failCrawlLog(crawlLogId: bigint, errorMessage: string) {
  // 追加而非覆盖原有 errorMessage；递增 retryCount 以便上层重试策略参考
  const existing = await prisma.crawlLog.findUnique({
    where: { id: crawlLogId },
    select: { errorMessage: true },
  });
  const combinedError = existing?.errorMessage
    ? `${existing.errorMessage}\n---\n${errorMessage}`
    : errorMessage;
  return prisma.crawlLog.update({
    where: { id: crawlLogId },
    data: {
      status: 'failed',
      errorMessage: combinedError,
      retryCount: { increment: 1 },
      completedAt: new Date(),
    },
  });
}

/**
 * 将爬取到的歌曲写入数据库（共享逻辑）
 * 包含去重、分批处理、进度更新和完成日志
 */
async function persistCrawledSongs(
  crawlLogId: bigint,
  crawledSongs: any[],
  platform: string
): Promise<{
  successCount: number;
  failedCount: number;
  newCount: number;
  updatedCount: number;
  processedSongs: CrawlResult['songs'];
}> {
  let successCount = 0;
  let failedCount = 0;
  let newCount = 0;
  let updatedCount = 0;
  const processedSongs: CrawlResult['songs'] = [];

  // 分批处理
  const batchSize = 10;
  for (let i = 0; i < crawledSongs.length; i += batchSize) {
    const batch = crawledSongs.slice(i, i + batchSize);

    for (const songData of batch) {
      try {
        // 去重：通过 title + artist 判断是否已存在
        const existingSong = await prisma.song.findFirst({
          where: {
            title: songData.title,
            artist: songData.artist,
          },
          include: {
            genres: { select: { genreId: true } },
            moods: { select: { moodId: true } },
            scenes: { select: { sceneId: true } },
            languages: { select: { languageId: true } },
            decades: { select: { decadeId: true } },
          },
        });

        if (existingSong) {
          // 更新现有歌曲
          await prisma.song.update({
            where: { id: existingSong.id },
            data: {
              audioUrl: songData.audioUrl,
              album: songData.album,
              albumCover: songData.albumCover,
              lyricContent: songData.lyricContent,
              coverColor: songData.coverColor,
              duration: songData.duration || null,
              playable: songData.playable ?? true,
              updatedAt: new Date(),
            },
          });
          // 已有分类则跳过；否则补打分类（分类失败不阻塞入库）
          const hasClassification =
            existingSong.genres.length > 0 ||
            existingSong.moods.length > 0 ||
            existingSong.scenes.length > 0 ||
            existingSong.languages.length > 0 ||
            existingSong.decades.length > 0;
          if (!hasClassification) {
            const classification = await classifySong(songData.title, songData.artist, songData.album || '');
            if (classification) {
              await applyClassification(existingSong.id, classification).catch((e) => {
                console.warn(`[Crawler] 应用分类失败 (${songData.title}):`, e instanceof Error ? e.message : e);
              });
            }
          }
          updatedCount++;
          processedSongs.push({
            id: existingSong.id,
            title: songData.title,
            artist: songData.artist,
            isNew: false,
            albumCover: songData.albumCover,
            platform: songData.platform || platform,
            coverColor: songData.coverColor,
          });
        } else {
          // 创建新歌曲
          const newSong = await prisma.song.create({
            data: {
              id: songData.id || `${platform}:${Date.now()}_${i}`,
              title: songData.title,
              artist: songData.artist,
              album: songData.album,
              albumCover: songData.albumCover,
              audioUrl: songData.audioUrl,
              lyricContent: songData.lyricContent,
              coverColor: songData.coverColor,
              duration: songData.duration || null,
              platform: songData.platform || platform,
              playable: songData.playable ?? true,
              dataSource: 'crawler',
              crawlTaskId: crawlLogId,
              importedAt: new Date(),
            },
          });
          // 新歌曲总是打分类（分类失败不阻塞入库）
          const classification = await classifySong(songData.title, songData.artist, songData.album || '');
          if (classification) {
            await applyClassification(newSong.id, classification).catch((e) => {
              console.warn(`[Crawler] 应用分类失败 (${songData.title}):`, e instanceof Error ? e.message : e);
            });
          }
          newCount++;
          processedSongs.push({
            id: newSong.id,
            title: songData.title,
            artist: songData.artist,
            isNew: true,
            albumCover: songData.albumCover,
            platform: songData.platform || platform,
            coverColor: songData.coverColor,
          });
        }

        successCount++;
      } catch (error) {
        failedCount++;
        console.error(`处理歌曲失败: ${songData.title}`, error);
      }
    }

    // 更新进度
    await updateCrawlLog(crawlLogId, {
      totalCount: i + batch.length,
      successCount,
      failedCount,
      newCount,
      updatedCount,
    });
  }

  // 完成任务
  await completeCrawlLog(crawlLogId, {
    totalCount: crawledSongs.length,
    successCount,
    failedCount,
    newCount,
    updatedCount,
  });

  return { successCount, failedCount, newCount, updatedCount, processedSongs };
}

/**
 * 爬取歌曲：通过调用 Python 爬虫脚本获取真实数据并写入数据库
 */
export async function crawlSongs(config: CrawlConfig): Promise<CrawlResult> {
  const crawlLog = await createCrawlLog(config);

  try {
    const limit = config.targetCount || 10;
    const keyword = config.keyword || '流行';

    // 调用 Python 爬虫脚本，失败时抛错（由下方 catch 记入 CrawlLog）
    const crawledSongs = await callPythonCrawler(keyword, limit);

    // 复用共享的写入逻辑
    const result = await persistCrawledSongs(crawlLog.id, crawledSongs, config.platform);

    return {
      crawlLogId: crawlLog.id,
      status: 'success' as CrawlStatus,
      totalCount: crawledSongs.length,
      successCount: result.successCount,
      failedCount: result.failedCount,
      newCount: result.newCount,
      updatedCount: result.updatedCount,
      songs: result.processedSongs,
    };
  } catch (error) {
    await failCrawlLog(crawlLog.id, error instanceof Error ? error.message : '未知错误');
    throw error;
  }
}

/**
 * 爬取热门100首：通过调用 Python 爬虫 hot100 命令
 */
export async function crawlHot100Songs(config: CrawlConfig): Promise<CrawlResult> {
  const crawlLog = await createCrawlLog({ ...config, taskType: 'hot100_crawl' });

  try {
    const limit = config.targetCount || 100;

    // 调用 Python 爬虫 hot100 命令
    let crawledSongs: any[] = [];
    try {
      const { stdout } = await runPython([
        MUSIC_CRAWLER_SCRIPT,
        'hot100',
        '--limit', String(limit),
      ], { timeout: 300000 });
      const parsed = JSON.parse(stdout);
      crawledSongs = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('[Crawler] hot100 Python调用失败:', error);
    }

    // 复用共享的写入逻辑
    const result = await persistCrawledSongs(crawlLog.id, crawledSongs, config.platform);

    return {
      crawlLogId: crawlLog.id,
      status: 'success' as CrawlStatus,
      totalCount: crawledSongs.length,
      successCount: result.successCount,
      failedCount: result.failedCount,
      newCount: result.newCount,
      updatedCount: result.updatedCount,
      songs: result.processedSongs,
    };
  } catch (error) {
    await failCrawlLog(crawlLog.id, error instanceof Error ? error.message : '未知错误');
    throw error;
  }
}

/**
 * 获取爬虫统计信息
 */
export async function getCrawlStats(): Promise<CrawlStats> {
  const [totalCrawls, successfulCrawls, failedCrawls, recentCrawls] = await Promise.all([
    prisma.crawlLog.count(),
    prisma.crawlLog.count({ where: { status: 'success' } }),
    prisma.crawlLog.count({ where: { status: 'failed' } }),
    prisma.crawlLog.findMany({
      take: 10,
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        platform: true,
        status: true,
        totalCount: true,
        successCount: true,
        startedAt: true,
        completedAt: true,
      },
    }),
  ]);
  
  const totalSongsCrawled = await prisma.crawlLog.aggregate({
    _sum: { successCount: true },
  });
  
  const averageSuccessRate = totalCrawls > 0 
    ? (successfulCrawls / totalCrawls) * 100 
    : 0;
  
  return {
    totalCrawls,
    successfulCrawls,
    failedCrawls,
    totalSongsCrawled: totalSongsCrawled._sum.successCount || 0,
    averageSuccessRate,
    recentCrawls: recentCrawls.map(c => ({
      ...c,
      platform: c.platform || 'unknown',
    })),
  };
}

/**
 * 获取爬虫任务列表
 */
export async function getCrawlLogs(params: {
  page?: number;
  pageSize?: number;
  status?: CrawlStatus;
  platform?: string;
}) {
  const { page = 1, pageSize = 20, status, platform } = params;
  
  const where: any = {};
  if (status) where.status = status;
  if (platform) where.platform = platform;
  
  const [total, logs] = await Promise.all([
    prisma.crawlLog.count({ where }),
    prisma.crawlLog.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { startedAt: 'desc' },
    }),
  ]);
  
  return {
    total,
    page,
    pageSize,
    logs,
  };
}

/**
 * 获取推荐的爬取策略
 */
export async function getRecommendedStrategy() {
  // 获取当前歌曲统计
  const [totalSongs, archivedSongs, recentSongs] = await Promise.all([
    prisma.song.count({ where: { archived: false } }),
    prisma.song.count({ where: { archived: true } }),
    prisma.song.count({
      where: {
        archived: false,
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),
  ]);
  
  // 获取最近的爬虫任务
  const lastCrawl = await prisma.crawlLog.findFirst({
    where: { status: 'success' },
    orderBy: { completedAt: 'desc' },
  });
  
  // 计算推荐策略
  const recommendations = {
    shouldCrawl: false,
    targetCount: 50,
    batchSize: 10,
    platforms: ['netease'],
    reasons: [] as string[],
  };
  
  // 如果歌曲数量少于100，建议爬取更多
  if (totalSongs < 100) {
    recommendations.shouldCrawl = true;
    recommendations.targetCount = 100 - totalSongs;
    recommendations.reasons.push(`当前歌曲数量(${totalSongs})较少，建议补充`);
  }
  
  // 如果最近7天没有新歌曲，建议爬取
  if (recentSongs < 10) {
    recommendations.shouldCrawl = true;
    recommendations.reasons.push('最近7天新增歌曲较少，建议更新内容');
  }
  
  // 如果最近没有爬取任务，建议执行
  if (!lastCrawl || 
      (lastCrawl.completedAt && 
       Date.now() - lastCrawl.completedAt.getTime() > 7 * 24 * 60 * 60 * 1000)) {
    recommendations.shouldCrawl = true;
    recommendations.reasons.push('超过7天未执行爬取任务');
  }
  
  return {
    currentStats: {
      totalSongs,
      archivedSongs,
      recentSongs,
    },
    lastCrawl: lastCrawl ? {
      id: lastCrawl.id,
      platform: lastCrawl.platform,
      status: lastCrawl.status,
      completedAt: lastCrawl.completedAt,
    } : null,
    recommendations,
  };
}

/**
 * 执行定时爬取任务
 */
export async function executeScheduledCrawl() {
  const strategy = await getRecommendedStrategy();
  
  if (!strategy.recommendations.shouldCrawl) {
    return {
      executed: false,
      reason: '当前不需要爬取',
      strategy,
    };
  }
  
  // 执行爬取
  const result = await crawlSongs({
    platform: strategy.recommendations.platforms[0],
    targetCount: strategy.recommendations.targetCount,
    batchSize: strategy.recommendations.batchSize,
    crawlSource: 'scheduled',
  });
  
  return {
    executed: true,
    result,
    strategy,
  };
}
