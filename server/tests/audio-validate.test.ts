// 音频校验红线测试（试听片段/容器/码率）
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validateAudioFile } from '../src/modules/library/audio-validate';

// 构造一个可解析的 CBR MP3：ID3 头 + N 秒指定码率的 MPEG1 Layer3 帧流
function buildFakeMp3(seconds: number, bitrateKbps = 128): Buffer {
  const id3 = Buffer.alloc(10);
  id3.write('ID3', 0, 'latin1');
  const brIdx = bitrateKbps === 64 ? 5 : bitrateKbps === 96 ? 6 : bitrateKbps === 128 ? 9 : bitrateKbps === 192 ? 12 : 14; // 320
  const frameLen = Math.floor((bitrateKbps * 1000 / 8) * (1152 / 44100)) + 1; // padding≈1
  // byte2: [bitrateIdx(4)][private(1)][srIdx(2)=44100][padding(1)]
  const header = Buffer.from([0xff, 0xfb, (brIdx << 4) & 0xf0, 0x00]);
  const frames = Math.ceil((seconds * bitrateKbps * 1000 / 8) / frameLen);
  const body = Buffer.alloc(frameLen * frames);
  for (let i = 0; i < frames; i++) header.copy(body, i * frameLen);
  return Buffer.concat([id3, body]);
}

function buildFakeM4a(seconds: number): Buffer {
  // 真实 mvhd version 0 布局：[size(4)]'mvhd'[ver+flags(4)][ctime(4)][mtime(4)][timescale(4)][duration(4)]...
  const box = Buffer.alloc(100);
  box.write('mvhd', 0, 'latin1');
  box.writeUInt32BE(0, 4);                 // version 0 + flags
  box.writeUInt32BE(0, 8);                 // ctime
  box.writeUInt32BE(0, 12);                // mtime
  box.writeUInt32BE(1000, 16);             // timescale
  box.writeUInt32BE(seconds * 1000, 20);   // duration
  const ftypBox = Buffer.alloc(16);
  ftypBox.write('ftypmp42', 4, 'latin1');
  // mdat 填充至 2.5MB（确保 200s 下平均码率 ≈100kbps，越过码率红线，仅测容器/时长解析）
  const filler = Buffer.alloc(2.5 * 1024 * 1024);
  return Buffer.concat([ftypBox, box, Buffer.from([0, 0, 0, 8]), Buffer.from('mdat'), filler]);
}

describe('audio-validate 试听红线', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-validate-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const write = (name: string, buf: Buffer) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, buf);
    return p;
  };

  test('完整 MP3（120s/128kbps）通过', () => {
    const p = write('full.mp3', buildFakeMp3(120));
    const r = validateAudioFile(p, 120);
    expect(r.ok).toBe(true);
    expect(r.container).toBe('mp3');
    expect(r.seconds).toBeGreaterThan(115);
  });

  test('试听片段：45s 实测 vs 254s 元数据 → 拒收', () => {
    // 45s@128kbps ≈ 721KB（与审计中发现的固定片段字节数吻合）
    const p = write('clip.mp3', buildFakeMp3(45));
    const r = validateAudioFile(p, 254);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('preview_clip');
  });

  test('绝对短文件（<60s 无元数据）→ 拒收 too_short', () => {
    const p = write('short.mp3', buildFakeMp3(30));
    const r = validateAudioFile(p, null);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('too_short');
  });

  test('合法短歌：实测 70s 与元数据 72s 吻合 → 通过', () => {
    const p = write('short-ok.mp3', buildFakeMp3(70));
    const r = validateAudioFile(p, 72);
    expect(r.ok).toBe(true);
  });

  test('M4A 容器可解析时长', () => {
    const p = write('song.m4a', buildFakeM4a(200));
    const r = validateAudioFile(p, 200);
    expect(r.ok).toBe(true);
    expect(r.container).toBe('m4a');
  });

  test('非音频内容（HTML 错误页）→ 拒收 unknown_container', () => {
    const p = write('error.mp3', Buffer.concat([Buffer.alloc(200 * 1024, 0x41), Buffer.from('<html>403</html>')]));
    const r = validateAudioFile(p, null);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unknown_container');
  });

  test('过小文件 → 拒收 too_small', () => {
    const p = write('tiny.mp3', Buffer.alloc(1024));
    const r = validateAudioFile(p, null);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('too_small');
  });

  test('低码率（64kbps 长音频）→ 拒收 low_bitrate', () => {
    const p = write('low.mp3', buildFakeMp3(200, 64));
    const r = validateAudioFile(p, 200);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('low_bitrate');
  });
});
