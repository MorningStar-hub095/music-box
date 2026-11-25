// src/pages/recent/index.tsx
// 最近播放页：按时间倒序展示最近播放过的曲目
import React from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import styles from './index.module.scss';
import { usePlaylist } from '@/hooks/usePlaylist';

const Recent: React.FC = () => {
  const { recentTracks, select } = usePlaylist();

  const handlePlay = (trackId: string) => {
    select(trackId);
    Taro.switchTab({ url: '/pages/index/index' });
  };

  return (
    <View className={styles.container}>
      <View className={styles.header}>
        <Text className={styles.title}>最近播放</Text>
        <Text className={styles.count}>{recentTracks.length} 首</Text>
      </View>

      {recentTracks.length === 0 ? (
        <View className={styles.empty}>
          <Text className={styles.emptyIcon}>⏱</Text>
          <Text className={styles.emptyText}>还没有播放记录</Text>
          <Text className={styles.emptyHint}>去播放页听听音乐吧</Text>
        </View>
      ) : (
        <ScrollView scrollY className={styles.list}>
          {recentTracks.map((t, i) => (
            <View key={t.id} className={styles.item} onClick={() => handlePlay(t.id)}>
              <Text className={styles.index}>{i + 1}</Text>
              <View
                className={styles.cover}
                style={{ background: `linear-gradient(135deg, ${t.coverColor} 0%, #0F1419 100%)` }}
              >
                <Text className={styles.coverIcon}>♪</Text>
              </View>
              <View className={styles.info}>
                <Text className={styles.name}>{t.title}</Text>
                <Text className={styles.artist}>{t.artist}</Text>
              </View>
              <Text className={styles.playIcon}>▶</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
};

export default Recent;
