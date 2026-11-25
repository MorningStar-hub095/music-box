import { refreshHot100 } from './modules/playlists/hot100.service';
import { crawlSongs } from './modules/crawler/crawler.service';
import { checkAudioUrlPlayable } from './modules/songs/songs.service';
import { RecommendationService } from './modules/recommendation/recommendation.service';
import { EmotionDnaService } from './modules/emotion-dna/emotion-dna.service';
import { GenomeService } from './modules/genome/genome.service';
import { SocialDnaService } from './modules/social-dna/social-dna.service';
import prisma from './lib/prisma';
import { execFile } from 'child_process';

let lastRunTime: Date | null = null;
const RUN_HOUR = 3; // 凌晨3点
const CHECK_INTERVAL = 60 * 60 * 1000; // 每小时检查一次

// 每日爬取关键词列表，每个关键词爬取 20 首，总配额 ~200 首/天
const CRAWL_KEYWORDS = ['华语热门', '欧美热门', '日韩热门', '流行', '摇滚', '民谣', '电子', '古典', '励志', '浪漫'];
const CRAWL_KEYWORD_TARGET = 20;

/**
 * 爬虫依赖预检（2026-11-04 熔断修复）
 * 每天首次执行时检查 python + requests 是否可用；不可用则当天跳过所有爬取步骤，
 * 避免出现"20+ 关键词连续 spawn 失败刷屏"的浪费与日志污染。结果按天缓存。
 */
let crawlerDepCache: { date: string; ok: boolean } | null = null;

function checkCrawlerDependency(): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  if (crawlerDepCache && crawlerDepCache.date === today) {
    return Promise.resolve(crawlerDepCache.ok);
  }
  return new Promise((resolve) => {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    // windowsHide: true（CREATE_NO_WINDOW）必须显式设置：桌面版中后端以 GUI 子系统进程
    // （MusicBox.exe + ELECTRON_RUN_AS_NODE）运行，本身没有控制台；不带该标志 spawn 控制台
    // 程序（python.exe）时 Windows 会为子进程新建「可见」控制台窗口——即用户报告的
    // 「启动约 1 分钟后弹出一个 cmd 黑窗口」。与 python-runner.ts 的既有修复保持一致。
    const child = execFile(py, ['-c', 'import requests'], { timeout: 10_000, windowsHide: true }, (err) => {
      const ok = !err;
      crawlerDepCache = { date: today, ok };
      if (!ok) {
        console.warn('[SCHEDULER] 爬虫依赖预检失败（python/requests 不可用），今日跳过全部爬取类任务。' +
          '修复方式：pip install requests，或清理爬虫关键词。预检明日自动重试。');
      }
      resolve(ok);
    });
    child.on('error', () => {
      // execFile 回调已覆盖 error 场景，此处兜底防止未处理异常
    });
  });
}

export function startScheduler() {
  console.log('[SCHEDULER] 定时任务调度器已启动，每日 ' + RUN_HOUR + ':00 执行');

  // 修复: 原代码启动时立即执行 checkAndRun()，会导致服务刚启动就触发大量 Python 爬虫调用
  // (refreshHot100 + crawlSongs × 10 关键词 + classifySong × N 首 + category 刷新)
  // 现改为延迟 60 秒执行，让服务器先完成初始化和健康检查，避免启动瞬间资源占用峰值
  const STARTUP_DELAY = 60 * 1000; // 60 秒延迟
  setTimeout(() => {
    checkAndRun();
  }, STARTUP_DELAY).unref();

  // 每小时检查（.unref() 避免阻止进程优雅退出）
  setInterval(checkAndRun, CHECK_INTERVAL).unref();
}

