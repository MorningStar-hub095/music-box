import { useRef, useState, useCallback, useEffect } from 'react';
import { API_BASE } from '../services/api';

/** 调用后端刷新服务获取新 URL（带超时和错误日志） */
export async function refreshAudioUrl(trackId: string): Promise<string | null> {
  const url = `${API_BASE}/refresh-track?id=${encodeURIComponent(trackId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) {
      console.warn(`[refreshAudioUrl] HTTP ${resp.status} for track ${trackId}`);
      return null;
    }
    const data = await resp.json();
    if (data.success && data.new_url) {
      return data.new_url as string;
    }
    return null;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.warn(`[refreshAudioUrl] 超时 for track ${trackId}`);
    } else {
      console.warn(`[refreshAudioUrl] 网络错误 for track ${trackId}:`, err);
    }
    return null;
  }
}

/**
 * 预检测音频URL有效性
 */
export async function preCheckAudioUrl(trackId: string): Promise<{ valid: boolean; source: string; reason?: string }> {
  const url = `${API_BASE}/audio/${encodeURIComponent(trackId)}/check`;
  try {
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) return { valid: false, source: 'none', reason: 'http_error' };
    return await resp.json();
  } catch {
    return { valid: false, source: 'none', reason: 'network_error' };
  }
}

/**
 * 上报音频播放错误到服务端
 */
function reportAudioError(trackId: string, errorType: string, details?: string) {
  const url = `${API_BASE}/audio/error-report`;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackId, errorType, details }),
  }).catch(() => {});
}

/** 最大重试次数（D1: URL 自动刷新最多 2 次） */
const MAX_RETRY_COUNT = 2;

/** C1: 播放状态持久化 */
const PLAYER_STATE_KEY = 'musicbox_player_state';
function loadSavedState(): { trackId?: string; volume?: number; muted?: boolean } {
  try {
    const raw = localStorage.getItem(PLAYER_STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}
function savePlayerState(trackId: string, volume: number, muted: boolean) {
  try {
    localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify({ trackId, volume, muted }));
  } catch { /* ignore */ }
}

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentUrlRef = useRef<string>('');
  const currentTrackIdRef = useRef<string>('');
  // 重试控制：避免同一曲目无限刷新重试，支持多重重试
  const retryCountRef = useRef<Map<string, number>>(new Map());
  // 用 ref 存储错误处理回调，避免 audio 事件监听器闭包过期
  const handleErrorRef = useRef<(url: string, trackId: string) => void>(() => {});
  // 外部回调：URL 刷新成功后通知更新 React state 中的 track.audioUrl
  const onUrlRefreshedRef = useRef<(trackId: string, newUrl: string) => void>(() => {});
  // 外部回调：歌曲自然播放结束时通知（替代不可靠的 position/duration 检测）
  const onEndedRef = useRef<() => void>(() => {});
  // C1: 从 localStorage 恢复状态
  const savedState = useRef(loadSavedState());
  const savedRef = savedState.current;
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(savedRef.volume ?? 80);
  const [muted, setMuted] = useState(savedRef.muted ?? false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitingForUser, setWaitingForUser] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [autoSkipCountdown, setAutoSkipCountdown] = useState<number | null>(null);
  const autoSkipTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingUrlRef = useRef<string>('');
  // 刷新进行中标记：防止同一曲目的并发刷新（多个 error 事件会触发重复刷新）
  const refreshingRef = useRef<Set<string>>(new Set());
  // rAF 高频更新 position（替代依赖 timeupdate 的 250ms 低频更新，让歌词/进度条流畅跟随）
  const rafRef = useRef<number | null>(null);
  const lastPosUpdateRef = useRef(0);
  // C1: 节流保存
  const saveThrottleRef = useRef(0);
  // 下一首预缓冲：提前加载下一首歌曲的音频数据
  const preBufferRef = useRef<HTMLAudioElement | null>(null);
  const preBufferTrackIdRef = useRef<string>('');

  /** 设置 audio 元素的事件监听器（只设置一次） */
  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.crossOrigin = 'anonymous';
      audio.addEventListener('play', () => setIsPlaying(true));
      audio.addEventListener('pause', () => setIsPlaying(false));
      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        setPosition(0);
        // 直接通知外部歌曲结束，不依赖不可靠的 position/duration 状态检测
        onEndedRef.current();
      });
      audio.addEventListener('loadedmetadata', () => {
        if (!isNaN(audio.duration) && audio.duration > 0) {
          setDuration(audio.duration * 1000);
        }
      });
      audio.addEventListener('waiting', () => setIsLoading(true));
      audio.addEventListener('canplay', () => setIsLoading(false));
      audio.addEventListener('playing', () => setIsLoading(false));
      // 关键：error 事件触发自动刷新（URL 失效通常通过 error 事件触发）
      audio.addEventListener('error', () => {
        setIsPlaying(false);
        setIsLoading(false);
        // 忽略音源切换导致的 MEDIA_ERR_ABORTED(code=1)：
        // tryPlay 中 removeAttribute('src')/load() 切换 src 会触发该事件，并非真正的 URL 失效，
        // 否则会在刷新成功后再次误触发刷新，导致「已刷新却显示失效」。
        if (audio.error && audio.error.code === 1) {
          return;
        }
        const failedUrl = currentUrlRef.current;
        const trackId = currentTrackIdRef.current;
        reportAudioError(trackId, 'playback_error', `audio_error_${audio.error?.code || 'unknown'}`);
        // 仅当 error 与当前 URL 相关时才触发刷新
        if (failedUrl && trackId && audio.src === failedUrl) {
          handleErrorRef.current(failedUrl, trackId);
        }
      });
      audioRef.current = audio;
    }
    return audioRef.current;
  }, []);

  /** 内部：尝试播放指定 URL（先清理可能的 error 状态） */
  const tryPlay = useCallback((url: string, trackId: string) => {
    const audio = ensureAudio();
    setError(null);
    setIsLoading(true);
    currentUrlRef.current = url;
    currentTrackIdRef.current = trackId;
    // 重置 position/duration，防止上一首歌的残留值误触发 handleEnded
    setPosition(0);
    setDuration(0);
    // 清理可能的 error 状态：先移除 src 再 load，避免 audio.error 残留
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    // 设置新 src
    audio.src = url;
    // 显式重置播放位置，防止上一首 seek 位置残留
    audio.currentTime = 0;
    audio.play().then(() => {
        setWaitingForUser(false);
        pendingUrlRef.current = '';
        setIsPlaying(true);
      }).catch((err: DOMException) => {
        if (err && err.name === 'NotAllowedError') {
          // 自动播放被拦截，等待用户交互
          setWaitingForUser(true);
          pendingUrlRef.current = url;
          setIsLoading(false);
          return;
        }
        // 其他错误：可能是 URL 失效，尝试自动刷新
        handleErrorRef.current(url, trackId);
      });
  }, [ensureAudio]);

  /** 启动自动切歌倒计时：重置播放器状态，停止音频，启动3秒倒计时 */
  const startAutoSkip = useCallback((message: string) => {
    // 1. 停止音频播放（但不清除 src，保留歌词等元数据）
    if (audioRef.current) {
      audioRef.current.pause();
    }
    // 2. 重置播放器状态
    setIsPlaying(false);
    setIsLoading(false);
    setPosition(0);
    setDuration(0);
    // 3. 设置错误提示并启动倒计时
    setError(message);
    setAutoSkipCountdown(3);
  }, []);

  /** 处理播放错误：URL 失效时自动刷新，支持多重重试 */
  const handlePlaybackError = useCallback(async (_failedUrl: string, trackId: string) => {
    // 防止同一曲目并发刷新：多个 error 事件（尤其音源切换）会导致重复刷新，
    // 后到的失败结果会覆盖先前的成功结果，造成「已刷新却显示失效」。
    if (refreshingRef.current.has(trackId)) {
      return;
    }

    // 获取当前重试次数
    const currentRetryCount = retryCountRef.current.get(trackId) || 0;
    
    // 超过最大重试次数，不再重试
    if (currentRetryCount >= MAX_RETRY_COUNT) {
      reportAudioError(trackId, 'max_retries', 'Reached max retry count');
      startAutoSkip('音频不可用，3秒后自动切换下一首');
      return;
    }

    refreshingRef.current.add(trackId);
    setRefreshing(true);
    setError(null);
    setIsLoading(true);
    
    // 增加重试计数
    retryCountRef.current.set(trackId, currentRetryCount + 1);

    // 请求服务端刷新URL（服务端会更新数据库中的URL）
    const newUrl = await refreshAudioUrl(trackId);
    refreshingRef.current.delete(trackId);
    setRefreshing(false);

    // 刷新期间用户已切换曲目：忽略本次结果，避免状态错乱
    if (currentTrackIdRef.current !== trackId) {
      return;
    }

    if (newUrl) {
      // 刷新成功：取消可能存在的自动切歌倒计时，避免旧的「失效」提示覆盖成功状态
      if (autoSkipTimerRef.current) {
        clearInterval(autoSkipTimerRef.current);
        autoSkipTimerRef.current = null;
      }
      setAutoSkipCountdown(null);
      // 通知外部更新 React state 中的 track.audioUrl
      onUrlRefreshedRef.current(trackId, newUrl);
      // 关键修复：始终使用代理URL重试，而不是CDN URL
      // 代理层会自动处理缓存/下载，确保下次播放也能正常工作
      const proxyUrl = `${API_BASE}/audio/${encodeURIComponent(trackId)}?_retry=${currentRetryCount + 1}`;
      tryPlay(proxyUrl, trackId);
    } else {
      // 刷新失败：服务端返回 null
      reportAudioError(trackId, 'refresh_failed');
      startAutoSkip('音频URL已失效，3秒后自动切换下一首');
    }
  }, [tryPlay, startAutoSkip]);

  // 同步 ref，让 audio error 事件能调用最新的 handlePlaybackError
  useEffect(() => {
    handleErrorRef.current = handlePlaybackError;
  }, [handlePlaybackError]);

  // 3秒倒计时自动切歌
  useEffect(() => {
    if (autoSkipCountdown === null || autoSkipCountdown <= 0) return;
    autoSkipTimerRef.current = setInterval(() => {
      setAutoSkipCountdown(prev => {
        if (prev === null || prev <= 0) {
          if (autoSkipTimerRef.current) clearInterval(autoSkipTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (autoSkipTimerRef.current) clearInterval(autoSkipTimerRef.current);
    };
  }, [autoSkipCountdown]);

  // 当倒计时归零时触发切歌
  useEffect(() => {
    if (autoSkipCountdown === 0) {
      setAutoSkipCountdown(null);
      setError(null);
      // 延迟到下一个事件循环，确保 React 已批量更新 state（error 清除 → errorInterruptedRef 重置）
      setTimeout(() => {
        onEndedRef.current();
      }, 0);
    }
  }, [autoSkipCountdown]);

  const cancelAutoSkip = useCallback(() => {
    if (autoSkipTimerRef.current) clearInterval(autoSkipTimerRef.current);
    autoSkipTimerRef.current = null;
    setAutoSkipCountdown(null);
    setError(null);
  }, []);

  /** 播放指定曲目的 URL */
  const play = useCallback((url: string, trackId?: string) => {
    const audio = ensureAudio();
    setError(null);

    const tid = trackId || currentTrackIdRef.current;
    // 切换到新曲目时清除新曲目的重试计数
    if (trackId && trackId !== currentTrackIdRef.current) {
      retryCountRef.current.delete(trackId);
    }
    // C1: 保存当前播放曲目
    if (tid) savePlayerState(tid, volume, muted);

    // 同一 URL：如果已经在播放中，不操作；如果暂停中，直接恢复播放
    if (currentUrlRef.current === url && !audio.error) {
      if (!audio.paused) return;  // 正在播放，无需操作
      // 已加载但暂停中 → 直接恢复播放
      setIsLoading(true);
      audio.play().then(() => {
        setIsPlaying(true);
        setIsLoading(false);
      }).catch((err: DOMException) => {
        if (err && err.name === 'NotAllowedError') {
          setWaitingForUser(true);
          pendingUrlRef.current = url;
          setIsLoading(false);
          return;
        }
        if (tid) handleErrorRef.current(url, tid);
        else {
          setError('播放失败，请稍后重试');
          setIsPlaying(false);
          setIsLoading(false);
        }
      });
      return;
    }

    // 切换新 URL 或 audio 处于 error 状态 → 重新加载
    tryPlay(url, tid || '');
  }, [ensureAudio, tryPlay]);

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

  const resume = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.paused) {
      setWaitingForUser(false);
      pendingUrlRef.current = '';
      // 如果 audio 处于 error 状态，重新加载
      if (audio.error) {
        const url = currentUrlRef.current;
        const tid = currentTrackIdRef.current;
        if (url && tid) {
          tryPlay(url, tid);
          return;
        }
      }
      setIsLoading(true);
      audio.play().then(() => {
        setIsPlaying(true);
        setIsLoading(false);
      }).catch((err: DOMException) => {
        if (err && err.name === 'NotAllowedError') {
          setWaitingForUser(true);
          setIsLoading(false);
          return;
        }
        const tid = currentTrackIdRef.current;
        if (tid) handleErrorRef.current(currentUrlRef.current, tid);
        else {
          setError('播放失败，请稍后重试');
          setIsPlaying(false);
          setIsLoading(false);
        }
      });
    }
  }, [tryPlay, handlePlaybackError]);

  const seek = useCallback((ms: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = ms / 1000;
      setPosition(ms);
    }
  }, []);

  /** 快退：后退 ms 毫秒，越过开头则从头播放 */
  const rewind = useCallback((ms: number = 7000) => {
    const audio = audioRef.current;
    if (!audio) return;
    const newPos = audio.currentTime * 1000 - ms;
    if (newPos <= 0) {
      audio.currentTime = 0;
      setPosition(0);
    } else {
      audio.currentTime = newPos / 1000;
      setPosition(newPos);
    }
  }, []);

  /** 快进：前进 ms 毫秒，越过结尾返回 true（由调用者切下一首） */
  const forward = useCallback((ms: number = 7000): boolean => {
    const audio = audioRef.current;
    if (!audio) return false;
    const dur = audio.duration * 1000;
    const newPos = audio.currentTime * 1000 + ms;
    if (dur > 0 && newPos >= dur) {
      return true; // 越过结尾，通知调用者切歌
    }
    audio.currentTime = newPos / 1000;
    setPosition(newPos);
    return false;
  }, []);

  const toggle = useCallback((url: string, trackId?: string) => {
    const audio = audioRef.current;
    if (!audio) {
      play(url, trackId);
      return;
    }
    // 如果 audio 处于 error 状态，强制重新加载
    if (audio.error) {
      setWaitingForUser(false);
      pendingUrlRef.current = '';
      if (trackId && trackId !== currentTrackIdRef.current) {
        retryCountRef.current.delete(trackId);
      }
      tryPlay(url, trackId || currentTrackIdRef.current || '');
      return;
    }
    if (audio.paused) {
      setWaitingForUser(false);
      pendingUrlRef.current = '';
      // URL 不匹配时重新加载
      if (currentUrlRef.current !== url) {
        if (trackId && trackId !== currentTrackIdRef.current) {
          retryCountRef.current.delete(trackId);
        }
        tryPlay(url, trackId || '');
      } else {
        // 同 URL，用户主动点击 → 恢复播放
        setIsLoading(true);
        audio.play().then(() => {
          setIsPlaying(true);
          setIsLoading(false);
        }).catch((err: DOMException) => {
          if (err && err.name === 'NotAllowedError') {
            setWaitingForUser(true);
            setIsLoading(false);
            return;
          }
          if (trackId) handleErrorRef.current(url, trackId);
          else {
            setError('播放失败，请稍后重试');
            setIsPlaying(false);
            setIsLoading(false);
          }
        });
      }
    } else {
      audio.pause();
    }
  }, [play, tryPlay, handlePlaybackError]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPosition(0);
      setIsPlaying(false);
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted(m => !m);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /** 预缓冲下一首歌曲的音频数据 */
  const preBufferNext = useCallback((url: string, trackId: string) => {
    // 清理之前的预缓冲
    if (preBufferRef.current) {
      preBufferRef.current.pause();
      preBufferRef.current.src = '';
      preBufferRef.current = null;
    }
    if (!url || url === currentUrlRef.current) return;
    preBufferTrackIdRef.current = trackId;
    const preAudio = new Audio();
    preAudio.preload = 'auto';
    preAudio.crossOrigin = 'anonymous';
    preAudio.src = url;
    // 触发加载但不播放
    preAudio.load();
    preBufferRef.current = preAudio;
  }, []);

  /** 获取预缓冲的音频（如果匹配） */
  const getPreBuffered = useCallback((trackId: string): HTMLAudioElement | null => {
    if (preBufferRef.current && preBufferTrackIdRef.current === trackId) {
      const buffered = preBufferRef.current;
      preBufferRef.current = null;
      preBufferTrackIdRef.current = '';
      return buffered;
    }
    return null;
  }, []);

  const getAudioElement = useCallback(() => audioRef.current, []);

  /** 设置 URL 刷新成功回调（外部用此更新 React state） */
  const setOnUrlRefreshed = useCallback((cb: (trackId: string, newUrl: string) => void) => {
    onUrlRefreshedRef.current = cb;
  }, []);

  /** 设置歌曲自然结束回调（外部用此触发下一首） */
  const setOnEnded = useCallback((cb: () => void) => {
    onEndedRef.current = cb;
  }, []);

  // 播放时用 rAF 高频更新 position（约 50ms 一次），让歌词/进度条流畅跟随
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    const tick = (now: number) => {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        if (now - lastPosUpdateRef.current > 50) {
          setPosition(audio.currentTime * 1000);
          lastPosUpdateRef.current = now;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying]);

  // 音量同步
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume / 100;
    }
  }, [volume, muted]);

  // C1: 持久化音量/静音状态（节流 1 秒）
  useEffect(() => {
    const now = Date.now();
    if (now - saveThrottleRef.current < 1000) return;
    saveThrottleRef.current = now;
    savePlayerState(currentTrackIdRef.current, volume, muted);
  }, [volume, muted]);

  // 清理
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
        currentUrlRef.current = '';
      }
      // 清理预缓冲音频
      if (preBufferRef.current) {
        preBufferRef.current.pause();
        preBufferRef.current.src = '';
        preBufferRef.current = null;
      }
    };
  }, []);

  return {
    isPlaying, position, duration, play, pause, resume, toggle, seek, rewind, forward, stop,
    volume, setVolume, muted, toggleMute, isLoading, error, clearError,
    getAudioElement, waitingForUser, refreshing, setOnUrlRefreshed, setOnEnded,
    savedTrackId: savedRef.trackId,
    autoSkipCountdown, cancelAutoSkip,
    preBufferNext, getPreBuffered,
  };
}
