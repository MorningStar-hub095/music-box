// src/pages/index/index.tsx
// 播放页：播放器控制 + 歌词显示 + 播放列表 + 播放模式
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, Slider, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import styles from './index.module.scss';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useMiniAudioAnalyser } from '@/hooks/useMiniAudioAnalyser';
import { useLyrics } from '@/hooks/useLyrics';
import {
  usePlaylist,
  PLAY_MODE_LABEL,
  PLAY_MODE_ICON
} from '@/hooks/usePlaylist';
import { useVisualizer } from '@/hooks/useVisualizer';
import { useTheme } from '@/hooks/useTheme';
import { PRESET_LABELS, Preset } from '../../../../shared/theme-presets';
import { SonicBackground } from '@/components/SonicBackground';
import { Track } from '@/types';

const formatTime = (ms: number): string => {
  if (!ms || ms < 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60).toString().padStart(2, '0');
  const ss = (total % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
};

const Index: React.FC = () => {
  const {
    playlist,
    currentTrack,
    currentIndex,
    playMode,
    next,
    prev,
    select,
    togglePlayMode,
    isFavorite,
    toggleFavorite,
    addToRecent
  } = usePlaylist();

  const { isPlaying, position, duration, isLoading, error, play, pause, resume, seek, rewind, forward, stop } = useAudioPlayer();
  const { features: audioFeatures, initAnalyser, setPlaying } = useMiniAudioAnalyser();
  const visualizer = useVisualizer();
  const theme = useTheme();
  const [showList, setShowList] = useState(false);
  const [showLyrics, setShowLyrics] = useState(true);
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [extraTracks, setExtraTracks] = useState<Track[]>([]);
  // 防止播放结束逻辑重复触发
  const endedHandledRef = useRef(false);
  // 快进/快退进度条标记视觉反馈
  const [seekMarker, setSeekMarker] = useState<{ from: number; to: number; direction: 'rewind' | 'forward'; key: number } | null>(null);
  // 封面区双击检测
  const lastTapRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });

  // 歌词
  const { lyrics, currentIndex: lyricIndex } = useLyrics(
    currentTrack?.lyricContent || '',
    position
  );

  // 同步播放状态到音频分析器（用于伪节拍模拟）
  useEffect(() => {
    setPlaying(isPlaying);
  }, [isPlaying, setPlaying]);

  // 切换曲目时自动播放并加入最近播放，并重置结束标志
  useEffect(() => {
    if (!currentTrack) return;
    endedHandledRef.current = false;
    play(currentTrack.audioUrl);
    initAnalyser(); // 初始化音频分析器
    addToRecent(currentTrack.id);
  }, [currentTrack?.id, play, addToRecent]);

  // 播放结束自动切下一首
  const handleEnded = useCallback(() => {
    if (endedHandledRef.current) return;
    endedHandledRef.current = true;
    const nxt = next();
    if (!nxt && playMode === 'sequential') {
      // 顺序播放结束，停止
      stop();
    }
  }, [next, playMode, stop]);

  // 监听播放结束（通过 isPlaying 从 true 变 false 且 position 接近 duration 判断）
  useEffect(() => {
    if (
      !isPlaying &&
      duration > 0 &&
      position >= duration - 200 &&
      position > 0
    ) {
      handleEnded();
    }
  }, [isPlaying, position, duration, handleEnded]);

  const handlePlayPause = () => {
    if (!currentTrack) return;
    if (isPlaying) {
      pause();
    } else if (position > 0) {
      resume();
    } else {
      play(currentTrack.audioUrl);
    }
  };

  const handlePrev = () => {
    prev();
  };

  const handleNext = () => {
    next();
  };

  const handleSeek = (e: any) => {
    const v = e.detail?.value ?? 0;
    // seek 时重置结束标志，避免拖到末尾误触发
    endedHandledRef.current = false;
    seek(v);
  };

  // 快退 7 秒
  const handleRewind = useCallback(() => {
    if (!currentTrack) return;
    endedHandledRef.current = false;
    const oldPos = position;
    rewind(7000);
    setSeekMarker({ from: oldPos, to: Math.max(0, oldPos - 7000), direction: 'rewind', key: Date.now() });
    // 标记自动消失
    setTimeout(() => setSeekMarker(null), 800);
  }, [currentTrack, position, rewind]);

  // 快进 7 秒，越过结尾则切下一首
  const handleForward = useCallback(() => {
    if (!currentTrack) return;
    endedHandledRef.current = false;
    const oldPos = position;
    const exceeded = forward(7000);
    if (exceeded) {
      next();
    } else {
      setSeekMarker({ from: oldPos, to: oldPos + 7000, direction: 'forward', key: Date.now() });
      setTimeout(() => setSeekMarker(null), 800);
    }
  }, [currentTrack, position, forward, next]);

  // 封面区双击：左半区快退 / 右半区快进
  const handleCoverTap = (e: any) => {
    const now = Date.now();
    const tapX = e.detail?.x ?? 0;
    if (now - lastTapRef.current.time < 350) {
      // 双击：根据触摸位置判断左右（封面居中，以屏幕中线为界）
      const screenCenter = Taro.getSystemInfoSync().windowWidth / 2;
      if (tapX < screenCenter) {
        handleRewind();
      } else {
        handleForward();
      }
      lastTapRef.current.time = 0;
    } else {
      lastTapRef.current.time = now;
      lastTapRef.current.x = tapX;
    }
  };

  const handleSelectTrack = (track: Track) => {
    select(track.id);
    setShowList(false);
  };

  const handleToggleFavorite = () => {
    if (!currentTrack) return;
    const fav = toggleFavorite(currentTrack.id);
    Taro.showToast({
      title: fav ? '已收藏' : '已取消收藏',
      icon: 'none'
    });
  };

  const importLocalFiles = useCallback(() => {
    Taro.chooseMessageFile({
      count: 9,
      type: 'file',
      extension: ['mp3', 'wav', 'm4a'],
      success: (res) => {
        const newTracks: Track[] = res.tempFiles.map((file, idx) => ({
          id: `local:${Date.now()}:${idx}`,
          title: file.name.replace(/\.[^.]+$/, ''),
          artist: '本地文件',
          audioUrl: file.path,
          lyricContent: '[00:00.00]♪ 本地文件',
          coverColor: '#17C3B2',
        }));
        setExtraTracks(prev => [...prev, ...newTracks]);
        Taro.showToast({ title: `已导入 ${newTracks.length} 首`, icon: 'success' });
      },
      fail: () => {
        Taro.showToast({ title: '取消导入', icon: 'none' });
      },
    });
  }, []);

  const allPlaylist = [...playlist, ...extraTracks];

  if (!currentTrack) {
    return (
      <View className={styles.container}>
        <View className={styles.empty}>
          <Text className={styles.emptyText}>曲库为空，请运行爬虫导出曲目</Text>
        </View>
      </View>
    );
  }

  const fav = isFavorite(currentTrack.id);

  return (
    <View className={styles.container}>
      <SonicBackground isPlaying={isPlaying} features={audioFeatures} />
      {error && <View className={styles.errorBar}>{error}</View>}
      {/* 主题切换 */}
      <View className={styles.themeBtn} onClick={() => setShowThemeMenu(!showThemeMenu)}>
        {theme.mode === 'dark' ? '🌙' : '☀️'}
      </View>
      {showThemeMenu && (
        <View className={styles.themeMenu}>
          <View className={styles.themeToggle} onClick={theme.toggleMode}>
            {theme.mode === 'dark' ? '☀️ 亮色' : '🌙 深色'}
          </View>
          <View className={styles.themePresets}>
            {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
              <View key={p} className={`${styles.themePresetBtn} ${theme.preset === p ? styles.active : ''}`}
                onClick={() => theme.setPreset(p)}>
                {PRESET_LABELS[p]}
              </View>
            ))}
          </View>
        </View>
      )}
      {/* 顶部封面区 */}
      <View className={styles.coverArea}>
        <View
          className={styles.cover}
          style={{
            background: `linear-gradient(135deg, ${currentTrack.coverColor} 0%, #0F1419 100%)`,
            boxShadow: isPlaying
              ? `0 16rpx 48rpx ${currentTrack.coverColor}66`
              : '0 8rpx 24rpx rgba(0,0,0,0.3)'
          }}
          onTouchEnd={handleCoverTap}
        >
          {currentTrack.albumCover ? (
            <Image src={currentTrack.albumCover} className={styles.coverImg} mode="aspectFill" />
          ) : (
            <Text className={styles.coverIcon}>{isPlaying ? '♪' : '❚❚'}</Text>
          )}
          {isLoading && <Text className={styles.loadingText}>加载中...</Text>}
        </View>
        <View className={styles.trackMeta}>
          <Text className={styles.trackTitle}>{currentTrack.title}</Text>
          <Text className={styles.trackArtist}>{currentTrack.artist}</Text>
        </View>
        <View className={styles.actionRow}>
          <View className={styles.iconBtn} onClick={handleToggleFavorite}>
            <Text className={styles.iconText} style={{ color: fav ? '#EF4444' : '#A0A0A0' }}>
              {fav ? '♥' : '♡'}
            </Text>
          </View>
          <View className={styles.iconBtn} onClick={() => setShowLyrics(v => !v)}>
            <Text className={styles.iconText} style={{ color: showLyrics ? '#17C3B2' : '#A0A0A0' }}>
              ♫
            </Text>
          </View>
          <View className={styles.iconBtn} onClick={visualizer.toggle}>
            <Text style={{ color: visualizer.isActive ? theme.colors.primary : 'rgba(255,255,255,0.6)' }}>📊</Text>
          </View>
          <View className={styles.iconBtn} onClick={() => setShowList(v => !v)}>
            <Text className={styles.iconText} style={{ color: showList ? '#17C3B2' : '#A0A0A0' }}>
              ☰
            </Text>
          </View>
        </View>
      </View>

      {/* 频谱波形 */}
      {visualizer.isActive && (
        <View className={styles.waveBarContainer}>
          <View className={`${styles.waveBar} ${styles.waveBar1}`} />
          <View className={`${styles.waveBar} ${styles.waveBar2}`} />
          <View className={`${styles.waveBar} ${styles.waveBar3}`} />
        </View>
      )}

      {/* 歌词区 */}
      {showLyrics && (
        <ScrollView
          className={styles.lyricScroll}
          scrollY
          scrollIntoView={lyrics.length > 0 ? `lyric-${lyricIndex}` : ''}
          scrollWithAnimation
        >
          {lyrics.length > 0 ? (
            <View className={styles.lyricInner}>
              {lyrics.map((line, i) => {
                const distance = i - lyricIndex;
                const level = Math.min(Math.abs(distance), 3);
                const sideClass = distance < 0 ? styles.lyricUpper : distance > 0 ? styles.lyricLower : styles.lyricCenter;
                const levelClass = styles[`lyricLevel${level}`];
                return (
                  <Text
                    key={i}
                    id={`lyric-${i}`}
                    className={`${styles.lyricLine} ${sideClass} ${levelClass}${i === lyricIndex ? ` ${styles.lyricActive}` : ''}`}
                  >
                    {line.text || '♪'}
                  </Text>
                );
              })}
            </View>
          ) : (
            <View className={styles.lyricScroll}>
              <Text className={styles.lyricEmpty}>暂无歌词</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* 播放列表抽屉 */}
      {showList && (
        <View className={styles.playlistPanel}>
          <View className={styles.playlistHeader}>
            <Text className={styles.playlistTitle}>播放列表 ({allPlaylist.length})</Text>
            <View className={styles.importBtn} onClick={importLocalFiles}>📁 导入</View>
            <Text className={styles.playlistClose} onClick={() => setShowList(false)}>×</Text>
          </View>
          <ScrollView scrollY className={styles.playlistScroll}>
            {allPlaylist.map((t, i) => (
              <View
                key={t.id}
                className={
                  i === currentIndex ? styles.playlistItemActive : styles.playlistItem
                }
                onClick={() => handleSelectTrack(t)}
              >
                <Text className={styles.playlistIndex}>{i + 1}</Text>
                <View className={styles.playlistInfo}>
                  <Text className={styles.playlistName}>{t.title}</Text>
                  <Text className={styles.playlistArtist}>{t.artist}</Text>
                </View>
                {isFavorite(t.id) && (
                  <Text className={styles.playlistFav} style={{ color: '#EF4444' }}>♥</Text>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* 底部控制区 */}
      <View className={styles.controlArea}>
        <View className={styles.progressRow}>
          <Text className={styles.timeText}>{formatTime(position)}</Text>
          <View className={styles.sliderWrap}>
            <Slider
              min={0}
              max={duration || 100}
              value={position}
              step={1000}
              blockSize={16}
              activeColor="#17C3B2"
              backgroundColor="#2A2F3E"
              blockColor="#FFFFFF"
              onChange={handleSeek}
            />
            {seekMarker && duration > 0 && (
              <View
                key={seekMarker.key}
                className={`${styles.seekMarker} ${seekMarker.direction === 'rewind' ? styles.seekMarkerRewind : styles.seekMarkerForward}`}
                style={{
                  left: `${(Math.min(seekMarker.from, seekMarker.to) / duration) * 100}%`,
                  width: `${(Math.abs(seekMarker.to - seekMarker.from) / duration) * 100}%`,
                }}
              />
            )}
          </View>
          <Text className={styles.timeText}>{formatTime(duration)}</Text>
        </View>

        <View className={styles.controlRow}>
          <View className={styles.modeBtn} onClick={togglePlayMode}>
            <Text className={styles.modeIcon}>{PLAY_MODE_ICON[playMode]}</Text>
            <Text className={styles.modeLabel}>{PLAY_MODE_LABEL[playMode]}</Text>
          </View>
          <View className={styles.mainControls}>
            <View className={styles.ctrlBtn} onClick={handlePrev}>
              <Text className={styles.ctrlIcon}>⏮</Text>
            </View>
            <View className={`${styles.ctrlBtn} ${styles.seekBtn}`} onClick={handleRewind}>
              <Text className={styles.ctrlIcon}>⏪</Text>
            </View>
            <View className={styles.playBtn} onClick={handlePlayPause}>
              <Text className={styles.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
            </View>
            <View className={`${styles.ctrlBtn} ${styles.seekBtn}`} onClick={handleForward}>
              <Text className={styles.ctrlIcon}>⏩</Text>
            </View>
            <View className={styles.ctrlBtn} onClick={handleNext}>
              <Text className={styles.ctrlIcon}>⏭</Text>
            </View>
          </View>
          <View className={styles.modeBtn} style={{ opacity: 0 }}>
            <Text className={styles.modeIcon}>{PLAY_MODE_ICON[playMode]}</Text>
            <Text className={styles.modeLabel}>{PLAY_MODE_LABEL[playMode]}</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

export default Index;
