import React, { useState, useEffect } from 'react';
import { crawlerApi, contentApi } from '../services/api';

interface CrawlStats {
  totalCrawls: number;
  successfulCrawls: number;
  failedCrawls: number;
  totalSongsCrawled: number;
  averageSuccessRate: number;
  recentCrawls: Array<{
    id: number;
    platform: string;
    status: string;
    totalCount: number;
    successCount: number;
    startedAt: string;
    completedAt: string | null;
  }>;
}

interface ContentStats {
  totalSongs: number;
  activeSongs: number;
  archivedSongs: number;
  playableSongs: number;
  recentSongs: number;
  songsByPlatform: Array<{
    platform: string;
    count: number;
  }>;
  songsByDataSource: Array<{
    dataSource: string;
    count: number;
  }>;
  topPlayedSongs: Array<{
    id: string;
    title: string;
    artist: string;
    playCount: number;
  }>;
  recentlyAdded: Array<{
    id: string;
    title: string;
    artist: string;
    createdAt: string;
  }>;
}

interface CrawlStrategy {
  currentStats: {
    totalSongs: number;
    archivedSongs: number;
    recentSongs: number;
  };
  lastCrawl: {
    id: number;
    platform: string;
    status: string;
    completedAt: string | null;
  } | null;
  recommendations: {
    shouldCrawl: boolean;
    targetCount: number;
    batchSize: number;
    platforms: string[];
    reasons: string[];
  };
}

