import { useMemo } from 'react';
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
