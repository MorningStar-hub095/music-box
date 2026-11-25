import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
});

// ============ 类型定义 ============
export interface Genre {
  id: number;
  name: string;
  parentId: number | null;
  level: number;
  sortOrder: number;
  children?: Genre[];
}

export interface Language {
  id: number;
  name: string;
  code: string;
}

export interface Scene {
  id: number;
  name: string;
  icon?: string;
}

export interface Mood {
  id: number;
  name: string;
  icon?: string;
}

export interface Decade {
  id: number;
  name: string;
  startYear?: number;
  endYear?: number;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumCover?: string;
  audioUrl: string;
  audioUrlMp3?: string;
  coverColor?: string;
  platform?: string;
  playable: boolean;
  genres: { genre: Genre }[];
  languages: { language: Language }[];
  scenes: { scene: Scene }[];
  moods: { mood: Mood }[];
  decades: { decade: Decade }[];
  tags: { tag: { id: number; name: string } }[];
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface SongsResponse {
  songs: Song[];
  pagination: Pagination;
}

export interface SongFilters {
  genres?: string;
  languages?: string;
  scenes?: string;
  moods?: string;
  decades?: string;
  search?: string;
  sort?: string;
  order?: string;
  page?: number;
  limit?: number;
}

// ============ API 调用 ============
export async function fetchSongs(filters: SongFilters = {}): Promise<SongsResponse> {
  const { data: res } = await api.get('/songs', { params: filters });
  return res.data;
}

export async function fetchGenres(): Promise<Genre[]> {
  const { data: res } = await api.get('/genres');
  return res.data;
}

export async function fetchLanguages(): Promise<Language[]> {
  const { data: res } = await api.get('/languages');
  return res.data;
}

export async function fetchScenes(): Promise<Scene[]> {
  const { data: res } = await api.get('/scenes');
  return res.data;
}

export async function fetchMoods(): Promise<Mood[]> {
  const { data: res } = await api.get('/moods');
  return res.data;
}

export async function fetchDecades(): Promise<Decade[]> {
  const { data: res } = await api.get('/decades');
  return res.data;
}

export default api;