const CrawlerPage: React.FC = () => {
  const [crawlStats, setCrawlStats] = useState<CrawlStats | null>(null);
  const [contentStats, setContentStats] = useState<ContentStats | null>(null);
  const [strategy, setStrategy] = useState<CrawlStrategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [crawling, setCrawling] = useState(false);
  const [crawlResult, setCrawlResult] = useState<any>(null);
  const [crawlError, setCrawlError] = useState<string | null>(null);

  // 手动爬取相关状态
  const [crawlTaskType, setCrawlTaskType] = useState<'search' | 'hot100'>('search');
  const [crawlKeyword, setCrawlKeyword] = useState('');
  const [crawlPlatform, setCrawlPlatform] = useState('netease');
  const [crawlCount, setCrawlCount] = useState(50);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [timer, setTimer] = useState<ReturnType<typeof setInterval> | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [crawlRes, contentRes, strategyRes] = await Promise.all([
        crawlerApi.getStats(),
        contentApi.getStats(),
        crawlerApi.getStrategy(),
      ]);
      setCrawlStats(crawlRes.data.data);
      setContentStats(contentRes.data.data);
      setStrategy(strategyRes.data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleStartCrawl = async () => {
    setCrawling(true);
    setCrawlResult(null);
    setCrawlError(null);
    setElapsedTime(0);

    // 启动计时器
    const startTime = Date.now();
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    setTimer(interval);

    try {
      const res = await crawlerApi.crawl({
        platform: crawlPlatform,
        keyword: crawlTaskType === 'search' ? crawlKeyword : undefined,
        targetCount: crawlCount,
        batchSize: 10,
        taskType: crawlTaskType,
      });
      setCrawlResult(res.data.data);
      fetchData(); // 刷新数据
    } catch (err) {
      setCrawlError(err instanceof Error ? err.message : '爬取失败');
    } finally {
      setCrawling(false);
      if (interval) clearInterval(interval);
      setTimer(null);
    }
  };

  // 组件卸载时清理计时器
  useEffect(() => {
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [timer]);

  const handleAutoCrawl = async () => {
    setCrawling(true);
    setCrawlResult(null);
    try {
      const res = await crawlerApi.executeScheduled();
      setCrawlResult(res.data.data);
      fetchData(); // 刷新数据
    } catch (err) {
      setError(err instanceof Error ? err.message : '自动爬取失败');
    } finally {
      setCrawling(false);
    }
  };

  const handleUpdateHotScores = async () => {
    try {
      await contentApi.updateHotScores();
      fetchData(); // 刷新数据
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新热度失败');
    }
  };

  if (loading) {
    return <div className="page-loading">加载中...</div>;
  }

  if (error) {
    return (
      <div className="crawler-page">
        <h2 className="page-title">爬虫与内容管理</h2>
        <div className="error-state">
          <div className="error-icon">⚠️</div>
          <div className="error-message">{error}</div>
          <button className="retry-btn" onClick={fetchData}>重新加载</button>
        </div>
      </div>
    );
  }

  return (
    <div className="crawler-page">
      <h2 className="page-title">爬虫与内容管理</h2>

      {/* 内容统计概览 */}
      <div className="stats-section">
        <h3 className="section-title">内容统计</h3>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">🎵</div>
            <div className="stat-info">
              <div className="stat-value">{contentStats?.totalSongs || 0}</div>
              <div className="stat-label">总歌曲数</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">✅</div>
            <div className="stat-info">
              <div className="stat-value">{contentStats?.activeSongs || 0}</div>
              <div className="stat-label">活跃歌曲</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">📦</div>
            <div className="stat-info">
              <div className="stat-value">{contentStats?.archivedSongs || 0}</div>
              <div className="stat-label">已归档</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">▶️</div>
            <div className="stat-info">
              <div className="stat-value">{contentStats?.playableSongs || 0}</div>
              <div className="stat-label">可播放</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">🆕</div>
            <div className="stat-info">
              <div className="stat-value">{contentStats?.recentSongs || 0}</div>
              <div className="stat-label">近7天新增</div>
            </div>
          </div>
        </div>
      </div>

      {/* 爬虫统计 */}
      <div className="stats-section">
        <h3 className="section-title">爬虫统计</h3>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">🔄</div>
            <div className="stat-info">
              <div className="stat-value">{crawlStats?.totalCrawls || 0}</div>
              <div className="stat-label">总爬取次数</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">✅</div>
            <div className="stat-info">
              <div className="stat-value">{crawlStats?.successfulCrawls || 0}</div>
              <div className="stat-label">成功次数</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">❌</div>
            <div className="stat-info">
              <div className="stat-value">{crawlStats?.failedCrawls || 0}</div>
              <div className="stat-label">失败次数</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">📊</div>
            <div className="stat-info">
              <div className="stat-value">{crawlStats?.totalSongsCrawled || 0}</div>
              <div className="stat-label">已爬取歌曲</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">📈</div>
            <div className="stat-info">
              <div className="stat-value">{crawlStats?.averageSuccessRate?.toFixed(1) || 0}%</div>
              <div className="stat-label">成功率</div>
            </div>
          </div>
        </div>
      </div>

      {/* 爬取策略建议 */}
      {strategy && (
        <div className="stats-section">
          <h3 className="section-title">爬取策略建议</h3>
          <div className="strategy-card">
            <div className="strategy-status">
              {strategy.recommendations.shouldCrawl ? (
                <span className="status-warning">建议执行爬取</span>
              ) : (
                <span className="status-success">内容充足</span>
              )}
            </div>
            <div className="strategy-reasons">
              <h4>原因：</h4>
              <ul>
                {strategy.recommendations.reasons.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            </div>
            <div className="strategy-recommendation">
              <p>推荐爬取数量：{strategy.recommendations.targetCount} 首</p>
              <p>推荐平台：{strategy.recommendations.platforms.join(', ')}</p>
            </div>
            <div className="strategy-actions">
              <button
                className="action-btn primary"
                onClick={handleAutoCrawl}
                disabled={crawling || !strategy.recommendations.shouldCrawl}
              >
                {crawling ? '爬取中...' : '执行推荐爬取'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 手动爬取 - 完整自定义 */}
      <div className="stats-section">
        <h3 className="section-title">手动爬取</h3>

        {/* 爬取类型选择 */}
        <div className="crawl-form-group">
          <label className="form-label-inline">爬取类型</label>
          <div className="radio-group">
            <label className="radio-label">
              <input
                type="radio"
                value="search"
                checked={crawlTaskType === 'search'}
                onChange={(e) => setCrawlTaskType('search')}
              />
              <span>关键词搜索</span>
            </label>
            <label className="radio-label">
              <input
                type="radio"
                value="hot100"
                checked={crawlTaskType === 'hot100'}
                onChange={(e) => setCrawlTaskType('hot100')}
              />
              <span>热门榜单 (Hot 100)</span>
            </label>
          </div>
        </div>

        {/* 关键词输入（仅 search 模式） */}
        {crawlTaskType === 'search' && (
          <div className="crawl-form-group">
            <label className="form-label-inline">搜索关键词</label>
            <input
              type="text"
              className="crawl-input"
              value={crawlKeyword}
              onChange={(e) => setCrawlKeyword(e.target.value)}
              placeholder="例如：周杰伦、流行、电子"
            />
          </div>
        )}

        {/* 平台选择 */}
        <div className="crawl-form-group">
          <label className="form-label-inline">平台</label>
          <select
            className="crawl-select"
            value={crawlPlatform}
            onChange={(e) => setCrawlPlatform(e.target.value)}
          >
            <option value="netease">网易云音乐</option>
            <option value="qq">QQ音乐</option>
            <option value="kugou">酷狗音乐</option>
          </select>
        </div>

        {/* 数量滑块 */}
        <div className="crawl-form-group">
          <label className="form-label-inline">
            爬取数量
            <span className="count-display">{crawlCount} 首</span>
          </label>
          <input
            type="range"
            min="10"
            max="200"
            step="10"
            value={crawlCount}
            onChange={(e) => setCrawlCount(Number(e.target.value))}
            className="crawl-slider"
          />
          <div className="slider-marks">
            <span>10</span>
            <span>50</span>
            <span>100</span>
            <span>200</span>
          </div>
        </div>

        {/* 启动按钮 */}
        <div className="crawl-form-actions">
          <button
            className="action-btn primary"
            onClick={handleStartCrawl}
            disabled={crawling || (crawlTaskType === 'search' && !crawlKeyword.trim())}
          >
            {crawling ? (
              <>
                <span className="spinner"></span>
                <span>爬取中... 已耗时 {elapsedTime}秒</span>
              </>
            ) : (
              <>开始爬取</>
            )}
          </button>
        </div>

        {/* 错误详情 */}
        {crawlError && (
          <div className="crawl-error-detail">
            <div className="error-header">
              <span className="error-icon">⚠</span>
              <span className="error-title">爬取失败</span>
            </div>
            <div className="error-message">{crawlError}</div>
            <div className="error-suggestions">
              <p>建议：</p>
              <ul>
                <li>检查 Python 环境是否正常运行（命令行执行 `python --version`）</li>
                <li>检查网络连接是否正常</li>
                <li>尝试减少爬取数量</li>
                <li>查看服务器日志了解详细错误</li>
              </ul>
            </div>
            <button className="retry-btn" onClick={() => setCrawlError(null)}>关闭</button>
          </div>
        )}
      </div>

      {/* 爬取结果 - 增强展示 */}
      {crawlResult && (
        <div className="stats-section">
          <h3 className="section-title">爬取结果</h3>

          {/* 统计卡片 */}
          <div className="result-stats-grid">
            <div className="result-stat-card success">
              <div className="result-stat-icon">✓</div>
              <div className="result-stat-value">{crawlResult.successCount}</div>
              <div className="result-stat-label">成功</div>
            </div>
            <div className="result-stat-card error">
              <div className="result-stat-icon">✗</div>
              <div className="result-stat-value">{crawlResult.failedCount}</div>
              <div className="result-stat-label">失败</div>
            </div>
            <div className="result-stat-card new">
              <div className="result-stat-icon">+</div>
              <div className="result-stat-value">{crawlResult.newCount}</div>
              <div className="result-stat-label">新增</div>
            </div>
            <div className="result-stat-card updated">
              <div className="result-stat-icon">↻</div>
              <div className="result-stat-value">{crawlResult.updatedCount}</div>
              <div className="result-stat-label">更新</div>
            </div>
          </div>

          {/* 歌曲列表 */}
          {crawlResult.songs && crawlResult.songs.length > 0 && (
            <div className="crawl-result-songs">
              <h4 className="result-songs-title">
                爬取到的歌曲 ({crawlResult.songs.length} 首)
              </h4>
              <div className="result-songs-list">
                {crawlResult.songs.slice(0, 50).map((song: any, index: number) => (
                  <div key={song.id || index} className={`result-song-item ${song.isNew ? 'is-new' : 'is-updated'}`}>
                    <span className="song-status-icon">
                      {song.isNew ? '🆕' : '🔄'}
                    </span>
                    <div className="song-thumb-small" style={{
                      backgroundColor: song.coverColor || '#6366f1'
                    }}>
                      {song.albumCover ? (
                        <img src={song.albumCover} alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <span>♪</span>
                      )}
                    </div>
                    <div className="song-info-mini">
                      <span className="song-title-mini">{song.title}</span>
                      <span className="song-artist-mini">{song.artist}</span>
                    </div>
                    <span className={`song-tag ${song.isNew ? 'tag-new' : 'tag-updated'}`}>
                      {song.isNew ? '新增' : '更新'}
                    </span>
                  </div>
                ))}
                {crawlResult.songs.length > 50 && (
                  <div className="result-songs-more">
                    还有 {crawlResult.songs.length - 50} 首歌曲...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 内容更新操作 */}
      <div className="stats-section">
        <h3 className="section-title">内容维护</h3>
        <div className="maintenance-actions">
          <button className="action-btn" onClick={handleUpdateHotScores}>
            更新热度分数
          </button>
          <button className="action-btn" onClick={fetchData}>
            刷新数据
          </button>
        </div>
      </div>

      {/* 平台分布 */}
      {contentStats?.songsByPlatform && contentStats.songsByPlatform.length > 0 && (
        <div className="stats-section">
          <h3 className="section-title">平台分布</h3>
          <div className="platform-list">
            {contentStats.songsByPlatform.map((p, index) => (
              <div key={index} className="platform-item">
                <span className="platform-name">{p.platform || '未知'}</span>
                <span className="platform-count">{p.count} 首</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 最近爬取记录 */}
      {crawlStats?.recentCrawls && crawlStats.recentCrawls.length > 0 && (
        <div className="stats-section">
          <h3 className="section-title">最近爬取记录</h3>
          <div className="crawl-logs">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>平台</th>
                  <th>状态</th>
                  <th>总数</th>
                  <th>成功</th>
                  <th>开始时间</th>
                  <th>完成时间</th>
                </tr>
              </thead>
              <tbody>
                {crawlStats.recentCrawls.map((log) => (
                  <tr key={log.id}>
                    <td>{log.id}</td>
                    <td>{log.platform}</td>
                    <td>
                      <span className={`status ${log.status}`}>
                        {log.status === 'completed' ? '已完成' : log.status === 'running' ? '运行中' : '失败'}
                      </span>
                    </td>
                    <td>{log.totalCount}</td>
                    <td>{log.successCount}</td>
                    <td>{new Date(log.startedAt).toLocaleString()}</td>
                    <td>{log.completedAt ? new Date(log.completedAt).toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default CrawlerPage;
