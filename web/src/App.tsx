import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Track } from '@/types';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useAudioAnalyser } from '@/hooks/useAudioAnalyser';
import { useLyrics } from '@/hooks/useLyrics';
import { useListeningTracker } from '@/hooks/useListeningTracker';
import { usePlaylist } from '@/hooks/usePlaylist';
import { useSearch } from '../../shared/useSearch';
import { useLocalImport } from '../../shared/useLocalImport';
import { CinematicBackground } from '@/sonic/CinematicBackground';
import { PlaylistManager } from '@/components/PlaylistManager';
import { usePlaylistManager } from '@/hooks/usePlaylistManager';
import { SearchResultsPage } from '@/components/SearchResultsPage';
import { ImmersiveStage } from '@/components/ImmersiveStage';
import { PlaylistShelf } from '@/components/PlaylistShelf';
import { WeatherRadioPanel, WeatherRadioTrack } from '@/components/WeatherRadioPanel';
import { HomeView } from '@/components/HomeView';
import { MiniPlayerBar } from '@/components/MiniPlayerBar';
import { authApi, UserInfo, radioAPI, API_BASE, resolveServerBase } from '@/services/api';
import LoginPage from '@/pages/LoginPage';
import CommentPanel from '@/components/CommentPanel';
import AddSongPanel from '@/components/AddSongPanel';
import RadioPlaylist from '@/components/RadioPlaylist';
import UserProfile from '@/pages/UserProfile';
import type { RecommendedSong } from '@/services/api';
import { songsApi } from '@/services/api';
import { SearchIcon, UploadIcon, XIcon } from '@/components/Icons';
import { DemoBanner } from '@/components/DemoBanner';
import { resolveCoverUrl } from '@/services/cover';
import './App.css';
import './styles/rebrand.css';

// ── CachePanelInline：主界面内联缓存管理面板 ──
const CachePanelInline: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [status, setStatus] = useState<any>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState('');
  const [progress, setProgress] = useState<any>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baseUrl = resolveServerBase();

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch(`${baseUrl}/api/cache/status`);
      if (resp.ok) setStatus(await resp.json());
    } catch { /* ignore */ }
  }, [baseUrl]);

  const fetchProgress = useCallback(async () => {
    try {
      const resp = await fetch(`${baseUrl}/api/cache/progress`);
      if (resp.ok) {
        const data = await resp.json();
        setProgress(data);
        if (!data.active && downloading) {
          setDownloading(false);
          setDownloadMsg(data.success > 0 ? `完成：成功 ${data.success} 首` : '下载完成');
          fetchStatus();
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      }
    } catch { /* ignore */ }
  }, [baseUrl, downloading, fetchStatus]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  useEffect(() => {
    if (downloading && !pollRef.current) pollRef.current = setInterval(fetchProgress, 1500);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [downloading, fetchProgress]);

  const handleDownload = async (limit: number) => {
    setDownloading(true); setDownloadMsg('正在启动...'); setProgress(null);
    try {
      const resp = await fetch(`${baseUrl}/api/cache/download`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit }),
      });
      const data = await resp.json();
      if (!data.success) {
        // 兼容后端返回 error 或 message 字段
        setDownloadMsg(data.error || data.message || '启动失败');
        setDownloading(false);
      } else {
        setDownloadMsg('下载中...');
      }
    } catch { setDownloadMsg('网络错误'); setDownloading(false); }
  };

  const coverage = status?.coveragePercent || 0;
  const uncached = (status?.playableSongs || 0) - (status?.cachedPlayable || 0);
  const progPct = progress?.total > 0 ? Math.round(progress.completed / progress.total * 100) : 0;

  return (
    <div className="cache-panel-inline" onClick={e => e.stopPropagation()}>
      <div className="cache-panel-header">
        <span>缓存管理</span>
        <button className="cache-panel-close" onClick={onClose}><XIcon size={12} /></button>
      </div>
      <div className="cache-panel-body">
        <div className="cache-panel-coverage">
          <div className="cache-panel-coverage-label">
            <span>缓存覆盖率</span>
            <span className="cache-panel-coverage-pct">{coverage}%</span>
          </div>
          <div className="cache-progress-bar">
            <div className="cache-progress-fill" style={{ width: `${Math.min(coverage, 100)}%` }} />
          </div>
          <div className="cache-panel-stats">
            <span>已缓存 <b>{status?.cachedPlayable || 0}</b> / {status?.playableSongs || 0} 首</span>
            <span>{status?.cachedSizeMB || 0} MB</span>
          </div>
        </div>
        {downloading && progress?.active && (
          <div className="cache-panel-progress">
            <div className="cache-panel-progress-header">
              <span>下载中 {progress.completed}/{progress.total}</span>
            </div>
            <div className="cache-progress-bar">
              <div className="cache-progress-fill downloading" style={{ width: `${progPct}%` }} />
            </div>
            <div className="cache-panel-progress-info">{progress.currentSong || '准备中...'}</div>
          </div>
        )}
        {uncached > 0 && !downloading && (
          <div className="cache-panel-actions">
            <button className="cache-btn" onClick={() => handleDownload(20)}>下载 20 首</button>
            <button className="cache-btn primary" onClick={() => handleDownload(50)}>下载 50 首</button>
            <button className="cache-btn primary" onClick={() => handleDownload(Math.min(uncached, 100))}>
              全部 ({Math.min(uncached, 100)})
            </button>
          </div>
        )}
        {uncached <= 0 && !downloading && (
          <div className="cache-panel-done">所有可播放歌曲已缓存</div>
        )}
        {downloadMsg && !downloading && <div className="cache-panel-msg">{downloadMsg}</div>}
      </div>
    </div>
  );
};

