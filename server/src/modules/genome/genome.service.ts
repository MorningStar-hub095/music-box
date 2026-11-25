import prisma from '../../lib/prisma';
import { cache } from '../../lib/redis';

const DIM = 8;
const GENOME_MAP_CACHE_KEY = 'genome:map';
const GENOME_MAP_CACHE_TTL = 300; // 5 分钟

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalize(v: number[]): void {
  const m = Math.sqrt(dot(v, v)) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= m;
}

function matVec(m: number[][], v: number[], dim: number): number[] {
  const o = Array(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) o[i] += m[i][j] * v[j];
  }
  return o;
}

function powerIter(cov: number[][], dim: number): number[] {
  let v = Array(dim).fill(0).map(() => Math.random());
  normalize(v);
  for (let it = 0; it < 50; it++) {
    const nv = matVec(cov, v, dim);
    normalize(nv);
    v = nv;
  }
  return v;
}

function deflate(cov: number[][], ev: number[], dim: number): number[][] {
  const mv = matVec(cov, ev, dim);
  const lambda = dot(mv, ev);
  const out = cov.map((r) => r.slice());
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) out[i][j] -= lambda * ev[i] * ev[j];
  }
  return out;
}

/** 用 power iteration 求前两个主成分，返回每行在 PC1/PC2 上的投影 */
function pca2d(rows: number[][]): { x: number; y: number }[] {
  const n = rows.length;
  if (n === 0) return [];
  const mean = Array(DIM).fill(0);
  rows.forEach((r) => {
    for (let i = 0; i < DIM; i++) mean[i] += r[i] / n;
  });
  const X = rows.map((r) => r.map((v, i) => v - mean[i]));

  const cov = Array.from({ length: DIM }, () => Array(DIM).fill(0));
  for (let i = 0; i < DIM; i++) {
    for (let j = 0; j < DIM; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += X[k][i] * X[k][j];
      cov[i][j] = s / n;
    }
  }

  const ev1 = powerIter(cov, DIM);
  const covDeflated = deflate(cov, ev1, DIM);
  const ev2 = powerIter(covDeflated, DIM);

  return X.map((r) => ({ x: dot(r, ev1), y: dot(r, ev2) }));
}

export class GenomeService {
  /** 计算 genomeX/Y 并持久化；归一化到 [-1, 1]。仅供 scheduler / recompute 端点调用 */
  async computeAndPersistCoords(): Promise<{ computed: number }> {
    const feats = await prisma.songFeature.findMany();
    if (feats.length < 2) return { computed: 0 };

    const rows = feats.map((f) => [
      f.subBass, f.bass, f.lowMid, f.mid, f.highMid, f.presence, f.brilliance, f.air,
    ]);
    const coords = pca2d(rows);

    const xs = coords.map((c) => c.x);
    const ys = coords.map((c) => c.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;

    for (let i = 0; i < feats.length; i++) {
      const gx = ((coords[i].x - xMin) / xRange) * 2 - 1;
      const gy = ((coords[i].y - yMin) / yRange) * 2 - 1;
      await prisma.songFeature.update({
        where: { songId: feats[i].songId },
        data: { genomeX: gx, genomeY: gy },
      });
    }
    // 失效缓存，下次 getMap 拉新数据
    await cache.del(GENOME_MAP_CACHE_KEY);
    return { computed: feats.length };
  }

  /**
   * 返回基因图谱：不触发 PCA。
   * 优先读 Redis 缓存；未命中读 DB（genomeX 非 null 的 songs），写缓存。
   * 若 DB 无坐标（首次未跑 PCA），返回空 songs + pending:true，不阻塞。
   */
  async getMap(_userId: number) {
    const cached = await cache.get<any>(GENOME_MAP_CACHE_KEY);
    if (cached) return cached;

    const songs = await prisma.song.findMany({
      where: { features: { genomeX: { not: null } } },
      include: { features: true },
    });

    if (songs.length === 0) {
      // DB 无坐标（首次），不阻塞，返回 pending
      const empty = { songs: [], pending: true };
      return empty;
    }

    const payload = {
      songs: songs.map((s) => ({
        songId: s.id,
        title: s.title,
        genomeX: s.features!.genomeX,
        genomeY: s.features!.genomeY,
        features: s.features,
      })),
    };
    await cache.set(GENOME_MAP_CACHE_KEY, payload, GENOME_MAP_CACHE_TTL);
    return payload;
  }

  /** 返回某首歌在基因图谱中的最近邻（欧氏距离，前 10）— SQL 最近邻替代全表扫描 */
  async getCluster(songId: string) {
    const me = await prisma.songFeature.findUnique({ where: { songId } });
    if (!me || me.genomeX == null || me.genomeY == null) return [];

    // 参数化查询避免 SQL 注入；列名按 @@map：song_id / genome_x / genome_y
    const rows = await prisma.$queryRaw<{ songId: string; title: string; dist: number }[]>`
      SELECT s.id AS songId, s.title AS title,
             SQRT(POW(sf.genome_x - ${me.genomeX}, 2) + POW(sf.genome_y - ${me.genomeY}, 2)) AS dist
      FROM song_features sf
      JOIN songs s ON s.id = sf.song_id
      WHERE sf.genome_x IS NOT NULL
        AND sf.song_id <> ${songId}
      ORDER BY dist
      LIMIT 10
    `;
    return rows.map((r) => ({
      songId: r.songId,
      title: r.title,
      dist: Number(r.dist),
    }));
  }
}
