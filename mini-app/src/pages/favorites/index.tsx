// src/pages/favorites/index.tsx
// 收藏页：展示已收藏曲目，点击跳转到播放页并播放
import React from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import styles from './index.module.scss';
import { usePlaylist } from '@/hooks/usePlaylist';

const Favorites: React.FC = () => {
  const { favorites, toggleFavorite, select } = usePlaylist();

  const handlePlay = (trackId: string) => {
    select(trackId);
    Taro.switchTab({ url: '/pages/index/index' });
  };

  const handleRemove = (trackId: string) => {
    toggleFavorite(trackId);
    Taro.showToast({ title: '已取消收藏', icon: 'none' });
  };

  return (
    <View className={styles.container}>
      <View className={styles.header}>
        <Text className={styles.title}>我的收藏</Text>
        <Text className={styles.count}>{favorites.length} 首</Text>
      </View>

      {favorites.length === 0 ? (
        <View className={styles.empty}>
          <Text className={styles.emptyIcon}>♥</Text>
          <Text className={styles.emptyText}>还没有收藏的曲目</Text>
          <Text className={styles.emptyHint}>在播放页点击 ♥ 即可收藏</Text>
        </View>
      ) : (
        <ScrollView scrollY className={styles.list}>
          {favorites.map((t, i) => (
            <View key={t.id} className={styles.item}>
              <View className={styles.itemMain} onClick={() => handlePlay(t.id)}>
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
              </View>
              <View className={styles.removeBtn} onClick={() => handleRemove(t.id)}>
                <Text className={styles.removeIcon}>♥</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
};

export default Favorites;