// ── MainApp：音乐播放器主体（仅在认证成功后渲染）──
const MainApp: React.FC<{ user: UserInfo; onLogout: () => void }> = ({ user, onLogout }) => {
  const [showProfile, setShowProfile] = useState(false);
  const [showCachePanel, setShowCachePanel] = useState(false);
  const [showCommentPanel, setShowCommentPanel] = useState(false);
  // 手动添加歌曲面板开关
  const [showAddSongPanel, setShowAddSongPanel] = useState(false);
  // 最近添加的歌曲 ID（用于播放列表视觉高亮）
  const [lastAddedTrackId, setLastAddedTrackId] = useState<string | null>(null);
  // 对话式电台面板状态（已移除，保留注释）
  // const [showRadioPanel, setShowRadioPanel] = useState(false);
  // 推荐歌单面板 + 全自动电台状态（点击「电台」按钮启动）
  const [showRadioPlaylist, setShowRadioPlaylist] = useState(false);
  const [radioSongs, setRadioSongs] = useState<Track[]>([]);
  const [radioLoading, setRadioLoading] = useState(false);
  const [radioRefreshing, setRadioRefreshing] = useState(false);
  const [radioActive, setRadioActive] = useState(false);
  const radioSessionRef = useRef<string | null>(null);
  const radioFetchingRef = useRef(false);
  const pendingRadioPlayRef = useRef<string | null>(null);
  const [radioNotice, setRadioNotice] = useState<string | null>(null);
  const radioSongsLenRef = useRef(0);
  // extraTracks 必须在 usePlaylist 之前定义，因为 usePlaylist 需要合并它们
  const [extraTracks, setExtraTracks] = useState<Track[]>([]);
  const {
    playlist,
    currentIndex,
    currentTrack,
    playMode,
    next,
    prev,
    peekNext,
    select,
    isFavorite,
    toggleFavorite,
    addToRecent,
    favorites,
    recentTracks
  } = usePlaylist(extraTracks);

  const { isPlaying, position, duration, play, toggle, seek, rewind, forward, stop, error, clearError, getAudioElement, waitingForUser, refreshing, savedTrackId, setOnEnded, setOnUrlRefreshed, autoSkipCountdown, cancelAutoSkip } = useAudioPlayer();
  const { initAnalyser, getFeatures, getAnalyserNode } = useAudioAnalyser(getAudioElement);
  // 修复 (2026-08-09): 接入聆听事件追踪，将播放/跳过/完成/收藏事件上报到后端
  const { markComplete, markFavorite } = useListeningTracker(currentTrack, isPlaying, position, duration);
  // 两层视图：home（首页信息流）⇄ stage（播放态，由 ImmersiveStage 承载）
  // 支持 ?view=stage 直达沉浸舞台（调试/分享入口）
  const [view, setView] = useState<'home' | 'stage'>(() =>
    new URLSearchParams(window.location.search).get('view') === 'stage' ? 'stage' : 'home',
  );
  const [showPlaylistManager, setShowPlaylistManager] = useState(false);
  // 播放态（stage 视图）/ 3D 歌单架 / 天气电台
  const [showShelf, setShowShelf] = useState(false);
  const [showWeather, setShowWeather] = useState(false);
  const endedHandledRef = useRef(false);
  // 标记是否因错误导致播放中断（防止 error 时误触发 handleEnded 导致快速切歌）
  const errorInterruptedRef = useRef(false);

  // 当前曲目的音频 URL：始终通过本地代理获取（本地缓存 → 网易云CDN）
  // 永久方案：不再依赖网易云临时URL，音频文件缓存到本地后永久有效
  const currentAudioUrl = currentTrack
    ? `${API_BASE}/audio/${encodeURIComponent(currentTrack.id)}`
    : '';

  // 传递给 UserProfile/DailyRecommendation 的播放器状态（useMemo 避免每次渲染创建新对象）
  const playerState = useMemo(() => ({
    currentTrackId: currentTrack?.id ?? null,
    isPlaying,
    position,
    duration,
    seek,
  }), [currentTrack?.id, isPlaying, position, duration, seek]);

  const { lyrics, currentIndex: lyricIndex } = useLyrics(
    currentTrack?.lyricContent || '',
    position
  );

  // 歌词按需补取：推荐流/手动添加入队的曲目不带歌词，播放时自动从曲库接口补齐
  const lyricFetchedRef = useRef<Set<string>>(new Set());
  const currentLyricState = currentTrack?.lyricContent || '';
  useEffect(() => {
    const t = currentTrack;
    if (!t || currentLyricState || lyricFetchedRef.current.has(t.id)) return;
    lyricFetchedRef.current.add(t.id);
    let cancelled = false;
    songsApi.getById(t.id)
      .then(song => {
        const lyric = song?.lyricContent;
        if (cancelled || !lyric) return;
        setExtraTracks(prev => prev.map(x => (x.id === t.id ? { ...x, lyricContent: lyric } : x)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentTrack, currentLyricState]);

  // allPlaylist 等于 playlist，因为 usePlaylist 已合并 extraTracks
  const allPlaylist = playlist;

  // C1: 恢复上次播放的曲目（仅首次挂载时）
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !savedTrackId || allPlaylist.length === 0) return;
    restoredRef.current = true;
    const exists = allPlaylist.some(t => t.id === savedTrackId);
    if (exists) select(savedTrackId);
  }, [savedTrackId, allPlaylist, select]);

  const search = useSearch(allPlaylist, (track) => setExtraTracks(prev => [...prev, track]), {
    onPlay: (track) => {
      // 先添加到播放列表，再播放
      setExtraTracks(prev => {
        if (prev.some(t => t.id === track.id)) return prev;
        return [...prev, track];
      });
      select(track.id);
    },
  });
  const localImport = useLocalImport((track) => setExtraTracks(prev => [...prev, track]));

  // 每日推荐歌曲播放处理（A1: 自动入队 + C2: 播放历史同步）
  const handlePlayFromRecommendation = useCallback((song: RecommendedSong, allSongs?: RecommendedSong[]) => {
    if (!song.audioUrl) return;
    // 将所有有 audioUrl 的推荐歌曲转为 Track 并批量加入队列
    const tracksToAdd: Track[] = (allSongs || [song])
      .filter(s => !!s.audioUrl)
      .map(s => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        audioUrl: s.audioUrl!,
        lyricContent: '',
        coverColor: s.coverColor || '#FBBF24',
        albumCover: s.albumCover,
        album: s.album,
      }));
    setExtraTracks(prev => {
      const existing = new Set(prev.map(t => t.id));
      const newTracks = tracksToAdd.filter(t => !existing.has(t.id));
      return newTracks.length > 0 ? [...prev, ...newTracks] : prev;
    });
    select(song.id);
    // C2: 同步到播放历史
    addToRecent(song.id);
  }, [select, addToRecent]);

  // 通过 usePlaylistManager 管理播放列表，避免直接操作 localStorage
  const {
    addTrackToPlaylist: addTrackToDefaultPlaylist,
    playlists: managerPlaylists,
    currentPlaylistId,
    switchPlaylist,
    allTracks: managerAllTracks,
    getPlaylistTrackCount,
  } = usePlaylistManager(extraTracks);
  const pendingAddToPlaylistRef = useRef<string | null>(null);
  // 搜索结果加入默认播放列表：延迟到 extraTracks 更新后执行（addTrackToPlaylist 需校验曲目存在）
  useEffect(() => {
    const pendingId = pendingAddToPlaylistRef.current;
    if (pendingId && extraTracks.some(t => t.id === pendingId)) {
      addTrackToDefaultPlaylist('default', pendingId);
      pendingAddToPlaylistRef.current = null;
    }
  }, [extraTracks, addTrackToDefaultPlaylist]);

  // 手动添加歌曲成功：立即加入曲库（extraTracks）并加入默认播放列表
  const handleAddSong = useCallback((song: { id: string; title: string; artist: string; audioUrl: string; playable?: boolean }) => {
    const track: Track = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      audioUrl: song.audioUrl,
      lyricContent: '',
      coverColor: '#6366F1',
      platform: 'netease',
      playable: song.playable ?? true,
    };
    setExtraTracks(prev => prev.some(t => t.id === track.id) ? prev : [...prev, track]);
    pendingAddToPlaylistRef.current = track.id;
    setLastAddedTrackId(track.id);
  }, [setExtraTracks]);

  // 播放时初始化音频分析器 - 更积极的初始化策略
  useEffect(() => {
    if (isPlaying) {
      initAnalyser();
    }
  }, [isPlaying, initAnalyser]);

  // 切歌时确保分析器连接 - 解决频繁切歌后频谱失效问题
  useEffect(() => {
    if (currentTrack?.id) {
      // 切歌时延迟一点再检查分析器状态
      const timer = setTimeout(() => {
        const analyser = getAnalyserNode();
        if (!analyser && isPlaying) {
          console.log('[App] 切歌后重新初始化分析器');
          initAnalyser();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentTrack?.id, isPlaying, initAnalyser, getAnalyserNode]);

  // 切换曲目时自动播放（仅依赖 trackId，避免 pause 后被 re-trigger）
  useEffect(() => {
    if (!currentTrack) return;
    endedHandledRef.current = false;
    errorInterruptedRef.current = false; // 新曲目重置错误标记
    // 直接播放，音频代理会自动处理缓存/下载
    play(currentAudioUrl, currentTrack.id);
    addToRecent(currentTrack.id);
    // 预加载下一首：使用 peekNext（不修改播放状态，避免无限循环）
    const nextTrack = peekNext();
    if (nextTrack) {
      const preloadUrl = `${API_BASE}/audio/${encodeURIComponent(nextTrack.id)}`;
      fetch(preloadUrl, { method: 'HEAD' }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  const handleEnded = useCallback(() => {
    if (endedHandledRef.current) return;
    // 如果是错误中断导致的 isPlaying=false，不应触发切歌
    if (errorInterruptedRef.current) return;
    endedHandledRef.current = true;
    // 修复 (2026-08-09): 上报 'complete' 聆听事件
    markComplete();
    const nxt = next();
    if (!nxt && playMode === 'sequential') {
      stop();
    }
  }, [next, playMode, stop, markComplete]);

  // 注册歌曲自然结束回调（直接由 audio 'ended' 事件触发，不依赖 position/duration 检测）
  useEffect(() => {
    setOnEnded(handleEnded);
  }, [handleEnded, setOnEnded]);

  // 注册URL刷新成功回调：URL刷新后通知外部更新React state中的track.audioUrl
  useEffect(() => {
    setOnUrlRefreshed((trackId: string, _newUrl: string) => {
      // URL刷新成功后，不需要更新React state，因为前端始终使用代理URL /api/audio/:trackId
      // 代理层会自动处理缓存/下载，所以这里只需要记录日志
      console.log(`[App] URL刷新成功: ${trackId}`);
    });
  }, [setOnUrlRefreshed]);

  // 检测错误状态：error 出现时标记错误中断，error 清除时重置标记
  useEffect(() => {
    errorInterruptedRef.current = !!error;
  }, [error]);

  const handlePlayPause = () => {
    if (!currentTrack) return;
    toggle(currentAudioUrl, currentTrack.id); // 先 toggle 创建 Audio 元素
    // 延迟一帧初始化分析器，确保 Audio 元素已创建
    requestAnimationFrame(() => initAnalyser());
  };

  // 歌词点击跳转（position/seek 均为毫秒单位，直接传入）
  const handleLyricSeek = useCallback((timeMs: number) => {
    endedHandledRef.current = false;
    seek(timeMs);
  }, [seek]);

  // 快退 7 秒
  const handleRewind = useCallback(() => {
    if (!currentTrack) return;
    endedHandledRef.current = false;
    rewind(7000);
  }, [currentTrack, rewind]);

  // 快进 7 秒，越过结尾则切下一首
  const handleForward = useCallback(() => {
    if (!currentTrack) return;
    endedHandledRef.current = false;
    const exceeded = forward(7000);
    if (exceeded) {
      next();
    }
  }, [currentTrack, forward, next]);

  // 键盘快捷键：← 快退 / -> 快进
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleRewind();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleForward();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRewind, handleForward]);

  const handleSelectTrack = (track: Track) => {
    select(track.id);
    setShowPlaylistManager(false);
    // Mineradio 式：点击曲目 → 全屏切换到播放态
    setView('stage');
  };

  // 进入播放态（有曲目时）
  const enterStage = useCallback(() => {
    if (currentTrack) setView('stage');
  }, [currentTrack]);

  const handlePlayPlaylist = (tracks: Track[]) => {
    // 播放整个播放列表
    if (tracks.length > 0) {
      select(tracks[0].id);
    }
  };

  // 将电台返回的歌曲映射为 Track（音频统一走 /api/audio 代理）
  const mapRadioSongs = useCallback((songs: any[]): Track[] =>
    (songs || []).map((s: any) => ({
      id: s.id,
      title: s.title || '',
      artist: s.artist || '',
      audioUrl: `${API_BASE}/audio/${encodeURIComponent(s.id)}`,
      lyricContent: '',
      coverColor: '#667eea',
    })), []);

  // 启动全自动电台：调用后端秒开歌单，展示推荐歌单并自动播放第一首
  const startAutoRadio = useCallback(async () => {
    setShowRadioPlaylist(true);
    setRadioLoading(true);
    try {
      const result = await radioAPI.streamStart();
      radioSessionRef.current = result.sessionId;
      const tracks: Track[] = mapRadioSongs(result.songs);
      setRadioSongs(tracks);
      setExtraTracks(tracks);
      // 记录待播放曲目，由 effect 在 extraTracks 更新后自动播放（避免 select 闭包过期）
      pendingRadioPlayRef.current = tracks[0]?.id ?? null;
      setRadioActive(true);
    } catch (err) {
      setRadioActive(false);
      console.error('[AutoRadio] 启动失败:', err instanceof Error ? err.message : err);
    } finally {
      setRadioLoading(false);
    }
  }, [mapRadioSongs]);

  // 登录后预热：后台开始预生成电台歌单（不阻塞主流程）
  useEffect(() => {
    radioAPI.streamWarmup().catch(err => console.warn('[AutoRadio] 预热失败:', err instanceof Error ? err.message : err));
  }, []);

  // 同步 radioSongs 长度到 ref（用于判断是否达到 30 首）
  useEffect(() => {
    radioSongsLenRef.current = radioSongs.length;
  }, [radioSongs.length]);

  // 追加电台歌单：达到 30 首后清空列表，仅保留新一批（重新生成）并提示
  const appendRadioSongs = useCallback((newTracks: Track[]) => {
    const willClear = radioSongsLenRef.current >= 30;
    setRadioSongs(prev => prev.length >= 30 ? newTracks : [...prev, ...newTracks]);
    if (willClear) {
      setRadioNotice('歌单已达 30 首，已自动清空并重新生成');
    }
  }, []);

  // 提示自动消失
  useEffect(() => {
    if (!radioNotice) return;
    const t = setTimeout(() => setRadioNotice(null), 4000);
    return () => clearTimeout(t);
  }, [radioNotice]);

  // 换一批：LLM 生成全新一批歌单，追加到播放队列
  const handleRefreshRadio = useCallback(async () => {
    const sessionId = radioSessionRef.current;
    if (!sessionId) {
      // 尚未启动电台，直接启动
      await startAutoRadio();
      return;
    }
    setRadioRefreshing(true);
    try {
      const result = await radioAPI.streamRefresh(sessionId);
      const newTracks: Track[] = mapRadioSongs(result.songs);
      if (newTracks.length > 0) {
        appendRadioSongs(newTracks);
        setExtraTracks(prev => [...prev, ...newTracks]);
        // 换一批后自动播放新批次第一首（复用 pendingRadioPlayRef 机制，避免 select 闭包过期）
        pendingRadioPlayRef.current = newTracks[0].id;
      }
    } catch (err) {
      console.warn('[AutoRadio] 换一批失败:', err instanceof Error ? err.message : err);
    } finally {
      setRadioRefreshing(false);
    }
  }, [startAutoRadio, mapRadioSongs, setExtraTracks, appendRadioSongs]);

  // 电台歌单加载后自动播放第一首（依赖 extraTracks 更新后的最新 select）
  useEffect(() => {
    if (!pendingRadioPlayRef.current) return;
    const id = pendingRadioPlayRef.current;
    pendingRadioPlayRef.current = null;
    select(id);
  }, [extraTracks, select]);

  // 全自动电台：队列剩余 ≤ 3 首时预取下一批，实现无限连播
  useEffect(() => {
    if (!radioActive || !radioSessionRef.current) return;
    const remaining = playlist.length - currentIndex - 1;
    if (remaining > 3 || radioFetchingRef.current) return;
    radioFetchingRef.current = true;
    radioAPI.streamNext(radioSessionRef.current)
      .then(result => {
        const newTracks: Track[] = mapRadioSongs(result.songs);
        if (newTracks.length > 0) {
          appendRadioSongs(newTracks);
          setExtraTracks(prev => [...prev, ...newTracks]);
        }
      })
      .catch(err => console.warn('[AutoRadio] 预取失败:', err instanceof Error ? err.message : err))
      .finally(() => { radioFetchingRef.current = false; });
  }, [radioActive, currentIndex, playlist.length, setExtraTracks, mapRadioSongs, appendRadioSongs]);

  const handleToggleFavorite = () => {
    if (!currentTrack) return;
    toggleFavorite(currentTrack.id);
    // 修复 (2026-08-09): 上报 'favorite' 聆听事件
    markFavorite(currentTrack.id, currentTrack.title, currentTrack.artist);
  };

  // ── 天气电台：播放天气队列（复用电台入队模式）──
  const handlePlayWeatherQueue = useCallback((songs: WeatherRadioTrack[], _weather: unknown) => {
    const tracks: Track[] = songs.map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      audioUrl: `${API_BASE}/audio/${encodeURIComponent(s.id)}`,
      lyricContent: '',
      coverColor: '#4f8ef7',
      albumCover: s.albumCover || undefined,
      album: s.album || undefined,
    }));
    setExtraTracks(prev => {
      const existing = new Set(prev.map(t => t.id));
      return [...prev, ...tracks.filter(t => !existing.has(t.id))];
    });
    pendingRadioPlayRef.current = tracks[0]?.id ?? null;
    setShowWeather(false);
  }, []);

  // ── 3D 歌单架：封面解析与歌曲数 ──
  const managerTrackMap = useMemo(() => new Map(managerAllTracks.map(t => [t.id, t])), [managerAllTracks]);
  const resolveShelfCover = useCallback((p: { trackIds: string[] }) => {
    for (const id of p.trackIds) {
      const t = managerTrackMap.get(id);
      // 2026-11-20 封面修复：外链经服务端代理（防盗链+缓存），由并行修复引入
      if (t && t.playable !== false && t.albumCover) return { cover: resolveCoverUrl(t.albumCover) || null, color: t.coverColor || '#6366F1' };
    }
    const anyT = p.trackIds.map(id => managerTrackMap.get(id)).find(Boolean);
    return { cover: null as string | null, color: anyT?.coverColor || '#6366F1' };
  }, [managerTrackMap]);

  // F 键在首页 ⇄ 播放态间切换（需有曲目；用 ref 避免闭包过期）
  const currentTrackRef = useRef(currentTrack);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!currentTrackRef.current) return;
        setView(v => (v === 'stage' ? 'home' : 'stage'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 允许无曲目时也渲染首页（Mineradio 式：始终有"音乐空间"入口）
  const fav = currentTrack ? isFavorite(currentTrack.id) : false;

  return (
    <div
      className={`app${localImport.dragOver ? ' drag-over' : ''}`}
      onDrop={localImport.onDrop}
      onDragOver={localImport.onDragOver}
      onDragLeave={localImport.onDragLeave}
    >
      <CinematicBackground getFeatures={getFeatures} isPlaying={isPlaying} />
      <DemoBanner />

      <div className="search-bar">
        <div className="nav-brand">
          <span className="nav-brand-logo">♫</span>
          <span className="nav-brand-name">音乐盒子</span>
        </div>
        <div className="search-input-wrap">
          <SearchIcon size={14} className="search-input-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="搜索歌名/歌手..."
            value={search.query}
            onChange={(e) => {
              search.setQuery(e.target.value);
              search.fetchSuggestions(e.target.value);
            }}
          />
          {/* 搜索建议下拉框 - 搜索结果页面显示时隐藏 */}
          {search.suggestions.length > 0 && !search.showOnline && (
            <div className="search-suggestions">
              <div className="suggestions-header">
                <span className="suggestions-title">搜索建议</span>
                <button
                  className="suggestions-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    search.clearSuggestions();
                  }}
                  title="关闭建议"
                >
                  <XIcon size={14} />
                </button>
              </div>
              <div className="suggestions-list">
                {search.suggestions.map((s: any) => (
                  <div
                    key={s.id}
                    className="suggestion-item"
                    onClick={() => {
                      // 2026-11-20 搜索升级：显式传入关键词（修复旧实现的 stale closure——
                      // setQuery 是异步状态更新，紧接的 searchOnline() 读到旧 query）；
                      // 歌手条目（type='artist'）以歌手名发起"歌手→歌曲"关联搜索
                      const keyword = s.type === 'artist' ? s.artist : s.title;
                      search.setQuery(keyword);
                      search.searchOnline(keyword);
                    }}
                  >
                    <span className="suggestion-title">
                      {s.type === 'artist' ? `🎤 ${s.title}（${s.count ?? 0} 首）` : s.title}
                    </span>
                    <span className="suggestion-artist">{s.artist}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <button className="search-btn" onClick={() => search.searchOnline()} disabled={search.isSearching} title="在线搜索">
          {search.isSearching ? <span className="searching-spinner" /> : <SearchIcon size={14} />}
        </button>
        <button className="import-btn" onClick={localImport.importFiles} title="导入本地音频">
          <UploadIcon size={14} />
          <span>导入</span>
        </button>
        {/* 手动添加歌曲按钮 */}
        <button
          className="import-btn"
          onClick={() => setShowAddSongPanel(true)}
          title="添加歌曲"
        >
          <span>＋</span>
          <span>添加</span>
        </button>
        <input ref={localImport.inputRef} type="file" accept="audio/*" multiple style={{display:'none'}}
          onChange={(e) => { if (e.target.files) localImport.handleFiles(e.target.files); }} />
        {/* 缓存管理按钮 */}
        <button
          className={`cache-trigger-btn${showCachePanel ? ' active' : ''}`}
          onClick={() => setShowCachePanel(v => !v)}
          title="缓存管理"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>缓存</span>
        </button>
        {/* 评论按钮 */}
        <button
          className={`cache-trigger-btn${showCommentPanel ? ' active' : ''}`}
          onClick={() => setShowCommentPanel(v => !v)}
          title="评论"
        >
          💬
          <span>评论</span>
        </button>
        {/* AI 电台按钮（首次点击生成并播放；之后仅开关面板；换一批用于刷新） */}
        <button
          className={`cache-trigger-btn${showRadioPlaylist ? ' active' : ''}`}
          onClick={() => {
            if (showRadioPlaylist) {
              setShowRadioPlaylist(false);
            } else if (!radioSessionRef.current) {
              startAutoRadio();
            } else {
              setShowRadioPlaylist(true);
            }
          }}
          title="AI 电台"
        >
          🎙️
          <span>电台</span>
        </button>
        {/* 天气智能电台 */}
        <button
          className={`cache-trigger-btn${showWeather ? ' active' : ''}`}
          onClick={() => setShowWeather(v => !v)}
          title="天气电台"
        >
          🌤️
          <span>天气</span>
        </button>
        {/* 弹簧：用户区靠右 */}
        <div className="nav-spring" />
        {/* 用户信息 + 退出 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginLeft: 4, padding: '4px 10px',
          background: 'rgba(255,255,255,0.06)', borderRadius: 8,
          flexShrink: 0,
        }}>
          <button
            onClick={() => setShowProfile(true)}
            title="查看个人资料"
            style={{
              background: 'none', border: 'none', color: '#aaa',
              cursor: 'pointer', padding: 0, fontSize: 12,
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
              maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              transition: 'color 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#17C3B2')}
            onMouseLeave={e => (e.currentTarget.style.color = '#aaa')}
          >
            {user.username}
          </button>
          <button
            onClick={onLogout}
            title="退出登录"
            style={{
              background: 'none', border: 'none', color: '#888',
              cursor: 'pointer', padding: '2px 4px', fontSize: 11,
              borderRadius: 4, transition: 'color 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
            onMouseLeave={e => (e.currentTarget.style.color = '#888')}
          >
            退出
          </button>
        </div>
      </div>
      {/* 缓存管理面板（下拉式） */}
      {showCachePanel && (
        <>
          <div className="cache-panel-overlay" onClick={() => setShowCachePanel(false)} />
          <CachePanelInline onClose={() => setShowCachePanel(false)} />
        </>
      )}

      <CommentPanel
        songId={currentTrack?.id ?? null}
        show={showCommentPanel}
        onClose={() => setShowCommentPanel(false)}
        currentUserId={user?.id}
        isAdmin={user?.role === 'admin' || user?.role === 'super_admin'}
        currentTimeSec={position != null ? Math.floor(position / 1000) : undefined}
      />

      <RadioPlaylist
        visible={showRadioPlaylist}
        songs={radioSongs}
        loading={radioLoading}
        refreshing={radioRefreshing}
        currentTrackId={currentTrack?.id}
        notice={radioNotice}
        onClose={() => setShowRadioPlaylist(false)}
        onPlaySong={(song) => select(song.id)}
        onRefresh={handleRefreshRadio}
      />

      {search.error && !search.showOnline && (
        <div className={`search-error ${search.error.type}`}>
          <span className="error-text">{search.errorText}</span>
          <button className="error-close" onClick={search.clearError} title="关闭">
            <XIcon size={14} />
          </button>
        </div>
      )}
      {search.showOnline && (
        <SearchResultsPage
          searchQuery={search.query}
          results={search.onlineResults}
          isLoading={search.isSearching}
          error={search.error?.message || null}
          onClose={search.closeOnline}
          onPlay={(track) => { search.playTrack(track); search.closeOnline(); }}
          onAddToPlaylist={(track) => {
            // 添加到曲库（extraTracks），延迟加入默认播放列表以通过曲目存在校验
            search.addToPlaylist(track);
            pendingAddToPlaylistRef.current = track.id;
          }}
          onAddToLibrary={(track) => search.addTrack(track)}
          onRetry={() => search.searchOnline()}
          // 2026-11-20 搜索升级：加载更多 / 歌手聚合入口 / 不可播放提示
          hasMore={search.hasMore}
          isLoadingMore={search.isLoadingMore}
          loadMoreError={search.loadMoreErrorText}
          onLoadMore={() => search.loadMore()}
          artists={search.artistAggregations}
          onArtistClick={(artist: string) => { search.setQuery(artist); search.searchOnline(artist); }}
          unplayableCount={search.unplayableCount}
          totalResults={search.totalResults}
        />
      )}

      {/* 主内容区：两层视图 */}
      <main className="main">
        {view === 'home' && (
          <HomeView
            user={user}
            recentTracks={recentTracks}
            favorites={favorites}
            libraryCount={allPlaylist.length}
            playlists={managerPlaylists}
            currentPlaylistId={currentPlaylistId}
            resolveCover={resolveShelfCover}
            getTrackCount={(id) => getPlaylistTrackCount(id)}
            onPlayTrack={handleSelectTrack}
            onPlayRecommended={handlePlayFromRecommendation}
            onOpenProfile={() => setShowProfile(true)}
            onOpenShelf={() => setShowShelf(true)}
            onOpenWeather={() => setShowWeather(true)}
            onOpenRadio={() => {
              if (!radioSessionRef.current) startAutoRadio();
              else setShowRadioPlaylist(true);
            }}
            onOpenManager={() => setShowPlaylistManager(true)}
            onOpenAddSong={() => setShowAddSongPanel(true)}
            onOpenCache={() => setShowCachePanel(true)}
          />
        )}
      </main>

      {/* 错误提示条 */}
      {error && (
        <div className={`error-bar ${autoSkipCountdown !== null ? 'warning' : ''}`}>
          <span className="error-text">{error}</span>
          {autoSkipCountdown !== null && (
            <button className="error-action" onClick={cancelAutoSkip}>
              取消切换
            </button>
          )}
          <button className="error-close" onClick={clearError} title="关闭">
            <XIcon size={14} />
          </button>
        </div>
      )}

      {/* 自动播放策略拦截提示 */}
      {waitingForUser && !error && !refreshing && (
        <div className="error-bar info">
          <span className="error-text">♪ 点击播放按钮开始聆听</span>
        </div>
      )}

      {/* URL 自动刷新提示 */}
      {refreshing && (
        <div className="error-bar info">
          <span className="error-text">⟳ 正在刷新音频地址...</span>
        </div>
      )}

      {/* 播放列表管理器 */}
      {showPlaylistManager && (
        <div className="playlist-manager-overlay">
          <div className="playlist-manager-container">
            <PlaylistManager
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              onSelectTrack={handleSelectTrack}
              onPlayPlaylist={handlePlayPlaylist}
              extraTracks={extraTracks}
              highlightTrackId={lastAddedTrackId}
            />
            <button 
              className="playlist-manager-close"
              onClick={() => setShowPlaylistManager(false)}
              title="关闭播放列表管理器"
            >
              <XIcon size={20} />
            </button>
          </div>
        </div>
      )}

      {/* 首页态悬浮迷你播放条（播放态由 ImmersiveStage 承担） */}
      {view === 'home' && currentTrack && (
        <MiniPlayerBar
          track={currentTrack}
          isPlaying={isPlaying}
          position={position}
          duration={duration}
          fav={fav}
          onTogglePlay={handlePlayPause}
          onPrev={prev}
          onNext={next}
          onToggleFavorite={handleToggleFavorite}
          onSeek={(ms) => { endedHandledRef.current = false; seek(ms); }}
          onEnterStage={enterStage}
        />
      )}

      {/* 用户个人资料模态框 */}
      {showProfile && (
        <UserProfile
          user={user}
          onClose={() => setShowProfile(false)}
          onLogout={onLogout}
          onPlaySong={handlePlayFromRecommendation}
          playerState={playerState}
        />
      )}

      {/* 手动添加歌曲面板 */}
      {showAddSongPanel && (
        <AddSongPanel
          onClose={() => setShowAddSongPanel(false)}
          onAdded={handleAddSong}
        />
      )}

      {/* 播放态：全屏视觉 + 歌词 + 电影镜头（ESC/F 回首页） */}
      {currentTrack && (
        <ImmersiveStage
          visible={view === 'stage'}
          onClose={() => setView('home')}
          trackTitle={currentTrack.title}
          trackArtist={currentTrack.artist}
          coverUrl={currentTrack.albumCover}
          isPlaying={isPlaying}
          position={position}
          duration={duration}
          onSeek={(ms) => { endedHandledRef.current = false; seek(ms); }}
          onTogglePlay={handlePlayPause}
          onPrev={prev}
          onNext={next}
          getFeatures={getFeatures}
          lyrics={lyrics}
          lyricIndex={lyricIndex}
          onLyricSeek={handleLyricSeek}
        />
      )}

      {/* 3D 歌单架 */}
      <PlaylistShelf
        visible={showShelf}
        onClose={() => setShowShelf(false)}
        playlists={managerPlaylists}
        resolveCover={resolveShelfCover}
        currentPlaylistId={currentPlaylistId}
        onSwitch={switchPlaylist}
        getTrackCount={(p) => getPlaylistTrackCount(p.id)}
      />

      {/* 天气智能电台 */}
      <WeatherRadioPanel
        visible={showWeather}
        onClose={() => setShowWeather(false)}
        onPlayQueue={handlePlayWeatherQueue}
      />
    </div>
  );
};

// ── App：仅处理认证逻辑（轻量，不会因播放器 hooks 崩溃）──
const App: React.FC = () => {
  const [authUser, setAuthUser] = useState<UserInfo | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  // 执行认证检查
  useEffect(() => {
    const token = authApi.getToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }
    // 添加 5 秒超时保护
    const timeout = setTimeout(() => {
      console.warn('[App] 认证超时，清除token');
      authApi.logout();
      setAuthChecking(false);
    }, 5000);

    authApi.getMe()
      .then(user => {
        setAuthUser(user);
        setAuthError(null);
      })
      .catch((err) => {
        console.warn('[App] getMe 失败:', err);
        authApi.logout();
        // 如果是网络错误，显示提示
        if (err instanceof Error && (err.message.includes('网络') || err.message.includes('超时'))) {
          setAuthError('无法连接到服务器，请确认后端已启动');
        }
      })
      .finally(() => {
        clearTimeout(timeout);
        setAuthChecking(false);
      });

    return () => clearTimeout(timeout);
  }, []);

  const handleAuth = useCallback((_token: string, user: UserInfo) => {
    setAuthUser(user);
  }, []);

  const handleLogout = useCallback(() => {
    authApi.logout();
    setAuthUser(null);
  }, []);

  if (authChecking) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0d0d1a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#888', fontSize: 14, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 36, height: 36, border: '3px solid #2a2a4a', borderTopColor: '#17C3B2',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            margin: '0 auto 16px',
          }} />
          正在验证登录状态…
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <>
        {authError && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
            background: 'rgba(239, 68, 68, 0.9)', color: '#fff', padding: '10px 20px',
            textAlign: 'center', fontSize: 13, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          }}>
            {authError}
          </div>
        )}
        <LoginPage onAuth={handleAuth} />
      </>
    );
  }

  return <MainApp user={authUser} onLogout={handleLogout} />;
};

export default App;
