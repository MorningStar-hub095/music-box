// 统一 API 地址（与 shared/useSearch.ts 保持一致）
const API_PORT = import.meta.env.VITE_API_PORT || '49200';

/**
 * 解析 API 基础地址：
 * - 显式配置 VITE_API_BASE 时优先使用（部署时可用环境变量覆盖）
 * - 生产构建（Electron 打包版 / Express 静态托管 / nginx 同源反代）：
 *   页面与 API 同源，使用相对路径 /api —— 后端端口动态漂移时前端不再指向写死的 49200
 * - 开发模式：Vite 开发服务器端口与 API 端口不同，回退到 http://localhost:PORT/api
 */
export function resolveApiBase(): string {
  const envBase = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
  if (envBase) return envBase.replace(/\/+$/, '');
  const loc = typeof window !== 'undefined' ? window.location : null;
  if (!import.meta.env.DEV && loc && (loc.protocol === 'https:' || loc.protocol === 'http:')) {
    return '/api';
  }
  return `http://localhost:${API_PORT}/api`;
}

/** 服务器根地址（不含 /api 前缀），生产同源部署下为空字符串（拼接相对路径） */
export function resolveServerBase(): string {
  const apiBase = resolveApiBase();
  return apiBase.startsWith('http') ? apiBase.replace(/\/api$/, '') : '';
}

export const API_BASE = resolveApiBase();

// token 存储键（与 useStorage.ts 的 mb_ 前缀约定保持一致）
const TOKEN_KEY = 'mb_token';

// 请求超时时间（毫秒）
const REQUEST_TIMEOUT = 10_000;
// AI 推荐类请求超时时间（LLM 推理需要更长时间）
const AI_REQUEST_TIMEOUT = 120_000;

/** 带超时的 fetch 封装 */
function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = REQUEST_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** 统一处理 fetch 异常，将底层错误转为友好提示 */
function normalizeFetchError(err: unknown): Error {
  if (err instanceof TypeError) {
    return new Error('网络连接失败，请检查网络');
  }
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new Error('请求超时，请稍后再试');
  }
  if (err instanceof Error) return err;
  return new Error('请求失败');
}

/** 检查响应状态码，处理 429 等特殊状态 */
function checkResponseStatus(resp: Response, json: ApiResponse): void {
  if (resp.status === 429) {
    throw new Error('请求过于频繁，请稍后再试');
  }
  if (!resp.ok || !json.success) {
    throw new Error(json.error || `请求失败 (${resp.status})`);
  }
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** 自动访客登录：首次访问时创建访客用户并获取 token */
let guestLoginPromise: Promise<string | null> | null = null;

async function ensureToken(): Promise<string | null> {
  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing) return existing;

  // 避免并发重复请求
  if (guestLoginPromise) return guestLoginPromise;

  guestLoginPromise = (async () => {
    try {
      const resp = await fetchWithTimeout(`${API_BASE}/auth/guest`, { method: 'POST' });
      const json = await resp.json();
      if (resp.ok && json.success && json.data?.token) {
        localStorage.setItem(TOKEN_KEY, json.data.token);
        console.log('[auth] 访客登录成功:', json.data.user?.username);
        return json.data.token as string;
      }
      console.warn('[auth] 访客登录失败:', json.error);
      return null;
    } catch (e) {
      console.warn('[auth] 访客登录请求异常:', e);
      return null;
    } finally {
      guestLoginPromise = null;
    }
  })();

  return guestLoginPromise;
}

/** 推荐歌曲（来自后端 /recommendation/daily） */
export interface RecommendedSong {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumCover?: string;
  audioUrl?: string;
  coverColor?: string;
  hotScore?: number;
  features?: unknown;
  playable?: boolean;
}

interface DailyRecommendationData {
  songs: RecommendedSong[];
  generatedAt?: string | null;
}

/**
 * 带认证的请求：自动注入 Bearer token，支持自动访客登录。
 * 首次请求无 token 时自动创建访客用户；401 时清除 token 重试一次。
 */
