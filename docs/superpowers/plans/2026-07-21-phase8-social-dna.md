# Phase 8：声学社交 DNA 暗号 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development. `- [ ]` checkbox.

**Goal:** 实现社交 DNA 暗号--12 维向量（情绪 DNA 8 维 + 基因组质心 4 维）生成 SVG 几何暗号，余弦补集（1-cos）匹配互补灵魂 Top10。仅 SVG（不做音频水印，用户确认）。

**Architecture:** 服务端 SocialDna 模型存 12 维 vectorJson + cipherSvg。向量 = emotion DNA(8) + 基因组质心(4=avgGenomeX/avgGenomeY/avgBpm/avgEnergy，来自用户听过歌曲 ListeningEvent->Song->SongFeature 均值)。SVG 从 12 维生成 12 辐几何暗号。GET /api/social-dna/me 返回暗号+向量；POST /api/social-dna/match 用 1-cos 排序返回 Top10 互补。不泄露具体曲目（仅向量）。

**Tech Stack:** Node/Express/Prisma（服务端 SVG 生成 + 匹配）；React（Web 展示）

---

## 设计决策（已确认）
1. **仅 SVG 暗号**：用户选择，不做 3 秒音频水印。
2. **12 维向量**：emotion DNA 8 维（Phase 3 emotionDnaService 计算）+ 基因组质心 4 维（用户听过歌曲 SongFeature 的 avgGenomeX/avgGenomeY/avgBpm/avgEnergy 归一化）。
3. **匹配**：余弦补集 1-cos 排序，越大越互补（相反方向）。Top10。
4. **隐私**：仅返回向量+SVG，不泄露曲目。
5. **数据来源**：emotion DNA 从 ListeningEvent 算；genome 质心从用户听过歌曲关联 SongFeature 算（需 SongFeature 有数据，Phase 6 桌面上传填充）。

## 文件结构
### 新增
```
server/src/modules/social-dna/
├── social-dna.service.ts   # computeVector(8+4) + generateSvg + match(1-cos)
├── social-dna.controller.ts
└── social-dna.routes.ts
server/tests/social-dna.test.ts
web/src/pages/SocialDna.tsx
```
### 修改
- `server/prisma/schema.prisma`：model SocialDna { id, userId, vectorJson, cipherSvg, updatedAt }
- `server/src/index.ts`：注册路由
- `web/src/services/api.ts`：socialDnaApi
- `web/src/App.tsx`：注册 tab

---

## Task 8.1：服务端 SocialDna 模型 + SVG 暗号 + 匹配端点

**Files:** schema + social-dna 模块 + index + test

- [ ] **Step 1：schema**
```prisma
model SocialDna {
  id        Int      @id @default(autoincrement())
  userId    Int      @unique @map("user_id")
  vectorJson Json    @map("vector_json")
  cipherSvg  String  @map("cipher_svg") @db.Text
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at")
  user      User     @relation(fields: [userId], references: [id])
  @@map("social_dna")
}
```
User 加 `socialDna SocialDna?`（1:1）。Run db push + generate。

