import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Track } from '@/types';
import { SkeletonLoader } from './SkeletonLoader';
import { XIcon, MusicIcon, PlayIcon, ListIcon, PlusIcon } from '@/components/Icons';
import { resolveCoverUrl } from '@/services/cover';
import './SearchResultsPage.css';

interface SearchResultsPageProps {
  searchQuery: string;
  results: Track[];
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onPlay: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
  onAddToLibrary: (track: Track) => void;
  onRetry: () => void;
  /** 是否还有更多可加载（2026-11-20 搜索升级） */
  hasMore?: boolean;
  /** 加载更多进行中 */
  isLoadingMore?: boolean;
  /** 加载更多失败信息（独立于主错误，不破坏已加载内容） */
  loadMoreError?: string | null;
  /** 加载更多回调 */
  onLoadMore?: () => void;
  /** 命中歌手聚合（歌手→歌曲关联入口，2026-11-20 搜索升级） */
  artists?: { artist: string; count: number }[];
  onArtistClick?: (artist: string) => void;
  /** 不可播放歌曲数量（音频未随库分发，播放时自动刷新链接） */
  unplayableCount?: number;
  /** 本地命中总数（含未加载页） */
  totalResults?: number;
}

interface ContextMenu {
  track: Track;
  x: number;
  y: number;
}

