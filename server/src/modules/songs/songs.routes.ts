import { Router } from 'express';
import { SongsController } from './songs.controller';
import { authenticate, authorize } from '../../middleware/auth';
import { userRateLimit } from '../../middleware/userRateLimit';
import { validate } from '../../middleware/validate';
import { createSongSchema, updateSongSchema, songFiltersSchema } from '../../validators/song.validator';
import { idParamSchema, batchIdsSchema } from '../../validators/common.validator';

const router = Router();
const songsController = new SongsController();

// 获取歌曲列表（带验证）
router.get('/', validate(songFiltersSchema, 'query'), (req, res) => songsController.getSongs(req, res));

// 创建歌曲（需要认证和验证）
router.post(
  '/',
  authenticate,
  authorize('super_admin', 'admin'),
  validate(createSongSchema),
  (req, res) => songsController.createSong(req, res)
);

// 批量更新
router.post(
  '/batch-update',
  authenticate,
  authorize('super_admin', 'admin', 'editor'),
  validate(batchIdsSchema),
  (req, res) => songsController.batchUpdateSongs(req, res)
);

// 批量删除
router.post(
  '/batch-delete',
  authenticate,
  authorize('super_admin', 'admin'),
  validate(batchIdsSchema),
  (req, res) => songsController.batchDeleteSongs(req, res)
);

// 手动添加歌曲（自动搜或手动 URL；每用户每分钟最多 5 次——每次调用会触发 Python 搜曲子进程）
router.post('/add', authenticate, userRateLimit(5, 60_000), (req, res) => songsController.addManualSong(req, res));

// 手动触发热榜爬取（异步；全局爬取任务仅 editor 及以上可触发）
router.post('/refresh-hot100', authenticate, authorize('super_admin', 'admin', 'editor'), (req, res) => songsController.refreshHot100(req, res));

// 公开接口：前端播放失败时刷新音频 URL（无需认证）
router.get('/refresh-track', (req, res) => songsController.refreshTrack(req, res));

// 获取单首歌曲
router.get('/:id', validate(idParamSchema, 'params'), (req, res) => songsController.getSongById(req, res));

// 获取URL状态
router.get('/:id/url-status', validate(idParamSchema, 'params'), (req, res) => songsController.checkUrlStatus(req, res));

// 更新歌曲
router.put(
  '/:id',
  authenticate,
  authorize('super_admin', 'admin', 'editor'),
  validate(idParamSchema, 'params'),
  validate(updateSongSchema),
  (req, res) => songsController.updateSong(req, res)
);

// 删除歌曲
router.delete(
  '/:id',
  authenticate,
  authorize('super_admin', 'admin'),
  validate(idParamSchema, 'params'),
  (req, res) => songsController.deleteSong(req, res)
);

// 刷新URL
router.post(
  '/:id/refresh-url',
  authenticate,
  authorize('super_admin', 'admin'),
  validate(idParamSchema, 'params'),
  (req, res) => songsController.refreshUrl(req, res)
);

export default router;
