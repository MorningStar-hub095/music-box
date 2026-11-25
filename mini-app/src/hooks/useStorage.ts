// src/hooks/useStorage.ts
// 本地存储 Hook，封装 Taro.setStorage/getStorage
import { useState, useCallback } from 'react';
import Taro from '@tarojs/taro';

export function useStorage<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = Taro.getStorageSync(key);
      return stored !== '' ? stored as T : defaultValue;
    } catch (e) {
      console.error('[Storage] 读取失败:', key, e);
      return defaultValue;
    }
  });

  const update = useCallback((newValue: T) => {
    setValue(newValue);
    try {
      Taro.setStorageSync(key, newValue);
    } catch (e) {
      console.error('[Storage] 写入失败:', key, e);
    }
  }, [key]);

  return [value, update] as const;
}
