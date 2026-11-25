import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../src/index';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 7, username: 'genome_test', role: 'user', status: 'active' };
    next();
  },
  authorize: (..._r: string[]) => (_q: any, _s: any, next: any) => next(),
}));

const db = new PrismaClient();
const UID = 7;

beforeAll(async () => {
  await db.user.upsert({ where: { id: UID }, update: {}, create: { id: UID, username: 'genome_test', email: 'g@e.com', passwordHash: 'x' } });
  // 仅清理本测试的种子数据（无条件 deleteMany 会清空全库 song_features——2026-11-18 事故根因）
  await db.songFeature.deleteMany({ where: { song: { filePath: { startsWith: 'D:/genome_test/' } } } });
  await db.song.deleteMany({ where: { filePath: { startsWith: 'D:/genome_test/' } } });
  for (const [i, f] of [[0.9,0.1,0.1,0.1,0.1,0.1,0.1,0.1],[0.1,0.9,0.1,0.1,0.1,0.1,0.1,0.1],[0.1,0.1,0.9,0.1,0.1,0.1,0.1,0.1]].entries()) {
    const song = await db.song.create({
      data: {
        id: `genome_test_s${i}`,
        title: `s${i}`,
        artist: '',
        audioUrl: '',
        filePath: `D:/genome_test/s${i}.mp3`,
        dataSource: 'manual',
      },
    });
    await db.songFeature.create({
      data: {
        songId: song.id,
        subBass: f[0], bass: f[1], lowMid: f[2], mid: f[3],
        highMid: f[4], presence: f[5], brilliance: f[6], air: f[7],
        bpm: 120, energy: 0.5,
      },
    });
  }
});
afterAll(async () => {
  // 仅清理本测试的种子特征（同上，禁止无条件全表删除）
  await db.songFeature.deleteMany({ where: { song: { filePath: { startsWith: 'D:/genome_test/' } } } });
  await db.song.deleteMany({ where: { filePath: { startsWith: 'D:/genome_test/' } } });
  await db.user.deleteMany({ where: { id: UID } }).catch(()=>{});
  await db.$disconnect();
});

describe('Genome', () => {
  it('GET /api/genome/map returns songs with genome coords after PCA', async () => {
    // PCA 移出请求路径后，需显式触发重算端点（scheduler 每日也会触发）
    await request(app).post('/api/genome/recompute');
    const res = await request(app).get('/api/genome/map');
    expect(res.status).toBe(200);
    const songs = res.body.data.songs;
    expect(songs.length).toBeGreaterThanOrEqual(3);
    expect(songs[0].genomeX).not.toBeNull();
    expect(songs[0].genomeY).not.toBeNull();
  });
  it('GET /api/genome/cluster/:id returns neighbors', async () => {
    const map = (await request(app).get('/api/genome/map')).body.data.songs;
    const id = map[0].songId;
    const res = await request(app).get(`/api/genome/cluster/${id}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
