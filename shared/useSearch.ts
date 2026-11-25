// shared/useSearch.ts - 搜索与曲库管理 Hook（Web + 小程序共享）
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Track } from './types';
import { matchesPinyinAbbr, containsPinyinAbbr } from './pinyin';

// 统一搜索API地址（优先读取环境变量，兼容 Vite / 小程序）
// - VITE_API_BASE：完整覆盖（如 https://api.example.com/api），用于生产部署
// - VITE_API_PORT：仅覆盖本地端口，默认 49200（开发环境）
function resolveSearchApi(): string {
  const env = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;
  if (env?.VITE_API_BASE) {
    return String(env.VITE_API_BASE).replace(/\/+$/, '');
  }
  const port = env?.VITE_API_PORT || '49200';
  return `http://localhost:${port}/api`;
}
const SEARCH_API = resolveSearchApi();

// ==================== 查询规范化与分词（2026-11-20 搜索升级） ====================
// 与服务端 server/src/modules/search/query-utils.ts 逻辑对齐，保证线上/线下搜索行为一致。
// 旧实现（保留备查）：直接 query.toLowerCase() 使用原文，全角/零宽字符/多余空白不归一。
function normalizeQuery(raw: string): string {
  if (!raw) return '';
  let q = String(raw).normalize('NFKC');            // 全角→半角等兼容归一
  q = q.replace(/[\u200b-\u200f\u202a-\u202e\uFEFF]/g, ''); // 去零宽字符
  q = q.replace(/\s+/g, ' ').trim();                // 压缩空白（含全角空格）
  return q;
}

// 分词：按空格拆分，空 token 过滤
function tokenizeQuery(raw: string): string[] {
  const q = normalizeQuery(raw);
  if (!q) return [];
  return q.split(' ').filter(Boolean);
}

// 搜索配置
const SEARCH_CONFIG = {
  REQUEST_TIMEOUT: 10000, // 请求超时时间 10秒
  MAX_RETRIES: 2, // 最大重试次数
  RETRY_DELAY: 1000, // 重试延迟 1秒
  CACHE_TTL: 10 * 60 * 1000, // 缓存有效期 10分钟
  MAX_CACHE_SIZE: 100, // 最大缓存数量
  DEBOUNCE_DELAY: 200, // 防抖延迟 200毫秒
};

interface SearchError {
  message: string;
  type: 'network' | 'server' | 'no_results' | 'timeout' | 'unknown';
  details?: string;
}

interface SearchOptions {
  onPlay?: (track: Track) => void;
  onAddToPlaylist?: (track: Track) => void;
  onAddToFavorites?: (track: Track) => void;
}

// 搜索缓存
const searchCache = new Map<string, { data: Track[]; timestamp: number }>();

// 清理过期缓存
function cleanCache() {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp > SEARCH_CONFIG.CACHE_TTL) {
      searchCache.delete(key);
    }
  }
  // 如果缓存超过最大大小，删除最旧的
  if (searchCache.size > SEARCH_CONFIG.MAX_CACHE_SIZE) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey) searchCache.delete(oldestKey);
  }
}

