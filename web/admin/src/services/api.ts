import axios from 'axios';

const API_PORT = import.meta.env.VITE_API_PORT || '49200';

/**
 * 解析 API 基础地址：
 * - 显式配置 VITE_API_BASE 时优先使用
 * - 生产构建（同源托管 / nginx 反代 / Electron 打包版）：使用相对路径 /api，
 *   避免后端端口动态漂移时前端仍指向写死的 49200
 * - 开发模式：Vite 端口与 API 端口不同，回退到 http://localhost:PORT/api
 */
function resolveApiBase(): string {
  const envBase = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
  if (envBase) return envBase.replace(/\/+$/, '');
  const loc = typeof window !== 'undefined' ? window.location : null;
  if (!import.meta.env.DEV && loc && (loc.protocol === 'https:' || loc.protocol === 'http:')) {
    return '/api';
  }
  return `http://localhost:${API_PORT}/api`;
}

const api = axios.create({
  baseURL: resolveApiBase(),
  timeout: 10000,
});

// 请求拦截器：自动添加JWT token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器：处理401错误
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('admin_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ============ Auth API ============
export const authApi = {
  login: (data: { username: string; password: string }) =>
    api.post('/auth/login', data),
  register: (data: { username: string; password: string; email?: string }) =>
    api.post('/auth/register', data),
  getMe: () => api.get('/auth/me'),
  getPendingUsers: () => api.get('/auth/pending-users'),
  approveUser: (id: number) => api.post(`/auth/approve/${id}`),
};

// ============ Songs API ============
export const songsApi = {
  getSongs: (params?: Record<string, string | number>) =>
    api.get('/songs', { params }),
  getSong: (id: number) => api.get(`/songs/${id}`),
  getSongDetail: (id: string) => api.get(`/songs/${id}`),
  getUrlStatus: (id: string) => api.get(`/songs/${id}/url-status`),
  refreshUrl: (id: string) => api.post(`/songs/${id}/refresh-url`),
  createSong: (data: Record<string, unknown>) => api.post('/songs', data),
  updateSong: (id: number, data: Record<string, unknown>) =>
    api.put(`/songs/${id}`, data),
  deleteSong: (id: number) => api.delete(`/songs/${id}`),
  batchUpdate: (data: { ids: number[]; updates: Record<string, unknown> }) =>
    api.post('/songs/batch-update', data),
  batchDelete: (data: { ids: number[] }) =>
    api.post('/songs/batch-delete', data),
};

// ============ Genres API ============
export const genresApi = {
  getGenres: () => api.get('/genres'),
  createGenre: (data: { name: string; parentId?: number }) =>
    api.post('/genres', data),
  updateGenre: (id: number, data: { name: string }) =>
    api.put(`/genres/${id}`, data),
  deleteGenre: (id: number) => api.delete(`/genres/${id}`),
};

// ============ Languages API ============
export const languagesApi = {
  getLanguages: () => api.get('/languages'),
};

// ============ Scenes API ============
export const scenesApi = {
  getScenes: () => api.get('/scenes'),
};

// ============ Moods API ============
export const moodsApi = {
  getMoods: () => api.get('/moods'),
};

// ============ Decades API ============
export const decadesApi = {
  getDecades: () => api.get('/decades'),
};

// ============ Tags API ============
export const tagsApi = {
  getTags: () => api.get('/tags'),
};

// ============ Stats API ============
export const statsApi = {
  getOverview: () => api.get('/stats/overview'),
};

// ============ Users API ============
export const usersApi = {
  getUsers: () => api.get('/users'),
  getUser: (id: number) => api.get(`/users/${id}`),
  updateUser: (id: number, data: Record<string, unknown>) =>
    api.put(`/users/${id}`, data),
  deleteUser: (id: number) => api.delete(`/users/${id}`),
};

// ============ Playlists API ============
export const playlistsApi = {
  getPlaylists: () => api.get('/playlists'),
  getPlaylist: (id: number) => api.get(`/playlists/${id}`),
  createPlaylist: (data: { name: string }) => api.post('/playlists', data),
  updatePlaylist: (id: number, data: { name: string }) =>
    api.put(`/playlists/${id}`, data),
  deletePlaylist: (id: number) => api.delete(`/playlists/${id}`),
};

// ============ Audit API ============
export const auditApi = {
  getHistory: (targetType: string, targetId: string) =>
    api.get(`/audit/history/${targetType}/${targetId}`),
};

// ============ Crawler API ============
export const crawlerApi = {
  // 爬虫管理
  crawl: (data: {
    platform: string;
    keyword?: string;
    targetCount?: number;
    batchSize?: number;
    taskType?: 'search' | 'hot100';
  }) => api.post('/crawler/crawl', data),
  getStats: () => api.get('/crawler/stats'),
  getLogs: (params?: Record<string, string | number>) =>
    api.get('/crawler/logs', { params }),
  getStrategy: () => api.get('/crawler/strategy'),
  executeScheduled: () => api.post('/crawler/scheduled'),
  
  // 归档管理
  archiveSong: (songId: string, reason?: string) =>
    api.post(`/crawler/archive/${songId}`, { reason }),
  archiveBatch: (songIds: string[], reason?: string) =>
    api.post('/crawler/archive-batch', { songIds, reason }),
  autoArchive: (criteria: Record<string, unknown>, reason?: string) =>
    api.post('/crawler/auto-archive', { criteria, reason }),
  restoreSong: (songId: string) =>
    api.post(`/crawler/restore/${songId}`),
  getArchived: (params?: Record<string, string | number>) =>
    api.get('/crawler/archived', { params }),
  getArchiveStats: () => api.get('/crawler/archive-stats'),
};

// ============ Content API ============
export const contentApi = {
  getStats: () => api.get('/content/stats'),
  getPlaylist: (params?: Record<string, string | number>) =>
    api.get('/content/playlist', { params }),
  updateHotScores: () => api.post('/content/update-hot-scores'),
  getSuggestions: () => api.get('/content/suggestions'),
};

// adminApi 作为通用的管理API（向后兼容）
export const adminApi = api;

export default api;
