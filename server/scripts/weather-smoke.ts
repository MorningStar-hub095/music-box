// server/scripts/weather-smoke.ts — 天气电台冒烟测试（临时）
import { PrismaClient } from '@prisma/client';
import { WeatherService } from '../src/modules/weather/weather.service';

(async () => {
  const s = new WeatherService(new PrismaClient());
  const r = await s.getWeatherRadio('北京', 5);
  console.log('weather:', r.weather.description, `${r.weather.temperature}°C`, 'moods:', r.weather.moodTags.join('/'));
  console.log('songs:', r.playlist.map(x => `${x.title}-${x.artist}`).join(' | '));
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message?.slice(0, 300)); process.exit(1); });
