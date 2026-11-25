// server/src/modules/weather/weather.service.ts
// 天气智能电台 — Open-Meteo 免费无 Key API，城市名手动输入，内存缓存
// 天气码 → 情绪标签 → 从曲库筛选可播放歌曲生成播放队列

import { PrismaClient } from '@prisma/client';

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HTTP_TIMEOUT_MS = 8000;
const GEO_CACHE_TTL = 24 * 60 * 60 * 1000; // 城市坐标 24h
const WEATHER_CACHE_TTL = 30 * 60 * 1000;  // 天气 30min
const PLAYLIST_CACHE_TTL = 10 * 60 * 1000; // 天气歌单 10min

interface GeoResult { name: string; country: string; latitude: number; longitude: number; }
interface WeatherInfo {
  city: string;
  temperature: number;
  weatherCode: number;
  description: string;
  isDay: boolean;
  moodTags: string[];
  latitude: number;
  longitude: number;
}

interface CacheEntry<T> { value: T; expiresAt: number; }

// WMO 天气码 → 描述 + 情绪标签（标签必须与曲库 moods 表对齐：
// 欢快/悲伤/励志/浪漫/平静/激昂/怀旧/神秘）
const WMO_MAP: Array<{ codes: number[]; desc: string; moods: string[] }> = [
  { codes: [0], desc: '晴朗', moods: ['欢快', '励志'] },
  { codes: [1], desc: '大致晴朗', moods: ['欢快', '平静'] },
  { codes: [2], desc: '局部多云', moods: ['平静', '欢快'] },
  { codes: [3], desc: '阴天', moods: ['平静', '怀旧'] },
  { codes: [45, 48], desc: '有雾', moods: ['神秘', '平静'] },
  { codes: [51, 53, 55], desc: '毛毛雨', moods: ['平静', '浪漫'] },
  { codes: [56, 57], desc: '冻毛毛雨', moods: ['平静', '悲伤'] },
  { codes: [61], desc: '小雨', moods: ['平静', '浪漫'] },
  { codes: [63], desc: '中雨', moods: ['平静', '怀旧'] },
  { codes: [65], desc: '大雨', moods: ['悲伤', '平静'] },
  { codes: [66, 67], desc: '冻雨', moods: ['悲伤', '平静'] },
  { codes: [71], desc: '小雪', moods: ['浪漫', '平静'] },
  { codes: [73, 75], desc: '降雪', moods: ['浪漫', '平静'] },
  { codes: [77], desc: '雪粒', moods: ['平静', '浪漫'] },
  { codes: [80, 81], desc: '阵雨', moods: ['欢快', '平静'] },
  { codes: [82], desc: '强阵雨', moods: ['激昂', '欢快'] },
  { codes: [85, 86], desc: '阵雪', moods: ['浪漫', '欢快'] },
  { codes: [95], desc: '雷暴', moods: ['激昂', '神秘'] },
  { codes: [96, 99], desc: '雷暴伴冰雹', moods: ['激昂', '神秘'] },
];

