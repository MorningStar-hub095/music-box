/**
 * P0-1 真实声学特征提取管线（v1.4.7）
 * ---------------------------------------------------------------
 * 对本地曲库 mp3 提取 8 维频谱特征 + bpm/energy，写回 song_features。
 * 修复分析报告 A1：全库 0.5 中性占位导致内容过滤/相似歌/PCA/情绪 DNA 全链路退化。
 *
 * 用法（需先启动桌面内嵌 PG 54329 或连接目标库）：
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/music_box \
 *     node scripts/extract-audio-features.cjs [--limit N] [--force] [--lib <dir>] [--recompute-genome] [--selftest N]
 *
 * 特征口径（与 preference.engine 的 Feat 8 维一致）：
 *   subBass 20-60Hz / bass 60-250 / lowMid 250-500 / mid 500-2000 /
 *   highMid 2000-4000 / presence 4000-6000 / brilliance 6000-12000 / air 12000-Nyquist
 *   归一化：带内 RMS 映射 dB 域 → 0-1（v = clamp((20log10(rms)+60)/65, 0, 1)）
 *   energy：全带 RMS 同口径映射
 *   bpm：谱通量 onset 包络 + 自相关（60-180 BPM 区间取峰）
 *
 * 说明：bpm/energy 字段本次一并写入（schema 已有字段，此前全程未消费）。
 */

const fs = require('fs');
const path = require('path');
const { MPEGDecoder } = require('mpg123-decoder');
const { PrismaClient } = require('@prisma/client');

// ---------------- 参数 ----------------
const args = process.argv.slice(2);
function argOf(name, def) {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const LIB_DIR = typeof argOf('--lib', '') === 'string' && argOf('--lib', '')
  ? argOf('--lib', '')
  : 'D:/music_box/data/audio-library';
const LIMIT = parseInt(argOf('--limit', '0'), 10) || 0;
const SELFTEST = parseInt(argOf('--selftest', '0'), 10) || 0;
const RECOMPUTE_GENOME = !!argOf('--recompute-genome', false);
const FORCE = !!argOf('--force', false) || SELFTEST > 0; // selftest 始终强制分析
const SKIP_WITHIN_DAYS = 7; // computedAt 7 天内视为新鲜，跳过（--force 覆盖）

// ---------------- FFT（迭代式 radix-2，就地） ----------------
function fftInPlace(re, im) {
  const n = re.length;
  // 位反转置换
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

const FFT_SIZE = 2048;
const HOP = 1024;
const MAX_ANALYZE_SEC = 150; // 每首最多分析前 150 秒，控制耗时

// dB 域映射到 0-1：-60dB→0，+5dB→1（线性斜率 1/65）
function dbToUnit(rms) {
  const db = 20 * Math.log10(Math.max(rms, 1e-9));
  return Math.min(1, Math.max(0, (db + 60) / 65));
}

/** 频带定义（Hz） */
const BANDS = [
  ['subBass', 20, 60],
  ['bass', 60, 250],
  ['lowMid', 250, 500],
  ['mid', 500, 2000],
  ['highMid', 2000, 4000],
  ['presence', 4000, 6000],
  ['brilliance', 6000, 12000],
  ['air', 12000, Infinity], // 上限取 Nyquist
];

/**
 * 对单声道 PCM 计算特征
 */
function analyzePcm(mono, sampleRate) {
  const maxSamples = Math.min(mono.length, Math.floor(MAX_ANALYZE_SEC * sampleRate));
  const hann = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  }
  const nyquist = sampleRate / 2;
  const binHz = sampleRate / FFT_SIZE;

  // 频带 bin 范围
  const bandRanges = BANDS.map(([, lo, hi]) => {
    const kLo = Math.max(1, Math.floor(lo / binHz));
    const kHi = Math.min(FFT_SIZE / 2 - 1, Math.ceil(Math.min(hi, nyquist) / binHz));
    return [kLo, Math.max(kLo, kHi)];
  });

  const frames = Math.max(1, Math.floor((maxSamples - FFT_SIZE) / HOP));
  const bandPower = new Float64Array(BANDS.length); // 带内平均功率累加
  const prevMag = new Float64Array(FFT_SIZE / 2);
  const fluxArr = []; // 谱通量 onset 包络
  let totalPower = 0;
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = mono[off + i] * hann[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    let frameFlux = 0;
    for (let k = 0; k < FFT_SIZE / 2; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / (FFT_SIZE / 4);
      const p = mag * mag;
      totalPower += p;
      const d = mag - prevMag[k];
      if (d > 0) frameFlux += d;
      prevMag[k] = mag;
    }
    fluxArr.push(frameFlux);
    for (let b = 0; b < bandRanges.length; b++) {
      const [kLo, kHi] = bandRanges[b];
      let s = 0;
      for (let k = kLo; k <= kHi; k++) {
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / (FFT_SIZE / 4);
        s += mag * mag;
      }
      bandPower[b] += s / (kHi - kLo + 1);
    }
  }

  const nBinsTotal = FFT_SIZE / 2;
  // 8 维特征
  const feat = {};
  for (let b = 0; b < BANDS.length; b++) {
    const rms = Math.sqrt(bandPower[b] / nBinsTotal);
    feat[BANDS[b][0]] = dbToUnit(rms);
  }
  // energy：全带平均
  const overallRms = Math.sqrt(totalPower / (frames * nBinsTotal));
  const energy = dbToUnit(overallRms);

  // BPM：onset 包络平滑 + 自相关
  let bpm = 0;
  const fps = sampleRate / HOP;
  if (fluxArr.length > fps * 8) { // 至少 8 秒
    // 平滑（3 帧）
    const sm = fluxArr.map((v, i) => {
      const a = fluxArr[Math.max(0, i - 1)], c = fluxArr[Math.min(fluxArr.length - 1, i + 1)];
      return (a + v + c) / 3;
    });
    // 去均值
    const mean = sm.reduce((s, v) => s + v, 0) / sm.length;
    for (let i = 0; i < sm.length; i++) sm[i] -= mean;
    const lagMin = Math.max(2, Math.floor((fps * 60) / 180)); // 180 BPM
    const lagMax = Math.min(Math.floor(sm.length / 2), Math.ceil((fps * 60) / 60)); // 60 BPM
    let bestLag = 0, bestVal = -Infinity;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let s = 0;
      for (let i = 0; i + lag < sm.length; i++) s += sm[i] * sm[i + lag];
      // 归一化（抑制长 lag 偏置）
      const norm = (sm.length - lag) || 1;
      const val = s / norm;
      if (val > bestVal) { bestVal = val; bestLag = lag; }
    }
    if (bestLag > 0 && bestVal > 0) {
      bpm = Math.round((60 * fps) / bestLag);
    }
  }

  return { ...feat, energy, bpm };
}