async function checkAndRun() {
  const now = new Date();

  // 如果今天还没执行过，且当前时间 >= 3:00
  if (shouldRun(now)) {
    console.log('[SCHEDULER] 开始执行每日任务...');
    try {
      // 爬取类任务（步骤1/2/4）依赖 python 爬虫，先做依赖预检（按天缓存）
      const crawlerOk = await checkCrawlerDependency();

      // 1. 刷新热门100首
      if (crawlerOk) {
        console.log('[SCHEDULER] 刷新热门100首歌单...');
        const hot100Result = await refreshHot100();
        console.log(`[SCHEDULER] 热门100首更新完成: ${hot100Result.count} 首`);
      }

      // 2. 爬取新歌曲（多关键词循环，单关键词失败不阻塞其他关键词；
      //    连续 3 个关键词全部失败且零产出时熔断，视为爬虫环境故障）
      let totalNew = 0;
      let totalUpdated = 0;
      if (crawlerOk) {
        console.log('[SCHEDULER] 爬取新歌曲...');
        let consecutiveFailures = 0;
        for (const keyword of CRAWL_KEYWORDS) {
          if (consecutiveFailures >= 3) {
            console.error(`[SCHEDULER] 连续 ${consecutiveFailures} 个关键词爬取失败，熔断剩余关键词（疑似爬虫环境故障）`);
            break;
          }
          try {
            const result = await crawlSongs({
              platform: 'netease',
              keyword,
              targetCount: CRAWL_KEYWORD_TARGET,
              batchSize: 10,
              crawlSource: 'scheduled',
            });
            totalNew += result.newCount;
            totalUpdated += result.updatedCount;
            consecutiveFailures = 0;
            console.log(`[SCHEDULER] 关键词「${keyword}」爬取完成: 新增${result.newCount}首，更新${result.updatedCount}首`);
          } catch (error) {
            consecutiveFailures++;
            // 单关键词失败不中断整个循环，记 CrawlLog 后继续下一个
            console.error(`[SCHEDULER] 关键词「${keyword}」爬取失败(${consecutiveFailures}):`, error instanceof Error ? error.message : error);
          }
        }
        console.log(`[SCHEDULER] 爬取全部完成: 共新增${totalNew}首，更新${totalUpdated}首`);
      }

      // 爬取入库后清除推荐候选池缓存，确保新歌曲出现在推荐候选池
      try {
        const recService = new RecommendationService();
        await recService.invalidatePoolCache();
        console.log('[SCHEDULER] 推荐候选池缓存已清除');
      } catch (error) {
        console.error('[SCHEDULER] 清除推荐缓存失败:', error instanceof Error ? error.message : error);
      }

      // 3. 批量检查 URL 健康状态
      console.log('[SCHEDULER] 检查音频URL健康状态...');
      const urlCheckResult = await checkUrlHealthBatch();
      console.log(`[SCHEDULER] URL检查完成: 可播放${urlCheckResult.playable}首，失效${urlCheckResult.unplayable}首`);

      // 4. 刷新所有分类歌单（依赖爬虫获取新歌，依赖不可用时跳过）
      if (crawlerOk) {
        console.log('[SCHEDULER] 刷新分类歌单...');
        const { refreshAllCategories } = await import('./modules/playlists/category.service');
        await refreshAllCategories();
        console.log('[SCHEDULER] 分类歌单刷新完成');
      }

      // 5. 每日 03:00 为活跃用户预生成个性化推荐
      console.log('[SCHEDULER] 预生成活跃用户每日推荐...');
      const activeUsers = await pregenerateDailyRecommendations();
      console.log('[SCHEDULER] 每日推荐预生成完成');

      // 6. 每日重算活跃用户情绪 DNA（在推荐预生成之后，复用同一份 active users 列表）
      console.log('[SCHEDULER] 重算活跃用户情绪 DNA...');
      const dnaSvc = new EmotionDnaService();
      for (const u of activeUsers) {
        try {
          await dnaSvc.recomputeAndPersist(u.id);
        } catch (error) {
          // 单用户失败不阻塞其他用户，记录日志后继续
          console.error(`[SCHEDULER] 用户 ${u.id} 情绪 DNA 重算失败:`, error);
        }
      }
      console.log('[SCHEDULER] 情绪 DNA 重算完成');

      // 修复 (2026-08-09): 新增步骤 - 每日重算活跃用户社交DNA
      // 原代码不重算社交DNA，导致用户即使听了新歌，社交DNA也永不刷新
      console.log('[SCHEDULER] 重算活跃用户社交 DNA...');
      const socialDnaSvc = new SocialDnaService();
      for (const u of activeUsers) {
        try {
          await socialDnaSvc.computeAndStore(u.id);
        } catch (error) {
          console.error(`[SCHEDULER] 用户 ${u.id} 社交 DNA 重算失败:`, error);
        }
      }
      console.log('[SCHEDULER] 社交 DNA 重算完成');

      // 7. 每日重算基因图谱 PCA（爬取入库后调用，保证新歌曲有坐标）
      console.log('[SCHEDULER] 重算基因图谱 PCA...');
      try {
        const genomeSvc = new GenomeService();
        const result = await genomeSvc.computeAndPersistCoords();
        console.log(`[SCHEDULER] 基因图谱 PCA 完成: ${result.computed} 首`);
      } catch (error) {
        console.error('[SCHEDULER] 基因图谱 PCA 重算失败:', error);
      }

      lastRunTime = new Date();
      console.log('[SCHEDULER] 每日任务执行完成');
    } catch (error) {
      console.error('[SCHEDULER] 每日任务执行失败:', error);
      lastRunTime = new Date(); // 记录失败时间，避免反复重试
    }
  }
}