export function useSearch(
  playlist: Track[],
  onAddTrack: (track: Track) => void,
  options?: SearchOptions
) {
  const [query, setQuery] = useState('');
  const [onlineResults, setOnlineResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<SearchError | null>(null);
  const [showOnline, setShowOnline] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  // 歌手聚合（2026-11-20 搜索升级）：来自响应 searchInfo.artists，供"歌手→歌曲"关联入口使用
  const [artistAggregations, setArtistAggregations] = useState<{ artist: string; count: number }[]>([]);
  // 不可播放歌曲数量（2026-11-20 搜索升级）：来自 searchInfo.unplayableCount，供提示文案
  const [unplayableCount, setUnplayableCount] = useState(0);
  // 分页/加载更多（2026-11-20 搜索升级）：page 为已加载页码，hasMore = 本地还有下一页 || 线上还有下一批
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [onlineHasMore, setOnlineHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<SearchError | null>(null);
  // 已累计加载的线上条数（作为下一批线上请求的 onlineOffset）
  const onlineLoadedCountRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 搜索建议请求序号（2026-11-20：防竞态——旧实现无序号校验，慢响应晚到会覆盖新建议）
  const suggestSeqRef = useRef(0);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // 本地筛选：输入即过滤（2026-11-20 搜索升级：统一规范化 + 分词 AND + 专辑字段）
  // 旧实现（保留备查）：仅 title/artist 小写 includes + 拼音首字母，无专辑匹配、
  // 不分词（"歌手 歌名"组合词失效）、全角/零宽字符不归一。
  // const filtered = useMemo(() => {
  //   if (!query.trim()) return playlist;
  //   const q = query.toLowerCase();
  //   return playlist.filter(t => {
  //     const titleLower = t.title.toLowerCase();
  //     const artistLower = t.artist.toLowerCase();
  //     if (titleLower.includes(q) || artistLower.includes(q)) return true;
  //     if (q.length >= 2 && q.length <= 6) {
  //       if (matchesPinyinAbbr(t.title, q) || matchesPinyinAbbr(t.artist, q)) return true;
  //     }
  //     if (q.length >= 2) {
  //       if (containsPinyinAbbr(t.title, q) || containsPinyinAbbr(t.artist, q)) return true;
  //     }
  //     return false;
  //   });
  // }, [playlist, query]);
  const filtered = useMemo(() => {
    if (!query.trim()) return playlist;
    const tokens = tokenizeQuery(query);
    if (tokens.length === 0) return playlist;

    return playlist.filter(t => {
      // 归一化后的候选字段（含专辑）：每个词命中任一字段即可，词与词之间 AND
      const fields = [t.title, t.artist, (t as any).album]
        .filter(Boolean)
        .map(f => normalizeQuery(String(f)).toLowerCase());

      return tokens.every(token => {
        const tk = token.toLowerCase();
        if (fields.some(f => f.includes(tk))) return true;

        // 拼音匹配（沿用原拼音首字母逻辑，按词应用）
        if (tk.length >= 2) {
          const targets = [t.title, t.artist, (t as any).album].filter(Boolean) as string[];
          for (const f of targets) {
            // 首字母匹配（如 "zjl" 匹配 "周杰伦"）：限定 2~6 位，避免短词误报
            if (tk.length <= 6 && matchesPinyinAbbr(f, tk)) return true;
            if (containsPinyinAbbr(f, tk)) return true;
          }
        }
        return false;
      });
    });
  }, [playlist, query]);

  // 获取搜索建议（带防抖 + 请求序号防竞态）
  const fetchSuggestions = useCallback(async (q: string) => {
    // 清除之前的防抖定时器
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!q.trim() || q.length < 2) {
      suggestSeqRef.current += 1; // 使在途请求失效
      setSuggestions([]);
      return;
    }

    // 防抖处理
    debounceTimerRef.current = setTimeout(async () => {
      const seq = ++suggestSeqRef.current;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SEARCH_CONFIG.REQUEST_TIMEOUT);

        const resp = await fetch(
          `${SEARCH_API}/search/suggestions?q=${encodeURIComponent(q)}`,
          { signal: controller.signal }
        );

        clearTimeout(timeoutId);

        if (!resp.ok) return;
        const data = await resp.json();
        // 竞态保护（2026-11-20）：仅当仍是最新请求时才写入，慢响应晚到不覆盖新建议
        if (seq !== suggestSeqRef.current) return;
        setSuggestions(data.data?.suggestions || []);
      } catch {
        // 静默失败，不影响用户体验
      }
    }, SEARCH_CONFIG.DEBOUNCE_DELAY);
  }, []);

  // 带重试的请求函数
  const fetchWithRetry = async (url: string, retries = SEARCH_CONFIG.MAX_RETRIES): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SEARCH_CONFIG.REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        throw {
          message: '请求超时',
          type: 'timeout',
          details: '搜索服务响应时间过长，请稍后重试',
        } as SearchError;
      }

      if (retries > 0 && err instanceof TypeError) {
        // 网络错误，进行重试
        await new Promise(resolve => setTimeout(resolve, SEARCH_CONFIG.RETRY_DELAY));
        return fetchWithRetry(url, retries - 1);
      }

      throw err;
    }
  };

  // 响应 → Track 映射（2026-11-20 搜索升级：抽取共用，searchOnline 与 loadMore 复用）
  const mapLocalSong = (song: any): Track => ({
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    albumCover: song.albumCover,
    audioUrl: song.audioUrl,
    audioUrlMp3: song.audioUrlMp3,
    lyricContent: song.lyricContent || '',
    coverColor: song.coverColor,
    platform: song.platform,
    // 透出 playable（部署包内网易云歌曲 playable=false，播放时由播放器走
    // /api/refresh-track 实时刷新兜底），供 UI 置灰标注
    playable: song.playable !== false,
    duration: song.duration,
    genres: song.genres?.map((g: any) => g.genre.name) || [],
    languages: song.languages?.map((l: any) => l.language.name) || [],
  });

  const mapOnlineSong = (song: any): Track => ({
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    albumCover: song.albumCover,
    audioUrl: song.audioUrl,
    lyricContent: '',
    coverColor: '',
    platform: song.platform || 'jamendo',
    // 线上来源标记（2026-11-20）：供 UI 显示"在线"徽标
    source: song.source || 'online',
    playable: true,
    duration: song.duration,
  });

  // 按 id 去重合并（追加/刷新场景防止重复条目）
  const dedupeById = (tracks: Track[]): Track[] => {
    const seen = new Set<string>();
    return tracks.filter(t => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  };

  // 在线搜索
  // 2026-11-20 搜索升级：
  //  - 支持 qOverride：修复 stale closure bug —— 旧实现（保留备查）在 suggestions 点击时
  //    先 setQuery 再 searchOnline()，闭包内 query 还是旧值，搜的是旧词；
  //    if (!query.trim()) return; const trimmedQuery = query.trim();
  //  - 记录分页状态（page/totalPages/totalResults/onlineHasMore），供 loadMore 使用。
  const searchOnline = useCallback(async (qOverride?: string) => {
    // 查询取显式覆盖值优先（建议/歌手入口点击场景），否则取当前输入
    // 旧实现（保留备查）：const trimmedQuery = normalizeQuery(query);
    const trimmedQuery = normalizeQuery(qOverride ?? query);
    if (!trimmedQuery) return;
    // 覆盖值与当前输入不一致时同步输入框（保证搜索词展示与结果一致）
    if (trimmedQuery !== normalizeQuery(query)) {
      setQuery(trimmedQuery);
    }

    // 检查缓存（仅首页）
    cleanCache();
    const cached = searchCache.get(trimmedQuery);
    if (cached && Date.now() - cached.timestamp < SEARCH_CONFIG.CACHE_TTL) {
      setOnlineResults(cached.data);
      setShowOnline(true);
      setError(null);
      return;
    }

    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsSearching(true);
    setError(null);
    setLoadMoreError(null);

    try {
      const resp = await fetchWithRetry(
        `${SEARCH_API}/search?q=${encodeURIComponent(trimmedQuery)}`
      );

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw {
          message: `服务器返回错误 (${resp.status})`,
          type: 'server',
          details: errorData.error || resp.statusText,
        } as SearchError;
      }

      const data = await resp.json();

      if (!data.success) {
        throw {
          message: '搜索请求失败',
          type: 'server',
          details: data.error || '未知错误',
        } as SearchError;
      }

      const results = data.data?.results || [];
      // 线上增量结果（2026-11-18 搜索强化）：本地结果为主，线上（Jamendo CC 授权）
      // 作为附加段返回在 data.data.online，与本地结果合并展示
      const onlineItems: any[] = data.data?.online?.items || [];

      // 歌手聚合 / 不可播放统计 / 分页状态（2026-11-20 搜索升级）
      setArtistAggregations(data.data?.searchInfo?.artists || []);
      setUnplayableCount(Number(data.data?.searchInfo?.unplayableCount) || 0);
      const pagination = data.data?.pagination;
      setPage(pagination?.page || 1);
      setTotalPages(pagination?.total_pages || 1);
      setTotalResults(pagination?.total ?? results.length);
      setOnlineHasMore(!!data.data?.online?.hasMore);
      onlineLoadedCountRef.current = onlineItems.length;

      if (results.length === 0 && onlineItems.length === 0) {
        // 2026-11-20：空结果不再走 error 通道（旧实现（保留备查）setError no_results，
        // 结果页会渲染成"错误+重试"）；改为空列表 + showOnline，由结果页展示空状态引导。
        // if (results.length === 0 && onlineItems.length === 0) {
        //   setError({ message: `未找到与"${trimmedQuery}"相关的歌曲`, type: 'no_results', ... });
        // }
        setOnlineResults([]);
        setArtistAggregations([]);
        setUnplayableCount(0);
        setShowOnline(true);
        setError(null);
        return;
      }

      const merged = dedupeById([...results.map(mapLocalSong), ...onlineItems.map(mapOnlineSong)]);

      // 缓存结果（含线上增量，仅首页）
      searchCache.set(trimmedQuery, { data: merged, timestamp: Date.now() });

      setOnlineResults(merged);
      setShowOnline(true);
      setError(null);

      // 添加到搜索历史
      setSearchHistory(prev => {
        const newHistory = [trimmedQuery, ...prev.filter(h => h !== trimmedQuery)].slice(0, 10);
        return newHistory;
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return; // 请求被取消，忽略
      }

      console.error('[Search] 搜索失败:', err);

      if (err.type === 'server' || err.type === 'timeout') {
        setError(err as SearchError);
      } else if (err instanceof TypeError && err.message.includes('fetch')) {
        setError({
          message: '无法连接到搜索服务',
          type: 'network',
          details: `请确保后端服务已启动 (${SEARCH_API})`,
        });
      } else {
        setError({
          message: '搜索过程中发生错误',
          type: 'unknown',
          details: err.message || '未知错误',
        });
      }
      setShowOnline(false);
    } finally {
      setIsSearching(false);
    }
  }, [query]);

  // 加载更多（2026-11-20 搜索升级）：本地取下一页 + 线上取下一批（onlineOffset），
  // 结果按 id 去重后追加。失败置独立 loadMoreError，不破坏已加载内容。
  // 旧实现：无此能力（每次搜索仅加载首页 20 条 + 线上 10 条）。
  const loadMore = useCallback(async () => {
    if (!query.trim() || isLoadingMore) return;
    const nextPage = page + 1;
    const trimmedQuery = normalizeQuery(query);
    if (!trimmedQuery) return;

    setIsLoadingMore(true);
    setLoadMoreError(null);

    try {
      const resp = await fetchWithRetry(
        `${SEARCH_API}/search?q=${encodeURIComponent(trimmedQuery)}&page=${nextPage}&onlineOffset=${onlineLoadedCountRef.current}`
      );

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw {
          message: `服务器返回错误 (${resp.status})`,
          type: 'server',
          details: errorData.error || resp.statusText,
        } as SearchError;
      }

      const data = await resp.json();
      if (!data.success) {
        throw {
          message: '加载更多失败',
          type: 'server',
          details: data.error || '未知错误',
        } as SearchError;
      }

      const results = data.data?.results || [];
      const onlineItems: any[] = data.data?.online?.items || [];

      // 追加结果（去重），更新分页游标
      setOnlineResults(prev => dedupeById([...prev, ...results.map(mapLocalSong), ...onlineItems.map(mapOnlineSong)]));
      const pagination = data.data?.pagination;
      setPage(pagination?.page || nextPage);
      setTotalPages(pagination?.total_pages || totalPages);
      setTotalResults(pagination?.total ?? totalResults);
      setOnlineHasMore(!!data.data?.online?.hasMore);
      onlineLoadedCountRef.current += onlineItems.length;
      setLoadMoreError(null);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('[Search] 加载更多失败:', err);
      setLoadMoreError({
        message: '加载更多失败',
        type: err.type === 'timeout' ? 'timeout' : 'server',
        details: err.message || err.details || '请稍后重试',
      });
    } finally {
      setIsLoadingMore(false);
    }
  }, [query, isLoadingMore, page, totalPages, totalResults]);

  // 是否还有更多可加载：本地还有下一页，或线上还有下一批
  const hasMore = page < totalPages || onlineHasMore;

  // 播放歌曲
  const playTrack = useCallback((track: Track) => {
    if (options?.onPlay) {
      options.onPlay(track);
    }
  }, [options]);

  // 添加到播放列表
  const addToPlaylist = useCallback((track: Track) => {
    if (options?.onAddToPlaylist) {
      options.onAddToPlaylist(track);
    }
    // 同时添加到曲库
    onAddTrack(track);
  }, [options, onAddTrack]);

  // 添加到收藏
  const addToFavorites = useCallback((track: Track) => {
    if (options?.onAddToFavorites) {
      options.onAddToFavorites(track);
    }
  }, [options]);

  // 加入曲库
  const addTrack = useCallback(async (track: Track) => {
    try {
      // 检查是否已存在
      const exists = playlist.some(t => t.id === track.id);
      if (exists) {
        setError({
          message: '该歌曲已在曲库中',
          type: 'unknown',
          details: `${track.title} - ${track.artist}`,
        });
        return;
      }
      onAddTrack(track);
      setError(null);
    } catch (err) {
      setError({
        message: '加入曲库失败',
        type: 'unknown',
        details: err instanceof Error ? err.message : '未知错误',
      });
    }
  }, [onAddTrack, playlist]);

  // 清除搜索历史
  const clearHistory = useCallback(() => {
    setSearchHistory([]);
  }, []);

  const closeOnline = useCallback(() => setShowOnline(false), []);

  const clearError = useCallback(() => setError(null), []);

  const clearSuggestions = useCallback(() => setSuggestions([]), []);

  // 获取错误提示文本
  const getErrorText = useCallback(() => {
    if (!error) return null;

    let text = error.message;
    if (error.details) {
      text += `: ${error.details}`;
    }
    return text;
  }, [error]);

  return {
    query,
    setQuery,
    filtered,
    onlineResults,
    isSearching,
    searchOnline,
    addTrack,
    playTrack,
    addToPlaylist,
    addToFavorites,
    error,
    errorText: getErrorText(),
    clearError,
    showOnline,
    closeOnline,
    suggestions,
    clearSuggestions,
    fetchSuggestions,
    searchHistory,
    clearHistory,
    // 歌手聚合（2026-11-20 搜索升级）：命中集歌手 Top5 及其歌曲数，供"歌手→歌曲"关联入口
    artistAggregations,
    // 不可播放歌曲数量（2026-11-20 搜索升级）：播放时由播放器走 URL 实时刷新兜底
    unplayableCount,
    // 分页/加载更多（2026-11-20 搜索升级）
    hasMore,
    isLoadingMore,
    loadMore,
    loadMoreError: loadMoreError as SearchError | null,
    loadMoreErrorText: loadMoreError ? `${loadMoreError.message}: ${loadMoreError.details || ''}` : null,
    totalResults,
    totalPages,
    page,
  };
}