/** 立体声/多声道下混单声道 */
function downmix(channelData) {
  if (channelData.length === 1) return channelData[0];
  const n = channelData[0].length;
  const mono = new Float32Array(n);
  for (let c = 0; c < channelData.length; c++) {
    const ch = channelData[c];
    for (let i = 0; i < n; i++) mono[i] += ch[i];
  }
  for (let i = 0; i < n; i++) mono[i] /= channelData.length;
  return mono;
}

// ---------------- genome PCA（与 src/modules/genome/genome.service.ts 同口径的内联实现） ----------------
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function normalize(v) { const m = Math.sqrt(dot(v, v)) || 1; for (let i = 0; i < v.length; i++) v[i] /= m; }
function matVec(m, v, dim) { const o = Array(dim).fill(0); for (let i = 0; i < dim; i++) for (let j = 0; j < dim; j++) o[i] += m[i][j] * v[j]; return o; }
function powerIter(cov, dim) { let v = Array(dim).fill(0).map(() => Math.random()); normalize(v); for (let it = 0; it < 50; it++) { const nv = matVec(cov, v, dim); normalize(nv); v = nv; } return v; }
function deflate(cov, ev, dim) { const mv = matVec(cov, ev, dim); const lambda = dot(mv, ev); const out = cov.map((r) => r.slice()); for (let i = 0; i < dim; i++) for (let j = 0; j < dim; j++) out[i][j] -= lambda * ev[i] * ev[j]; return out; }

async function recomputeGenome(prisma) {
  const DIM = 8;
  const feats = await prisma.songFeature.findMany();
  if (feats.length < 2) { console.log('[GENOME] 特征不足，跳过'); return; }
  const rows = feats.map((f) => [f.subBass, f.bass, f.lowMid, f.mid, f.highMid, f.presence, f.brilliance, f.air]);
  const n = rows.length;
  const mean = Array(DIM).fill(0);
  rows.forEach((r) => { for (let i = 0; i < DIM; i++) mean[i] += r[i] / n; });
  const X = rows.map((r) => r.map((v, i) => v - mean[i]));
  const cov = Array.from({ length: DIM }, () => Array(DIM).fill(0));
  for (let i = 0; i < DIM; i++) for (let j = 0; j < DIM; j++) { let s = 0; for (let k = 0; k < n; k++) s += X[k][i] * X[k][j]; cov[i][j] = s / n; }
  const ev1 = powerIter(cov, DIM);
  const cov2 = deflate(cov, ev1, DIM);
  const ev2 = powerIter(cov2, DIM);
  const xs = [], ys = [];
  const coords = X.map((r) => ({ x: dot(r, ev1), y: dot(r, ev2) }));
  coords.forEach((c) => { xs.push(c.x); ys.push(c.y); });
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xRange = xMax - xMin || 1, yRange = yMax - yMin || 1;
  let done = 0;
  for (let i = 0; i < feats.length; i++) {
    const gx = ((coords[i].x - xMin) / xRange) * 2 - 1;
    const gy = ((coords[i].y - yMin) / yRange) * 2 - 1;
    await prisma.songFeature.update({ where: { songId: feats[i].songId }, data: { genomeX: gx, genomeY: gy } });
    done++;
    if (done % 100 === 0) console.log(`[GENOME] ${done}/${feats.length}`);
  }
  console.log(`[GENOME] PCA 坐标重算完成: ${done} 首`);
}