async function request<T = unknown>(
  path: string,
  options: RequestInit = {},
  timeout: number = REQUEST_TIMEOUT
): Promise<T> {
  const url = `${API_BASE}${path}`;
  let token = await ensureToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let resp: Response;
  try {
    resp = await fetchWithTimeout(url, { ...options, headers }, timeout);
  } catch (err) {
    console.error(`[api] ${options.method || 'GET'} ${url} 网络异常:`, err);
    throw normalizeFetchError(err);
  }
  const json = (await resp.json().catch(() => ({}))) as ApiResponse<T>;

  if (!resp.ok) {
    console.warn(`[api] ${options.method || 'GET'} ${url} → ${resp.status}`, json);
  }

  // 401 且有 token → token 可能过期，清除后重试一次（触发 ensureToken 重新访客登录）
  if (resp.status === 401 && token) {
    console.warn('[api] 401 → 清除token并重试');
    localStorage.removeItem(TOKEN_KEY);
    token = await ensureToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      let retryResp: Response;
      try {
        retryResp = await fetchWithTimeout(url, { ...options, headers }, timeout);
      } catch (err) {
        console.error(`[api] ${url} 重试网络异常:`, err);
        throw normalizeFetchError(err);
      }
      const retryJson = (await retryResp.json().catch(() => ({}))) as ApiResponse<T>;
      if (!retryResp.ok) {
        console.warn(`[api] ${url} 重试 → ${retryResp.status}`, retryJson);
      }
      checkResponseStatus(retryResp, retryJson);
      return retryJson.data as T;
    } else {
      console.error('[api] 重试: ensureToken 返回 null，无法获取新token');
    }
  }

  checkResponseStatus(resp, json);
  return json.data as T;
}

/**
 * 公开请求：不注入 token、不自动创建访客用户。
 * 用于注册、登录等无需认证的端点。
 */
async function requestPublic<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  let resp: Response;
  try {
    resp = await fetchWithTimeout(`${API_BASE}${path}`, { ...options, headers });
  } catch (err) {
    throw normalizeFetchError(err);
  }
  const json = (await resp.json().catch(() => ({}))) as ApiResponse<T>;

  checkResponseStatus(resp, json);
  return json.data as T;
}

/** 检测是否为网络层错误（网络不可达 / 超时），供页面层判断是否显示重试按钮 */
export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message === '网络连接失败，请检查网络' || err.message === '请求超时，请稍后再试';
}

export const recommendationApi = {
  getDaily: () => request<DailyRecommendationData>('/recommendation/daily'),
  feedback: (songId: string, feedback: 'like' | 'dislike') =>
    request('/recommendation/feedback', {
      method: 'POST',
      body: JSON.stringify({ songId, feedback }),
    }),
};

/** 情绪 DNA 8 维频段偏好向量 */
export interface EmotionDnaVector {
  subBass: number;
  bass: number;
  lowMid: number;
  mid: number;
  highMid: number;
  presence: number;
  brilliance: number;
  air: number;
}

export interface EmotionDnaInterpretation {
  band: string;
  value: number;
  label: string;
}

export interface EmotionDnaData {
  vector?: EmotionDnaVector;
  eventCount?: number;
  updatedAt?: string | null;
  interpretation?: EmotionDnaInterpretation[];
  insufficient?: boolean;
  insufficientMessage?: string | null;
}

export const emotionDnaApi = {
  get: () => request<EmotionDnaData>('/emotion-dna'),
  recompute: () => request<EmotionDnaData>('/emotion-dna/recompute', { method: 'POST' }),
};

/** 基因图谱星点（每首歌一个） */
export interface GenomeStar {
  songId: string;
  title: string;
  genomeX: number | null;
  genomeY: number | null;
}

/** 基因邻域条目 */
export interface GenomeClusterItem {
  songId: string;
  title: string;
  dist: number;
}

export const genomeApi = {
  map: () => request<{ songs: GenomeStar[] }>('/genome/map'),
  cluster: (id: string) => request<GenomeClusterItem[]>(`/genome/cluster/${id}`),
};

/** 社交 DNA 12 维向量 + 暗号 SVG */
export interface SocialDnaData {
  vector: number[];
  cipherSvg: string;
  eventCount?: number;
  insufficient?: boolean;
  insufficientMessage?: string | null;
  updatedAt?: string | null;
}

/** 互补灵魂匹配条目 */
export interface SocialMatch {
  userId: number;
  complement: number;
}

export const socialDnaApi = {
  get: () => request<SocialDnaData>('/social-dna/me'),
  match: (limit = 10) =>
    request<SocialMatch[]>('/social-dna/match', {
      method: 'POST',
      body: JSON.stringify({ limit }),
    }),
  // 修复 (2026-08-09): 新增 recompute，允许前端手动重算社交DNA
  recompute: () => request<SocialDnaData>('/social-dna/recompute', { method: 'POST' }),
};

