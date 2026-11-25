// server/src/modules/weather/weather.routes.ts
// 天气电台路由：GET /current?city=北京&limit=30

import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { WeatherService } from './weather.service';

export function createWeatherRoutes(prisma: PrismaClient) {
  const router = Router();
  const service = new WeatherService(prisma);

  router.get('/current', async (req, res: Response) => {
    const city = String(req.query.city || '').trim();
    if (!city) {
      res.status(400).json({ success: false, error: '缺少 city 参数' });
      return;
    }
    if (city.length > 60) {
      res.status(400).json({ success: false, error: '城市名过长' });
      return;
    }
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 5), 50) : 30;
    try {
      const { weather, playlist } = await service.getWeatherRadio(city, limit);
      res.json({ success: true, data: { weather, playlist } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '天气服务暂时不可用';
      // Open-Meteo 不可达 / 城市不存在 → 502/404 语义统一为 502，前端展示 msg
      res.status(502).json({ success: false, error: msg });
    }
  });

  return router;
}