function shouldRun(now: Date): boolean {
  if (lastRunTime) {
    // 如果上次执行时间在今天，则不再执行
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (lastRunTime >= today) return false;
  }

  // 当前时间 >= 3:00 才执行
  return now.getHours() >= RUN_HOUR;
}

export function getLastRunTime() { return lastRunTime; }
export function getNextRunTime(): Date {
  const next = new Date();
  next.setHours(RUN_HOUR, 0, 0, 0);
  if (next <= new Date() || (lastRunTime && lastRunTime >= next)) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/**
 * 批量检查 URL 健康状态
 * 优先检查 hotScore 高的歌曲，每次最多检查 50 首
 * 使用原生分批并发控制（每批 10 个并行），不引入额外依赖
 */
export async function checkUrlHealthBatch(batchSize = 50): Promise<{ playable: number; unplayable: number; total: number }> {
  // 查找需要检查的歌曲：urlCheckedAt 超过 24 小时或从未检查过
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const songsToCheck = await prisma.song.findMany({
    where: {
      playable: true,
      archived: false,
      OR: [
        { urlCheckedAt: null },
        { urlCheckedAt: { lt: oneDayAgo } },
      ],
    },
    orderBy: { hotScore: 'desc' },
    take: batchSize,
    select: { id: true, audioUrl: true },
  });

  console.log(`[URL-HEALTH] 开始检查 ${songsToCheck.length} 首歌曲的URL健康状态`);

  let playableCount = 0;
  let unplayableCount = 0;

  // 分批并行检查（每批 10 个并行，避免过多 HTTP 请求）
  const CHUNK_SIZE = 10;
  for (let i = 0; i < songsToCheck.length; i += CHUNK_SIZE) {
    const chunk = songsToCheck.slice(i, i + CHUNK_SIZE);

    // 并行检查当前批次的 URL 可达性
    const results = await Promise.all(
      chunk.map(async (song) => {
        const isPlayable = await checkAudioUrlPlayable(song.audioUrl);
        return { id: song.id, isPlayable };
      })
    );

    // 批量更新数据库
    await Promise.all(
      results.map(r =>
        prisma.song.update({
          where: { id: r.id },
          data: {
            playable: r.isPlayable,
            urlCheckedAt: new Date(),
          },
        })
      )
    );

    // 统计结果
    results.forEach(r => {
      if (r.isPlayable) playableCount++;
      else unplayableCount++;
    });
  }

  return {
    playable: playableCount,
    unplayable: unplayableCount,
    total: songsToCheck.length,
  };
}

/**
 * 每日 03:00 为活跃用户预生成个性化每日推荐
 * 遍历 active 状态用户，调用 RecommendationService.generateForUser
 * 返回活跃用户列表，供后续步骤（如情绪 DNA 重算）复用，避免重复查询
 */
async function pregenerateDailyRecommendations(): Promise<{ id: number }[]> {
  const recService = new RecommendationService();
  const activeUsers = await prisma.user.findMany({
    where: { status: 'active' },
    select: { id: true },
  });
  for (const u of activeUsers) {
    try {
      await recService.generateForUser(u.id);
    } catch (error) {
      console.error(`[SCHEDULER] 用户 ${u.id} 推荐生成失败:`, error);
    }
  }
  return activeUsers;
}