// 修复 (2026-08-09): 新增聆听事件上报 API
// 原代码前端从未向后端发送聆听事件，导致用户听歌数据为空，
// 情绪 DNA、社交 DNA 无法计算。现新增 listeningApi 用于批量上报事件。
export interface ListeningEventInput {
  songId?: string;
  trackTitle?: string;
  trackArtist?: string;
  eventType: 'play' | 'complete' | 'skip' | 'favorite';
  positionMs?: number;
  durationMs?: number;
  engagementScore?: number;
  occurredAt?: string;
}

export const listeningApi = {
  /** 批量上报聆听事件（后端会自动从 SongFeature 表补充音频特征） */
  ingest: (events: ListeningEventInput[]) =>
    request<{ accepted: number }>('/listening/events', {
      method: 'POST',
      body: JSON.stringify({ events }),
    }),
};

/** 用户信息 */
export interface UserInfo {
  id: number;
  username: string;
  email?: string;
  role: string;
  status?: string;
  createdAt?: string;
  lastLoginAt?: string;
  securityQuestion?: string;
}

/** 认证 API */
export const authApi = {
  /** 注册（自动激活，返回 token + user） */
  register: (data: { username: string; email: string; password: string; securityQuestion: string; securityAnswer: string }) =>
    requestPublic<{ token: string; user: UserInfo }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  /** 登录 */
  login: (username: string, password: string) =>
    requestPublic<{ token: string; user: UserInfo }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  /** 获取当前用户 */
  getMe: () => request<UserInfo>('/auth/me'),
  /** 访客登录 */
  guest: () =>
    requestPublic<{ token: string; user: UserInfo }>('/auth/guest', {
      method: 'POST',
    }),
  /** 修改密码 */
  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    }),
  /** 更新个人资料 */
  updateProfile: (data: { email?: string; securityQuestion?: string; securityAnswer?: string }) =>
    request<UserInfo>('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  /** 请求密码重置（验证安全答案） */
  requestPasswordReset: (username: string, securityAnswer: string) =>
    requestPublic<{ resetToken: string }>('/auth/password-reset-request', {
      method: 'POST',
      body: JSON.stringify({ username, securityAnswer }),
    }),
  /** 重置密码 */
  resetPassword: (resetToken: string, newPassword: string) =>
    requestPublic<{ message: string }>('/auth/password-reset', {
      method: 'POST',
      body: JSON.stringify({ resetToken, newPassword }),
    }),
  /** 退出登录 */
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
  },
  /** 获取当前 token */
  getToken: () => localStorage.getItem(TOKEN_KEY),
  /** 判断是否已登录 */
  isLoggedIn: () => !!localStorage.getItem(TOKEN_KEY),
};

// === 评论 API ===

export interface CommentData {
  id: string;
  userId: number;
  songId: string;
  commentType: 'song' | 'lyric';
  timestampSec: number | null;
  content: string;
  likeCount: number;
  reportCount: number;
  status: string;
  createdAt: string;
  user: { id: number; username: string };
}

export interface CommentListResult {
  comments: CommentData[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LyricCommentsResult {
  comments: CommentData[];
  grouped: Record<string, CommentData[]>;
}

export const commentsApi = {
  getSongComments: (songId: string, sort = 'hot', page = 1, pageSize = 20) =>
    request<CommentListResult>(`/comments/song/${songId}?sort=${sort}&page=${page}&pageSize=${pageSize}`),

  getLyricComments: (songId: string) =>
    request<LyricCommentsResult>(`/comments/lyric/${songId}`),

  create: (songId: string, commentType: 'song' | 'lyric', content: string, timestampSec?: number) =>
    request<CommentData>('/comments', {
      method: 'POST',
      body: JSON.stringify({ songId, commentType, content, timestampSec }),
    }),

  delete: (id: string) =>
    request<void>(`/comments/${id}`, { method: 'DELETE' }),

  toggleLike: (id: string) =>
    request<{ liked: boolean }>(`/comments/${id}/like`, { method: 'POST' }),

  isLiked: (id: string) =>
    request<{ liked: boolean }>(`/comments/${id}/liked`),

  report: (id: string, reason: string) =>
    request<void>(`/comments/${id}/report`, { method: 'POST', body: JSON.stringify({ reason }) }),
};

// === AI 电台 API ===

export interface RadioMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  songs?: any[];
  createdAt: string;
}

export interface RadioSession {
  id: string;
  userId: number;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messages?: RadioMessage[];
}

/** LLM API 提供商选项 */
export interface LlmProviderOption {
  value: string;
  label: string;
  defaultModel: string;
  defaultBaseUrl: string;
  needsKey: boolean;
}

/** LLM API 配置（脱敏） */
export interface LlmConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyMasked: string;
  temperature: number;
  timeout: number;
  configured: boolean;
  providers: LlmProviderOption[];
}