function describeCode(code: number): { desc: string; moods: string[] } {
  for (const m of WMO_MAP) {
    if (m.codes.includes(code)) return { desc: m.desc, moods: m.moods };
  }
  return { desc: '未知天气', moods: ['平静'] };
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export class WeatherService {
  private geoCache = new Map<string, CacheEntry<GeoResult>>();
  private weatherCache = new Map<string, CacheEntry<WeatherInfo>>();
  private playlistCache = new Map<string, CacheEntry<unknown>>();

  constructor(private prisma: PrismaClient) {}

  /** 城市名 → 坐标（带 24h 缓存） */
  private async geocode(city: string): Promise<GeoResult> {
    const key = city.trim().toLowerCase();
    const cached = this.geoCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const url = `${GEOCODING_URL}?name=${encodeURIComponent(city.trim())}&count=1&language=zh&format=json`;
    const data = await fetchJson<{ results?: Array<{ name: string; country: string; latitude: number; longitude: number }> }>(url);
    const r = data.results?.[0];
    if (!r) throw new Error(`未找到城市「${city}」，请检查城市名（支持中文/拼音）`);
    const result: GeoResult = { name: r.name, country: r.country || '', latitude: r.latitude, longitude: r.longitude };
    this.geoCache.set(key, { value: result, expiresAt: Date.now() + GEO_CACHE_TTL });
    return result;
  }

  /** 坐标 → 当前天气（带 30min 缓存） */
  private async fetchWeather(geo: GeoResult): Promise<WeatherInfo> {
    const key = `${geo.latitude.toFixed(2)},${geo.longitude.toFixed(2)}`;
    const cached = this.weatherCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const url = `${FORECAST_URL}?latitude=${geo.latitude}&longitude=${geo.longitude}` +
      `&current_weather=true&timezone=auto`;
    const data = await fetchJson<{ current_weather?: { temperature: number; weathercode: number; is_day: number } }>(url);
    const cw = data.current_weather;
    if (!cw) throw new Error('天气服务返回异常，请稍后重试');

    const { desc, moods } = describeCode(cw.weathercode);
    const isDay = cw.is_day === 1;
    // 晴朗夜晚切换为浪漫氛围
    const moodTags = !isDay && (cw.weathercode === 0 || cw.weathercode === 1) ? ['浪漫', '平静'] : moods;

    const info: WeatherInfo = {
      city: geo.name,
      temperature: Math.round(cw.temperature),
      weatherCode: cw.weathercode,
      description: desc,
      isDay,
      moodTags,
      latitude: geo.latitude,
      longitude: geo.longitude,
    };
    this.weatherCache.set(key, { value: info, expiresAt: Date.now() + WEATHER_CACHE_TTL });
    return info;
  }

  /** 情绪标签 → 可播放歌曲队列（带 10min 缓存；不足 10 首用热门歌补充） */
  async buildPlaylist(moodTags: string[], limit = 30): Promise<Array<{ id: string; title: string; artist: string; album: string | null; albumCover: string | null }>> {
    const key = moodTags.join('+') + `#${limit}`;
    const cached = this.playlistCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value as Awaited<ReturnType<WeatherService['buildPlaylist']>>;

    // 命中情绪标签的可播放歌曲，按热度取 2 倍候选再洗牌，保证每次刷新有新鲜感
    let songs = await this.prisma.song.findMany({
      where: {
        playable: true,
        archived: false,
        moods: { some: { mood: { name: { in: moodTags } } } },
      },
      orderBy: { hotScore: 'desc' },
      take: limit * 2,
      select: { id: true, title: true, artist: true, album: true, albumCover: true, hotScore: true },
    });

    // 情绪标签覆盖不足 → 补充热门可播歌曲
    if (songs.length < 10) {
      const extra = await this.prisma.song.findMany({
        where: { playable: true, archived: false },
        orderBy: { hotScore: 'desc' },
        take: limit * 2,
        select: { id: true, title: true, artist: true, album: true, albumCover: true, hotScore: true },
      });
      const seen = new Set(songs.map(s => s.id));
      songs = [...songs, ...extra.filter(s => !seen.has(s.id))];
    }

    // 洗牌后截取
    for (let i = songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [songs[i], songs[j]] = [songs[j], songs[i]];
    }
    const result = songs.slice(0, limit).map(s => ({
      id: s.id, title: s.title, artist: s.artist, album: s.album, albumCover: s.albumCover,
    }));
    this.playlistCache.set(key, { value: result, expiresAt: Date.now() + PLAYLIST_CACHE_TTL });
    return result;
  }

  /** 完整查询：城市 → 天气 + 推荐队列 */
  async getWeatherRadio(city: string, limit = 30) {
    const geo = await this.geocode(city);
    const weather = await this.fetchWeather(geo);
    const playlist = await this.buildPlaylist(weather.moodTags, limit);
    return { weather, playlist };
  }
}