- [ ] **Step 2：写失败测试**（userId=8，造 listening events + song features）
```typescript
// server/tests/social-dna.test.ts
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../src/index';
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: 8, username: 'sd_test', role: 'user', status: 'active' }; next(); },
  authorize: (..._r: string[]) => (_q: any, _s: any, next: any) => next(),
}));
const db = new PrismaClient(); const UID = 8;
beforeAll(async () => {
  await db.user.upsert({ where: { id: UID }, update: {}, create: { id: UID, username: 'sd_test', email: 'sd@e.com', passwordHash: 'x' } });
  await db.socialDna.deleteMany({ where: { userId: UID } });
  await db.listeningEvent.deleteMany({ where: { userId: UID } });
  await db.songFeature.deleteMany({ where: { song: { filePath: { startsWith: 'D:/sd_test/' } } } });
  await db.song.deleteMany({ where: { filePath: { startsWith: 'D:/sd_test/' } } });
  // 造 2 首歌 + 特征 + 听过
  for (const [i, f] of [[0.8,0.7,0.6,0.5,0.4,0.3,0.2,0.1],[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8]].entries()) {
    const s = await db.song.create({ data: { id: `sd_s${i}`, title: `s${i}`, artist: '', audioUrl: '', filePath: `D:/sd_test/s${i}.mp3`, dataSource: 'manual' } });
    await db.songFeature.create({ data: { songId: s.id, subBass:f[0],bass:f[1],lowMid:f[2],mid:f[3],highMid:f[4],presence:f[5],brilliance:f[6],air:f[7], bpm:120, energy:0.5, genomeX: i?1:-1, genomeY:0 } });
    await db.listeningEvent.create({ data: { userId: UID, songId: s.id, eventType:'complete', engagementScore:0.8, occurredAt: new Date(),
      featSubBass:f[0],featBass:f[1],featLowMid:f[2],featMid:f[3],featHighMid:f[4],featPresence:f[5],featBrilliance:f[6],featAir:f[7] } });
  }
});
afterAll(async () => {
  await db.socialDna.deleteMany({ where: { userId: UID } });
  await db.listeningEvent.deleteMany({ where: { userId: UID } });
  await db.songFeature.deleteMany({ where: { song: { filePath: { startsWith: 'D:/sd_test/' } } } });
  await db.song.deleteMany({ where: { filePath: { startsWith: 'D:/sd_test/' } } });
  await db.user.deleteMany({ where: { id: UID } }).catch(()=>{}); await db.$disconnect();
});
describe('SocialDna', () => {
  it('GET /me returns 12-dim vector + SVG cipher', async () => {
    const res = await request(app).get('/api/social-dna/me');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.vector.length).toBe(12);
    expect(d.cipherSvg).toContain('<svg');
  });
  it('POST /match returns top complementary (1-cos)', async () => {
    // 造另一个用户 B 的 socialDna
    await db.user.upsert({ where: { id: 9 }, update: {}, create: { id: 9, username: 'sd_b', email: 'sd_b@e.com', passwordHash: 'x' } });
    await db.socialDna.upsert({ where: { userId: 9 }, create: { userId: 9, vectorJson: Array(12).fill(0.1), cipherSvg: '<svg/>' }, update: {} });
    const res = await request(app).post('/api/social-dna/match').send({ limit: 10 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    await db.socialDna.deleteMany({ where: { userId: 9 } });
    await db.user.deleteMany({ where: { id: 9 } });
  });
});
```
注意：ListeningEvent 字段名按实际 schema（occurredAt）。Song create 必填字段按 Task 6.1 确认的（id/title/artist/audioUrl/filePath/dataSource）。

- [ ] **Step 3：失败**（路由 404）

