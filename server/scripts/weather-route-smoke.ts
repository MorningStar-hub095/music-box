// server/scripts/weather-route-smoke.ts — 天气路由 HTTP 冒烟（临时）
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { createWeatherRoutes } from '../src/modules/weather/weather.routes';

(async () => {
  const app = express();
  app.use('/api/weather', createWeatherRoutes(new PrismaClient()));
  const server = app.listen(49231);
  // 正常请求
  let resp = await fetch('http://localhost:49231/api/weather/current?city=上海&limit=3');
  let json = await resp.json();
  console.log('[normal]', resp.status, json.success, json.data?.weather?.description, 'songs:', json.data?.playlist?.length);
  // 缺参
  resp = await fetch('http://localhost:49231/api/weather/current');
  json = await resp.json();
  console.log('[no-city]', resp.status, json.error);
  // 无效城市
  resp = await fetch('http://localhost:49231/api/weather/current?city=xxnotacityzz');
  json = await resp.json();
  console.log('[bad-city]', resp.status, json.error?.slice(0, 40));
  server.close();
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message?.slice(0, 200)); process.exit(1); });
