// src/hooks/useAudioPlayer.ts
// 音频播放 Hook，封装 Taro InnerAudioContext
import { useRef, useState, useCallback, useEffect } from 'react';
import Taro from '@tarojs/taro';

export function useAudioPlayer() {
  const audioRef = useRef<Taro.InnerAudioContext | null>(null);
  const currentSrcRef = useRef<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryRef = useRef(false);

  // 初始化音频上下文
  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      const audio = Taro.createInnerAudioContext();
      audio.obeyMuteSwitch = false;
      audio.onPlay(() => {
        setIsPlaying(true);
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
          if (audioRef.current) {
            setPosition(audioRef.current.currentTime * 1000);
          }
        }, 500);
      });
      audio.onPause(() => {
        setIsPlaying(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      });
      audio.onStop(() => {
        setIsPlaying(false);
        setPosition(0);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      });
      audio.onEnded(() => {
        setIsPlaying(false);
        setPosition(0);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      });
      audio.onError((err) => {
        console.error('[AudioPlayer] 播放错误:', err);
        setIsPlaying(false);
        setIsLoading(false);
        // 缓解措施：CDN 临时 URL 可能瞬时抖动，自动换源重试一次
        // （根治需接入后端 /api/audio/:id 代理并刷新失效 URL，见打包/部署文档）
        const src = currentSrcRef.current;
        if (src && !retryRef.current) {
          retryRef.current = true;
          console.warn('[AudioPlayer] 播放失败，自动重试一次:', src);
          setTimeout(() => {
            if (audioRef.current && currentSrcRef.current === src) {
              audioRef.current.src = src;
              audioRef.current.play();
            }
          }, 500);
          return;
        }
        setError('播放失败，该歌曲音源可能已失效');
      });
      audio.onCanplay(() => {
        setIsLoading(false);
        setError(null);
        if (audioRef.current && audioRef.current.duration > 0) {
          setDuration(audioRef.current.duration * 1000);
        }
      });
      audioRef.current = audio;
    }
    return audioRef.current;
  }, []);

  // 播放指定 URL
  const play = useCallback((url: string) => {
    const audio = ensureAudio();

    // 同一 URL：如果已在播放中，不操作；否则直接恢复播放
    if (currentSrcRef.current === url) {
      if (audioRef.current && !audio.paused) return;
      audio.play();
      console.log('[AudioPlayer] 恢复播放:', url);
      return;
    }

    // 切换新 URL
    currentSrcRef.current = url;
    retryRef.current = false; // 新音源重置重试标记
    setIsLoading(true);
    setError(null);
    audio.src = url;
    audio.play();
    console.log('[AudioPlayer] 播放:', url);
  }, [ensureAudio]);

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

  const resume = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play();
    }
  }, []);

  const seek = useCallback((ms: number) => {
    if (audioRef.current) {
      audioRef.current.seek(ms / 1000);
      setPosition(ms);
    }
  }, []);

  /** 快退：后退 ms 毫秒，越过开头则从头播放 */
  const rewind = useCallback((ms: number = 7000) => {
    const audio = audioRef.current;
    if (!audio) return;
    const newPos = position - ms;
    if (newPos <= 0) {
      audio.seek(0);
      setPosition(0);
    } else {
      audio.seek(newPos / 1000);
      setPosition(newPos);
    }
  }, [position]);

  /** 快进：前进 ms 毫秒，越过结尾返回 true（由调用者切下一首） */
  const forward = useCallback((ms: number = 7000): boolean => {
    const audio = audioRef.current;
    if (!audio) return false;
    const newPos = position + ms;
    if (duration > 0 && newPos >= duration) {
      return true; // 越过结尾，通知调用者切歌
    }
    audio.seek(newPos / 1000);
    setPosition(newPos);
    return false;
  }, [position, duration]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.stop();
      currentSrcRef.current = '';
    }
  }, []);

  // 清理
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (audioRef.current) {
        audioRef.current.destroy();
        audioRef.current = null;
        currentSrcRef.current = '';
      }
    };
  }, []);

  return { isPlaying, position, duration, isLoading, error, play, pause, resume, seek, rewind, forward, stop };
}
