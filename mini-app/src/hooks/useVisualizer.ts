// mini-app/src/hooks/useVisualizer.ts - 静态波形占位（小程序无 AudioContext）
import { useState, useCallback } from 'react';

export function useVisualizer() {
  const [isActive, setIsActive] = useState(false);
  const toggle = useCallback(() => setIsActive(prev => !prev), []);
  return { isActive, toggle };
}
