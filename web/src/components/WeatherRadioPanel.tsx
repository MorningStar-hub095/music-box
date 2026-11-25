// web/src/components/WeatherRadioPanel.tsx
// 天气智能电台面板 — 输入城市 → 后端代理 Open-Meteo → 天气匹配情绪 → 曲库生成队列

import React, { useState, useCallback, useEffect } from 'react';
import { XIcon } from './Icons';
import './WeatherRadioPanel.css';

import { API_BASE } from '../services/api';
const CITY_STORAGE_KEY = 'mb_weather_city';

export interface WeatherRadioTrack {
  id: string;
  title: string;
  artist: string;
  album?: string | null;
  albumCover?: string | null;
}

interface WeatherData {
  city: string;
  temperature: number;
  description: string;
  isDay: boolean;
  moodTags: string[];
}

interface WeatherRadioPanelProps {
  visible: boolean;
  onClose: () => void;
  /** 点击「开始播放」：把天气队列交给播放器 */
  onPlayQueue: (tracks: WeatherRadioTrack[], weather: WeatherData) => void;
}

type PanelState = 'idle' | 'loading' | 'done' | 'error';

export const WeatherRadioPanel: React.FC<WeatherRadioPanelProps> = ({ visible, onClose, onPlayQueue }) => {
  const [city, setCity] = useState(() => localStorage.getItem(CITY_STORAGE_KEY) || '');
  const [state, setState] = useState<PanelState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [playlist, setPlaylist] = useState<WeatherRadioTrack[]>([]);

  // ESC 关闭
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  const fetchWeatherRadio = useCallback(async (cityName: string) => {
    const name = cityName.trim();
    if (!name) { setState('error'); setErrorMsg('请先输入城市名（如：北京 / Shanghai）'); return; }
    setState('loading');
    setErrorMsg('');
    try {
      const resp = await fetch(`${API_BASE}/weather/current?city=${encodeURIComponent(name)}&limit=30`);
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        setState('error');
        setErrorMsg(json.error || '天气服务暂时不可用，请稍后重试');
        return;
      }
      localStorage.setItem(CITY_STORAGE_KEY, name);
      setWeather(json.data.weather);
      setPlaylist(json.data.playlist);
      setState('done');
    } catch {
      setState('error');
      setErrorMsg('网络错误：无法连接天气服务');
    }
  }, []);

  const handlePlay = useCallback(() => {
    if (weather && playlist.length > 0) onPlayQueue(playlist, weather);
  }, [weather, playlist, onPlayQueue]);

  if (!visible) return null;

  return (
    <div className="weather-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="weather-panel">
        <div className="weather-header">
          <span>🌤️ 天气电台</span>
          <button className="weather-close" onClick={onClose} title="关闭 (ESC)"><XIcon size={14} /></button>
        </div>

        <div className="weather-city-row">
          <input
            className="weather-city-input"
            placeholder="输入城市名，如：北京 / 上海 / Tokyo"
            value={city}
            maxLength={60}
            onChange={e => setCity(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') fetchWeatherRadio(city); }}
          />
          <button
            className="weather-fetch-btn"
            onClick={() => fetchWeatherRadio(city)}
            disabled={state === 'loading'}
          >
            {state === 'loading' ? '查询中…' : '查询'}
          </button>
        </div>

        {state === 'error' && <div className="weather-error">{errorMsg}</div>}

        {state === 'done' && weather && (
          <>
            <div className="weather-now">
              <div className="weather-now-main">
                <span className="weather-desc">{weather.description}</span>
                <span className="weather-temp">{weather.temperature}°C</span>
              </div>
              <div className="weather-now-sub">
                {weather.city} · 当前匹配氛围：<b>{weather.moodTags.join(' / ')}</b>
              </div>
            </div>

            <div className="weather-playlist">
              {playlist.slice(0, 8).map((s, i) => (
                <div key={s.id} className="weather-song">
                  <span className="weather-song-idx">{i + 1}</span>
                  <span className="weather-song-title" title={s.title}>{s.title}</span>
                  <span className="weather-song-artist" title={s.artist}>{s.artist}</span>
                </div>
              ))}
              {playlist.length > 8 && (
                <div className="weather-song-more">…等 {playlist.length} 首</div>
              )}
            </div>

            <button className="weather-play-btn" onClick={handlePlay} disabled={playlist.length === 0}>
              ▶ 开始播放天气电台
            </button>
          </>
        )}

        {state === 'idle' && (
          <div className="weather-idle-hint">
            根据城市实时天气自动匹配曲风：<br />
            雨天 → 舒缓平静 · 晴天 → 欢快明朗 · 雪天 → 浪漫温柔
          </div>
        )}
      </div>
    </div>
  );
};
