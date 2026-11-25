// src/hooks/useLyrics.ts
// 歌词解析 Hook，解析 LRC 格式并按播放位置查找当前行
import { useMemo, useState, useEffect } from 'react';
import { parseLrc } from '../../../shared/parseLrc';

export { parseLrc };

export function useLyrics(lyricContent: string, position: number) {
  const lyrics = useMemo(() => parseLrc(lyricContent), [lyricContent]);

  const currentIndex = useMemo(() => {
    if (lyrics.length === 0) return 0;
    for (let i = lyrics.length - 1; i >= 0; i--) {
      if (position >= lyrics[i].time) {
        return i;
      }
    }
    return 0;
  }, [lyrics, position]);

  return { lyrics, currentIndex };
}