export const radioAPI = {
  /** 检查 LLM 配置状态 */
  status: () =>
    request<{ configured: boolean }>('/radio/status'),

  /** 获取 LLM API 配置（脱敏） */
  getLlmConfig: () =>
    request<LlmConfig>('/radio/llm-config'),

  /** 保存 LLM API 配置 */
  saveLlmConfig: (config: {
    provider: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    temperature?: number;
    timeout?: number;
  }) =>
    request<LlmConfig>('/radio/llm-config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  /** 创建新会话 */
  createSession: () =>
    request<RadioSession>('/radio/sessions', { method: 'POST' }),

  /** 获取会话列表 */
  getSessions: () =>
    request<RadioSession[]>('/radio/sessions'),

  /** 获取会话消息 */
  getMessages: (sessionId: string) =>
    request<RadioMessage[]>(`/radio/sessions/${sessionId}/messages`),

  /** 发送消息（LLM推理需要更长时间） */
  sendMessage: (sessionId: string, content: string) =>
    request<{ message: RadioMessage; songs: any[] }>(`/radio/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }, AI_REQUEST_TIMEOUT),

  /** 一键电台（LLM推理需要更长时间） */
  quickRecommend: () =>
    request<{ sessionId: string; message: RadioMessage; songs: any[] }>('/radio/quick', {
      method: 'POST',
    }, AI_REQUEST_TIMEOUT),

  /** 删除会话 */
  deleteSession: (sessionId: string) =>
    request<void>(`/radio/sessions/${sessionId}`, { method: 'DELETE' }),

  /** 预热：后台开始预生成歌单（登录后调用，不阻塞） */
  streamWarmup: () =>
    request<{ queued: boolean }>('/radio/stream/warmup', { method: 'POST' }),

  /** 启动全自动电台（返回已就绪的 LLM 歌单，冷启动放宽超时） */
  streamStart: () =>
    request<{ sessionId: string; songs: RecommendedSong[] }>('/radio/stream/start', {
      method: 'POST',
    }, AI_REQUEST_TIMEOUT),

  /** 获取下一批歌单（无限连播预取） */
  streamNext: (sessionId: string) =>
    request<{ songs: RecommendedSong[] }>(`/radio/stream/${sessionId}/next`),

  /** 换一批（手动刷新） */
  streamRefresh: (sessionId: string) =>
    request<{ songs: RecommendedSong[] }>(`/radio/stream/${sessionId}/refresh`, {
      method: 'POST',
    }),

  /** 播放反馈（跳过/完成） */
  streamFeedback: (sessionId: string, songId: string) =>
    request<void>(`/radio/stream/${sessionId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ songId }),
    }),

  /** 获取电台探索比例（0~1，个性化 vs 探索） */
  getExplorationRatio: () =>
    request<{ explorationRatio: number }>('/radio/exploration-ratio'),

  /** 保存电台探索比例（运行时生效，无需重启） */
  saveExplorationRatio: (explorationRatio: number) =>
    request<{ explorationRatio: number }>('/radio/exploration-ratio', {
      method: 'PUT',
      body: JSON.stringify({ explorationRatio }),
    }),
};

/** 手动添加歌曲返回的歌曲数据 */
export interface AddManualSongResult {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
  playable?: boolean;
}

/** 曲库单曲查询（含歌词字段，用于歌词按需补取） */
export const songsApi = {
  getById: (id: string) =>
    request<{ id: string; title?: string; lyricContent?: string | null }>(`/songs/${encodeURIComponent(id)}`),
};

/** 歌曲管理（手动添加 + 批量操作） */
export const songsAdminApi = {
  /** 手动添加歌曲：自动搜（省略 audioUrl）或手动指定 URL（自动搜索需调用 Python 爬虫，延长超时到 60s） */
  addManualSong: (payload: { title: string; artist?: string; audioUrl?: string }) =>
    request<AddManualSongResult>('/songs/add', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, 60_000),
  /** 手动触发热榜爬取（同步等待，返回新增数量） */
  refreshHot100: () =>
    request<{ message: string; count?: number; addedCount?: number }>('/songs/refresh-hot100', {
      method: 'POST',
    }, 300_000),
  /** 批量刷新失效 URL（复用 url-manager 已有接口） */
  refreshBatchUrls: () =>
    request<{ result: unknown }>('/url-manager/refresh-batch', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
