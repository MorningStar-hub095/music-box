/**
 * 音频文件校验（2026-11-18 曲目录入管线共用）
 *
 * 红线规则（源自 2026-11-16/17 审计结论）：
 *  1. 容器魔数必须可识别（MP3 ID3/MPEG 帧同步、M4A ftyp）；拒绝 HTML/JSON 错误页、0 字节文件
 *  2. 时长必须可解析且与元数据吻合——实测时长 < min(60s, 元数据时长×0.8) 判为「试听片段」拒收
 *  3. 码率 ≥ 96kbps（过低保真文件拒收）
 */

import fs from 'fs';

export interface AudioValidateResult {
  ok: boolean;
  container?: 'mp3' | 'm4a' | 'unknown';
  seconds?: number;
  bitrateKbps?: number;
  reason?: string;
}

const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000];

/** M4A mvhd box 时长解析（version 0：[mvhd][ver+flags 4][ctime 4][mtime 4][timescale 4][duration 4]） */
function readMvhd(buf: Buffer): { seconds: number } | null {
  const idx = buf.indexOf(Buffer.from('mvhd'));
  if (idx === -1) return null;
  const ver = buf[idx + 4];
  if (ver === 0) {
    const timescale = buf.readUInt32BE(idx + 16);
    const dur = buf.readUInt32BE(idx + 20);
    if (timescale > 0) return { seconds: dur / timescale };
  }
  return null;
}

/** MP3 时长/码率解析：优先 Xing/Info VBR 头（帧计数精确），否则 CBR 估算 */
function parseMp3(buf: Buffer): { seconds: number; bitrateKbps: number } | null {
  let off = 0;
  if (buf.length > 10 && buf.slice(0, 3).toString('latin1') === 'ID3') {
    const sz = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    off = 10 + sz;
  }
  const searchEnd = Math.min(off + 65536, buf.length - 4);
  for (let i = off; i < searchEnd; i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      const verBits = (buf[i + 1] >> 3) & 3;
      const layerBits = (buf[i + 1] >> 1) & 3;
      const brIdx = (buf[i + 2] >> 4) & 15;
      const srIdx = (buf[i + 3] >> 2) & 3;
      if (verBits === 3 && layerBits === 1 && brIdx >= 1 && brIdx <= 14 && srIdx <= 2) {
        const bitrateKbps = MPEG1_L3_BITRATES[brIdx];
        const sampleRate = MPEG1_SAMPLE_RATES[srIdx];
        const headWindow = buf.subarray(i, Math.min(i + 4096, buf.length));
        const xingIdx = headWindow.indexOf(Buffer.from('Xing'));
        const infoIdx = headWindow.indexOf(Buffer.from('Info'));
        const x = xingIdx !== -1 ? i + xingIdx : (infoIdx !== -1 ? i + infoIdx : -1);
        if (x !== -1 && (buf.readUInt32BE(x + 4) & 1)) {
          const frames = buf.readUInt32BE(x + 8);
          return { seconds: (frames * 1152) / sampleRate, bitrateKbps };
        }
        return { seconds: ((buf.length - i) * 8) / (bitrateKbps * 1000), bitrateKbps };
      }
    }
  }
  return null;
}

/**
 * 校验磁盘上的音频文件。
 * @param filePath  文件路径
 * @param metaDurationSec 元数据声明的秒数（DB/上游 API；未知传 null）
 */
export function validateAudioFile(filePath: string, metaDurationSec: number | null): AudioValidateResult {
  let st: fs.Stats;
  try {
    st = fs.statSync(filePath);
  } catch {
    return { ok: false, reason: 'file_not_found' };
  }
  if (!st.isFile() || st.size < 100_000) {
    return { ok: false, reason: `too_small(${st.size}B)` };
  }

  // 读头部 2MB 足以解析帧头/Xing/mvhd
  const fd = fs.openSync(filePath, 'r');
  const head = Buffer.alloc(Math.min(st.size, 2 * 1024 * 1024));
  try {
    fs.readSync(fd, head, 0, head.length, 0);
  } finally {
    fs.closeSync(fd);
  }

  // 1. 容器魔数
  const ftypIdx = head.indexOf(Buffer.from('ftyp'), 4);
  const isM4a = ftypIdx !== -1 && ftypIdx < 32;
  const isMp3 =
    head.slice(0, 3).toString('latin1') === 'ID3' ||
    (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) ||
    (!isM4a && parseMp3(head) !== null);
  if (!isMp3 && !isM4a) {
    return { ok: false, reason: 'unknown_container' };
  }

  if (isM4a) {
    const mv = readMvhd(head);
    if (!mv) return { ok: false, container: 'm4a', reason: 'mvhd_missing' };
    return checkDuration({ ok: true, container: 'm4a', seconds: mv.seconds, bitrateKbps: undefined }, st.size, metaDurationSec);
  }

  const mp3 = parseMp3(head);
  if (!mp3) return { ok: false, container: 'unknown', reason: 'frame_header_missing' };
  return checkDuration(
    { ok: true, container: 'mp3', seconds: mp3.seconds, bitrateKbps: mp3.bitrateKbps },
    st.size,
    metaDurationSec,
  );
}

/** 时长红线 + 码率红线（preview_clip 优先于 too_short：元数据已知的短片段给出更精确原因） */
function checkDuration(base: AudioValidateResult, fileSize: number, metaDurationSec: number | null): AudioValidateResult {
  const seconds = base.seconds ?? 0;
  if (metaDurationSec && metaDurationSec >= 90 && seconds < metaDurationSec * 0.8) {
    // 实测远小于声明时长 → 试听片段
    return { ...base, ok: false, reason: `preview_clip(${Math.round(seconds)}s vs meta ${Math.round(metaDurationSec)}s)` };
  }
  if (seconds < 60) {
    return { ...base, ok: false, reason: `too_short(${Math.round(seconds)}s)` };
  }
  // 估算平均码率（bitrateKbps 为首帧声明值，VBR 可能偏低估；以文件体积折算为准）
  const avgKbps = seconds > 0 ? Math.round((fileSize * 8) / seconds / 1000) : 0;
  if (avgKbps < 96) {
    return { ...base, ok: false, reason: `low_bitrate(${avgKbps}kbps)` };
  }
  return { ...base, avgBitrateKbps: avgKbps } as AudioValidateResult;
}
