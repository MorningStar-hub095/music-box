import { useState, useEffect, useCallback, useRef } from 'react';
import { resolveServerBase } from '../services/api';

interface CacheStatus {
  cachedFiles: number;
  cachedPlayable: number;
  cachedSizeMB: number;
  totalSongs: number;
  playableSongs: number;
  coveragePercent: number;
  orphanedFiles: number;
}

interface DownloadProgress {
  active: boolean;
  total: number;
  completed: number;
  success: number;
  failed: number;
  currentSong: string;
  startedAt: number;
}

export default function CacheManager() {
  const [status, setStatus] = useState<CacheStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState('');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const baseUrl = resolveServerBase();

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch(`${baseUrl}/api/cache/status`);
      if (resp.ok) {
        const data = await resp.json();
        setStatus(data);
      }
    } catch (err) {
      console.warn('[CacheManager] 获取状态失败:', err);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  const fetchProgress = useCallback(async () => {
    try {
      const resp = await fetch(`${baseUrl}/api/cache/progress`);
      if (resp.ok) {
        const data: DownloadProgress = await resp.json();
        setProgress(data);
        // 如果下载已完成，停止轮询并刷新状态
        if (!data.active && downloading) {
          setDownloading(false);
          setDownloadMsg(data.success > 0
            ? `下载完成：成功 ${data.success} 首，失败 ${data.failed} 首`
            : '下载完成');
          fetchStatus();
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      }
    } catch { /* ignore */ }
  }, [baseUrl, downloading, fetchStatus]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // 轮询下载进度
  useEffect(() => {
    if (downloading && !pollRef.current) {
      pollRef.current = setInterval(fetchProgress, 1500);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [downloading, fetchProgress]);

  const handleDownload = async (limit: number) => {
    setDownloading(true);
    setDownloadMsg('正在启动下载...');
    setProgress(null);
    try {
      const resp = await fetch(`${baseUrl}/api/cache/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit }),
      });
      const data = await resp.json();
      if (data.success) {
        setDownloadMsg(data.message);
      } else {
        setDownloadMsg(data.message || '下载启动失败');
        setDownloading(false);
      }
    } catch {
      setDownloadMsg('网络错误');
      setDownloading(false);
    }
  };

  if (loading) {
    return <div className="cache-manager-loading">加载中...</div>;
  }

  const coverage = status?.coveragePercent || 0;
  const uncached = (status?.playableSongs || 0) - (status?.cachedPlayable || 0);
  const progressPct = progress && progress.total > 0
    ? Math.round(progress.completed / progress.total * 100)
    : 0;

  return (
    <div className="cache-manager">
      <div className="cache-stats">
        <div className="cache-stat-row">
          <span className="cache-label">总歌曲数</span>
          <span className="cache-value">{status?.totalSongs || 0}</span>
        </div>
        <div className="cache-stat-row">
          <span className="cache-label">可播放歌曲</span>
          <span className="cache-value">{status?.playableSongs || 0}</span>
        </div>
        <div className="cache-stat-row">
          <span className="cache-label">已缓存到本地</span>
          <span className="cache-value highlight">{status?.cachedPlayable || 0}</span>
        </div>
        <div className="cache-stat-row">
          <span className="cache-label">缓存大小</span>
          <span className="cache-value">{status?.cachedSizeMB || 0} MB</span>
        </div>
        <div className="cache-stat-row">
          <span className="cache-label">未缓存歌曲</span>
          <span className="cache-value warn">{uncached > 0 ? uncached : 0}</span>
        </div>
      </div>

      <div className="cache-progress-section">
        <div className="cache-progress-header">
          <span>缓存覆盖率</span>
          <span className="cache-coverage-pct">{coverage}%</span>
        </div>
        <div className="cache-progress-bar">
          <div
            className="cache-progress-fill"
            style={{ width: `${Math.min(coverage, 100)}%` }}
          />
        </div>
      </div>

      {/* 下载进度面板 */}
      {downloading && progress && progress.active && (
        <div className="cache-download-progress">
          <div className="cache-download-header">
            <span>正在下载...</span>
            <span className="cache-download-count">{progress.completed}/{progress.total}</span>
          </div>
          <div className="cache-progress-bar">
            <div
              className="cache-progress-fill downloading"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="cache-download-info">
            <span className="cache-download-song">{progress.currentSong || '准备中...'}</span>
            <span className="cache-download-stats">
              成功 {progress.success} | 失败 {progress.failed}
            </span>
          </div>
        </div>
      )}

      {uncached > 0 && !downloading && (
        <div className="cache-actions">
          <p className="cache-desc">
            缓存歌曲到本地后，播放时无需等待加载，也不会出现URL失效问题。
          </p>
          <div className="cache-btn-group">
            <button
              className="cache-btn"
              onClick={() => handleDownload(20)}
              disabled={downloading}
            >
              下载 20 首
            </button>
            <button
              className="cache-btn primary"
              onClick={() => handleDownload(50)}
              disabled={downloading}
            >
              下载 50 首
            </button>
            <button
              className="cache-btn primary"
              onClick={() => handleDownload(Math.min(uncached, 100))}
              disabled={downloading}
            >
              全部下载 ({Math.min(uncached, 100)} 首)
            </button>
          </div>
          {downloadMsg && !downloading && <p className="cache-msg">{downloadMsg}</p>}
        </div>
      )}

      {uncached <= 0 && !downloading && (
        <div className="cache-all-done">
          所有可播放歌曲已缓存到本地，播放体验最佳。
        </div>
      )}

      {downloading && downloadMsg && !progress?.active && (
        <p className="cache-msg">{downloadMsg}</p>
      )}

      <button className="cache-refresh-btn" onClick={fetchStatus}>
        刷新状态
      </button>
    </div>
  );
}
