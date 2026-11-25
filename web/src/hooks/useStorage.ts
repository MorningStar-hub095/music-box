import { useState, useCallback } from 'react';

type SetStateAction<T> = T | ((prev: T) => T);

export function useStorage<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) as T : defaultValue;
    } catch (error) {
      console.warn(`[useStorage] 读取本地存储失败 (key: ${key}):`, error);
      return defaultValue;
    }
  });

  const update = useCallback((newValue: SetStateAction<T>) => {
    setValue(prev => {
      const resolved = typeof newValue === 'function' ? (newValue as (prev: T) => T)(prev) : newValue;
      try {
        localStorage.setItem(key, JSON.stringify(resolved));
      } catch (error) {
        console.error(`[useStorage] 写入本地存储失败 (key: ${key}):`, error);
        // 存储配额已满时尝试清理过期数据
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
          try {
            // 清理非关键的临时数据
            const keysToPreserve = ['mb_favorites', 'mb_recent', 'mb_playlists', 'mb_play_mode'];
            for (let i = localStorage.length - 1; i >= 0; i--) {
              const storageKey = localStorage.key(i);
              if (storageKey && !keysToPreserve.includes(storageKey) && storageKey.startsWith('mb_')) {
                localStorage.removeItem(storageKey);
              }
            }
            // 重试写入
            localStorage.setItem(key, JSON.stringify(resolved));
          } catch {
            console.error('[useStorage] 清理后仍无法写入本地存储');
          }
        }
      }
      return resolved;
    });
  }, [key]);

  return [value, update] as const;
}