// ---------------- 主流程 ----------------
async function main() {
  const prisma = new PrismaClient();
  const songs = await prisma.song.findMany({
    where: { playable: true, archived: false, audioUrl: { startsWith: '/audio-lib/' } },
    select: { id: true, title: true, audioUrl: true, features: { select: { computedAt: true } } },
  });
  console.log(`[管线] 目标歌曲: ${songs.length} 首（本地曲库 ${LIB_DIR}）`);

  // 7 天内已计算的跳过（--force 覆盖）
  const now = Date.now();
  const targets = songs.filter((s) => {
    if (FORCE) return true;
    if (!s.features?.computedAt) return true;
    return now - new Date(s.features.computedAt).getTime() > SKIP_WITHIN_DAYS * 86400_000;
  });
  const skipped = songs.length - targets.length;
  if (skipped > 0) console.log(`[管线] ${skipped} 首 7 天内已计算，跳过（--force 可强制重算）`);
  // selftest 模式：只分析前 SELFTEST 首，不入库
  const list = SELFTEST > 0 ? targets.slice(0, SELFTEST) : LIMIT > 0 ? targets.slice(0, LIMIT) : targets;
  console.log(`[管线] 本次提取: ${list.length} 首${SELFTEST ? `（selftest 模式：仅分析不入库前 ${SELFTEST} 首）` : ''}`);

  const t0 = Date.now();
  let ok = 0, fail = 0, failFiles = [];

  for (let i = 0; i < list.length; i++) {
    const song = list[i];
    const file = path.join(LIB_DIR, path.basename(song.audioUrl));
    try {
      if (!fs.existsSync(file)) throw new Error('文件不存在: ' + file);
      const buf = new Uint8Array(fs.readFileSync(file));
      const decoder = new MPEGDecoder();
      await decoder.ready;
      const { channelData, samplesDecoded, sampleRate, errors } = decoder.decode(buf);
      decoder.free();
      if (samplesDecoded < sampleRate * 5) throw new Error(`有效音频过短（${(samplesDecoded / sampleRate).toFixed(1)}s）`);

      const mono = downmix(channelData);
      const feat = analyzePcm(mono, sampleRate);

      if (SELFTEST) {
        console.log(`[selftest] ${song.id} ${path.basename(song.audioUrl)} →`, JSON.stringify({
          ...feat, bpm: feat.bpm,
        }));
      } else {
        await prisma.songFeature.update({
          where: { songId: song.id },
          data: {
            subBass: feat.subBass, bass: feat.bass, lowMid: feat.lowMid, mid: feat.mid,
            highMid: feat.highMid, presence: feat.presence, brilliance: feat.brilliance, air: feat.air,
            bpm: feat.bpm, energy: feat.energy, computedAt: new Date(),
          },
        });
      }
      ok++;
      if ((i + 1) % 25 === 0 || i === list.length - 1) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`[管线] 进度 ${i + 1}/${list.length}（成功 ${ok}，失败 ${fail}，耗时 ${elapsed}s）`);
      }
    } catch (e) {
      fail++;
      failFiles.push({ id: song.id, err: e.message });
      if (fail <= 10) console.warn(`[管线] 失败 ${song.id}: ${e.message}`);
    }
  }

  console.log(`[管线] 完成：成功 ${ok}/${list.length}，失败 ${fail}，总耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (failFiles.length) console.log('[管线] 失败清单:', JSON.stringify(failFiles, null, 1));

  // 特征分布摘要（区分度验证）
  if (!SELFTEST && ok > 0) {
    const feats = await prisma.songFeature.findMany();
    const dims = ['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance', 'air'];
    const summary = {};
    for (const d of dims) {
      const vals = feats.map((f) => f[d]).sort((a, b) => a - b);
      const q = (p) => vals[Math.floor(p * (vals.length - 1))];
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
      summary[d] = { min: +q(0).toFixed(3), p25: +q(0.25).toFixed(3), med: +q(0.5).toFixed(3), p75: +q(0.75).toFixed(3), max: +q(1).toFixed(3), sd: +sd.toFixed(3) };
    }
    const bpms = feats.map((f) => f.bpm).filter((v) => v > 0);
    summary.bpm = { nonZero: bpms.length, med: bpms.length ? bpms.sort((a, b) => a - b)[Math.floor(bpms.length / 2)] : 0 };
    console.log('[分布摘要]', JSON.stringify(summary, null, 1));
  }

  if (RECOMPUTE_GENOME && !SELFTEST && ok > 0) {
    console.log('[GENOME] 开始重算 PCA 坐标...');
    await recomputeGenome(prisma);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