export const SearchResultsPage: React.FC<SearchResultsPageProps> = ({
  searchQuery,
  results,
  isLoading,
  error,
  onClose,
  onPlay,
  onAddToPlaylist,
  onAddToLibrary,
  onRetry,
  hasMore = false,
  isLoadingMore = false,
  loadMoreError = null,
  onLoadMore,
  artists = [],
  onArtistClick,
  unplayableCount = 0,
  totalResults,
}) => {
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 显示提示信息
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 2000);
  }, []);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // 关闭上下文菜单
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // 点击歌曲显示操作菜单
  const handleTrackClick = useCallback((track: Track, event: React.MouseEvent) => {
    event.stopPropagation();
    // 向左偏移200px，确保菜单不会超出屏幕右侧
    const menuWidth = 200;
    const x = Math.max(10, event.clientX - menuWidth);
    setContextMenu({
      track,
      x,
      y: event.clientY,
    });
  }, []);

  // 操作菜单项点击
  const handleMenuAction = useCallback((action: string, track: Track) => {
    closeContextMenu();
    switch (action) {
      case 'play':
        onPlay(track);
        showToast(`正在播放: ${track.title}`, 'success');
        break;
      case 'playlist':
        onAddToPlaylist(track);
        showToast(`已添加到播放列表: ${track.title}`, 'success');
        break;
      case 'library':
        onAddToLibrary(track);
        showToast(`已添加到曲库: ${track.title}`, 'success');
        break;
    }
  }, [onPlay, onAddToPlaylist, onAddToLibrary, closeContextMenu, showToast]);

  // ESC键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (contextMenu) {
          closeContextMenu();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, contextMenu, closeContextMenu]);

  // 格式化时长（2026-11-20 修复：本地歌曲 duration 为秒、线上 Jamendo 也为秒，
  // 旧实现（保留备查）按毫秒换算导致全部显示 00:00）
  // const formatDuration = (ms?: number) => {
  //   if (!ms) return '--:--';
  //   const minutes = Math.floor(ms / 60000);
  //   const seconds = Math.floor((ms % 60000) / 1000);
  //   return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  // };
  const formatDuration = (value?: number) => {
    if (!value || value <= 0) return '--:--';
    // 兼容历史数据：≥10000 视为毫秒，否则视为秒
    const totalSeconds = value >= 10000 ? Math.floor(value / 1000) : Math.floor(value);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // 来源徽标文案（2026-11-20 搜索升级）：区分线上即时结果与本地 CC 授权曲库
  const sourceBadge = (track: Track): string | null => {
    if (track.source === 'online') return '在线';
    if (track.platform === 'jamendo') return 'CC';
    if (track.playable === false) return '需刷新';
    return null;
  };

  return (
    <div className="search-results-page">
      {/* 顶部栏 */}
      <div className="search-results-header">
        <div className="header-info">
          <h2 className="header-title">搜索结果</h2>
          <span className="header-count">
            {isLoading
              ? '搜索中...'
              // 2026-11-20：优先展示服务端命中总数（含未加载页），否则回退当前列表长度
              : totalResults
                ? `${results.length} / ${totalResults} 首歌曲`
                : `${results.length} 首歌曲`}
          </span>
        </div>
        <button className="close-btn" onClick={onClose} title="关闭">
          <XIcon size={20} />
        </button>
      </div>

      {/* 搜索词显示 */}
      <div className="search-query-display">
        <span className="query-label">搜索词：</span>
        <span className="query-text">{searchQuery}</span>
      </div>

      {/* 歌手聚合入口（2026-11-20 搜索升级）：点击以歌手名发起"歌手→歌曲"关联搜索 */}
      {artists.length > 0 && onArtistClick && (
        <div className="search-artist-chips">
          {artists.map((a) => (
            <button
              key={a.artist}
              className="artist-chip"
              onClick={() => onArtistClick(a.artist)}
              title={`查看 ${a.artist} 的 ${a.count} 首歌曲`}
            >
              🎤 {a.artist}
              <span className="artist-chip-count">{a.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* 不可播放提示（2026-11-20 搜索升级）：音频未随库分发，播放时自动刷新链接 */}
      {!isLoading && !error && unplayableCount > 0 && (
        <div className="search-unplayable-hint">
          ⚠ {unplayableCount} 首歌曲音频未随库分发，播放时将自动刷新播放链接
        </div>
      )}

      {/* 内容区域 */}
      <div className="search-results-content">
        {/* 加载状态 - 骨架屏 */}
        {isLoading && <SkeletonLoader count={5} />}

        {/* 错误状态 */}
        {error && !isLoading && (
          <div className="search-error-state">
            <div className="error-icon">!</div>
            <p className="error-message">{error}</p>
            <button className="retry-btn" onClick={onRetry}>
              重试
            </button>
          </div>
        )}

        {/* 空结果状态 */}
        {!isLoading && !error && results.length === 0 && (
          <div className="search-empty-state">
            <MusicIcon size={48} className="empty-icon" />
            <p className="empty-title">未找到相关歌曲</p>
            <p className="empty-hint">请尝试其他关键词</p>
          </div>
        )}

        {/* 搜索结果列表 */}
        {!isLoading && !error && results.length > 0 && (
          <div className="search-results-list">
            {results.map((track) => {
              const badge = sourceBadge(track);
              const unplayable = track.playable === false;
              return (
                <div
                  key={track.id}
                  className={`search-result-item${unplayable ? ' unplayable' : ''}`}
                  onClick={(e) => handleTrackClick(track, e)}
                >
                  <div className="result-cover" style={{
                    background: `linear-gradient(135deg, ${track.coverColor || '#4b5b7c'} 0%, var(--glass-bg) 100%)`
                  }}>
                    {track.albumCover ? (
                      /* 2026-11-20 封面修复：外链经服务端代理（防盗链+缓存），由并行修复引入 */
                      <img src={resolveCoverUrl(track.albumCover)} alt={track.title} referrerPolicy="no-referrer" loading="lazy" />
                    ) : (
                      <MusicIcon size={20} fill="#fff" />
                    )}
                  </div>
                  <div className="result-info">
                    <span className="result-title">
                      {track.title}
                      {badge && <span className={`result-badge${unplayable ? ' warn' : ''}`}>{badge}</span>}
                    </span>
                    <span className="result-artist">{track.artist}</span>
                  </div>
                  <span className="result-duration">{formatDuration(track.duration)}</span>
                  <button className="result-action-btn" title="操作">
                    <ListIcon size={16} />
                  </button>
                </div>
              );
            })}

            {/* 加载更多（2026-11-20 搜索升级）：失败显示独立错误 + 重试，不破坏已加载内容 */}
            {loadMoreError && onLoadMore && (
              <div className="load-more-error">
                <span>{loadMoreError}</span>
                <button className="retry-btn" onClick={onLoadMore}>重试</button>
              </div>
            )}
            {hasMore && onLoadMore && !loadMoreError && (
              <button
                className="load-more-btn"
                onClick={onLoadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? <span className="loading-spinner-sm" /> : null}
                {isLoadingMore ? '加载中...' : '加载更多'}
              </button>
            )}
            {!hasMore && results.length > 0 && (
              <div className="list-end-hint">— 已加载全部结果 —</div>
            )}
          </div>
        )}
      </div>

      {/* 上下文菜单 */}
      {contextMenu && (
        <>
          <div className="context-menu-overlay" onClick={closeContextMenu} />
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="menu-header">
              <span className="menu-title">{contextMenu.track.title}</span>
              <span className="menu-artist">{contextMenu.track.artist}</span>
            </div>
            <div className="menu-divider" />
            <button
              className="menu-item"
              onClick={() => handleMenuAction('play', contextMenu.track)}
            >
              <PlayIcon size={16} />
              <span>播放</span>
            </button>
            <button
              className="menu-item"
              onClick={() => handleMenuAction('playlist', contextMenu.track)}
            >
              <PlusIcon size={16} />
              <span>加入播放列表</span>
            </button>
            <button
              className="menu-item"
              onClick={() => handleMenuAction('library', contextMenu.track)}
            >
              <ListIcon size={16} />
              <span>加入曲库</span>
            </button>
            <div className="menu-divider" />
            <button className="menu-item cancel" onClick={closeContextMenu}>
              <span>取消</span>
            </button>
          </div>
        </>
      )}

      {/* 提示信息 */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
};

export default SearchResultsPage;
