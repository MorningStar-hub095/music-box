import { LyricLine } from './types';

export function parseLrc(content: string): LyricLine[] {
  const lines: LyricLine[] = [];
  if (!content) return lines;

  const regex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  const lineArray = content.split('\n');

  let hasAnyTimestamp = false;
  const plainTextLines: string[] = [];

  for (const line of lineArray) {
    const timestamps: number[] = [];
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(line)) !== null) {
      const mm = parseInt(match[1], 10);
      const ss = parseInt(match[2], 10);
      const xx = match[3] ? parseInt(match[3], 10) : 0;
      // 支持 2 位或 3 位毫秒
      const ms = match[3] && match[3].length === 3 ? xx : xx * 10;
      timestamps.push(mm * 60000 + ss * 1000 + ms);
      hasAnyTimestamp = true;
    }

    const text = line.replace(regex, '').trim();
    if (!text) continue;

    if (timestamps.length === 0) {
      // 纯文本行（无时间标签），先收集
      plainTextLines.push(text);
      continue;
    }

    for (const ts of timestamps) {
      lines.push({ time: ts, text });
    }
  }

  // 如果完全没有 LRC 时间标签，将纯文本行作为无时间歌词返回（每行 time = -1）
  if (!hasAnyTimestamp && plainTextLines.length > 0) {
    for (const text of plainTextLines) {
      lines.push({ time: -1, text });
    }
  }

  lines.sort((a, b) => a.time - b.time);
  return lines;
}