- [ ] **Step 4：service**
```typescript
// server/src/modules/social-dna/social-dna.service.ts
import prisma from '../../lib/prisma';
import { EmotionDnaService } from '../emotion-dna/emotion-dna.service';

const emotionSvc = new EmotionDnaService();

export class SocialDnaService {
  async computeAndStore(userId: number) {
    // 8 维 emotion DNA
    const emo = await emotionSvc.computeForUser(userId);  // 返回 {vector:[8]}
    const v8 = emo.vector;
    // 4 维 genome 质心：用户听过歌曲的 avgGenomeX/avgGenomeY/avgBpm/avgEnergy
    const events = await prisma.listeningEvent.findMany({ where: { userId }, include: { song: { include: { features: true } } } });
    const feats = events.map(e=>e.song?.features).filter(Boolean) as any[];
    const g = feats.length ? {
      x: avg(feats.map(f=>f.genomeX ?? 0)),
      y: avg(feats.map(f=>f.genomeY ?? 0)),
      bpm: avg(feats.map(f=>f.bpm ?? 0))/200,   // 归一化
      energy: avg(feats.map(f=>f.energy ?? 0)),
    } : { x:0,y:0,bpm:0,energy:0 };
    const vector = [...v8, g.x, g.y, g.bpm, g.energy];
    const cipherSvg = this.generateSvg(vector);
    await prisma.socialDna.upsert({
      where: { userId }, create: { userId, vectorJson: { vector }, cipherSvg }, update: { vectorJson: { vector }, cipherSvg },
    });
    return { vector, cipherSvg };
  }
  async getMe(userId: number) {
    let sd = await prisma.socialDna.findUnique({ where: { userId } });
    if (!sd) sd = (await this.computeAndStore(userId)) as any;  // 重新算并取
    if (!sd || !(sd as any).cipherSvg) { const r = await this.computeAndStore(userId); return r; }
    const v = (sd as any).vectorJson as any;
    return { vector: v.vector || v, cipherSvg: (sd as any).cipherSvg };
  }
  async match(userId: number, limit: number) {
    const me = await prisma.socialDna.findUnique({ where: { userId } });
    if (!me) return [];
    const myV = ((me.vectorJson as any).vector) as number[];
    const others = await prisma.socialDna.findMany({ where: { userId: { not: userId } } });
    return others.map(o => {
      const ov = ((o.vectorJson as any).vector) as number[];
      const comp = 1 - cosine(myV, ov);  // 补集越大越互补
      return { userId: o.userId, complement: comp };
    }).sort((a,b)=>b.complement-a.complement).slice(0, limit);
  }
  private generateSvg(v: number[]): string {
    // 12 辐几何暗号
    const cx=100, cy=100, R=80;
    let pts = '';
    for (let i=0;i<12;i++){
      const ang = -Math.PI/2 + i*2*Math.PI/12;
      const r = R * clamp01((v[i]+1)/2);  // v 可能 -1..1 -> 0..1
      pts += `${cx+r*Math.cos(ang)},${cy+r*Math.sin(ang)} `;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><polygon points="${pts.trim()}" fill="rgba(23,195,178,0.3)" stroke="#17C3B2" stroke-width="2"/></svg>`;
  }
}
function avg(a:number[]):number{ return a.length? a.reduce((s,x)=>s+x,0)/a.length : 0; }
function cosine(a:number[],b:number[]):number{ let dot=0,na=0,nb=0; for(let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} return (na&&nb)? dot/(Math.sqrt(na)*Math.sqrt(nb)) : 0; }
function clamp01(v:number):number{ return v<0?0:(v>1?1:v); }
```
注意：EmotionDnaService.computeForUser 的实际方法名/返回结构需勘察 emotion-dna.service.ts 确认（Phase 3 实现，可能叫 computeDna 或 recompute）。getMe 的 fallback 逻辑要避免重复算。先 Read emotion-dna.service.ts。

- [ ] **Step 5：controller + routes**
```typescript
// controller
async me(req,res){ const r = await svc.getMe((req as any).user.id); res.json({success:true,data:r}); }
async match(req,res){ const r = await svc.match((req as any).user.id, req.body.limit||10); res.json({success:true,data:r}); }
// routes: GET /me authenticate, POST /match authenticate
```

- [ ] **Step 6：注册 + 测试通过 + TS + 回归**
Run：`npx jest social-dna.test.ts` PASS；`npx tsc --noEmit`；`npm test` 全过（43+2=45）

- [ ] **Step 7：提交**
```
git add server/prisma/schema.prisma server/src/modules/social-dna/ server/tests/social-dna.test.ts server/src/index.ts
git commit -m "feat: add social DNA cipher with 12-dim vector and cosine-complement matching" -m "SocialDna model. 12-dim = emotionDNA(8) + genomeCentroid(4=avgGenomeX/Y/bpm/energy). SVG 12-spoke cipher. POST /match: 1-cos top complementary. No track leakage."
```

---

## Task 8.2：Web 社交 DNA 页

**Files:** web/src/pages/SocialDna.tsx, api.ts, App.tsx

- [ ] **Step 1：api + 页面**
socialDnaApi { get: ()=>request<{vector:number[];cipherSvg:string}>('/social-dna/me'), match:(limit)=>request.post('/social-dna/match',{}) }。
SocialDna.tsx：用 dangerouslySetInnerHTML 渲染 cipherSvg（SVG 字符串）+ 向量 12 条形图 + 匹配按钮显示互补 Top10。

- [ ] **Step 2：注册 tab + TS 验证**

- [ ] **Step 3：提交**
```
git add web/src/pages/SocialDna.tsx web/src/services/api.ts web/src/App.tsx
git commit -m "feat: add social DNA cipher web page"
```

---

## 验收
- 服务端：GET /me 返回 12 维向量 + SVG；POST /match 返回 1-cos Top10 互补
- Web：暗号 SVG 渲染 + 匹配列表
- 全部测试通过、TS 编译通过

## 依赖
- emotionDNA service 复用（Phase 3）
- SongFeature 需有数据（Phase 6 桌面上传）；无数据时 genome 质心为 0，向量仍 12 维
- 用户量少时 match 返回少（正常）
