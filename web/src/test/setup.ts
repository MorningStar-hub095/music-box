// jsdom 测试环境初始化：补齐缺失的浏览器 API
import { vi } from 'vitest';

// mock Audio 元素（useAudioPlayer 通过 new Audio() 创建，此处提供最小实现）
class MockAudio {
  preload = '';
  crossOrigin: string | null = null;
  src = '';
  error: { code: number } | null = null;
  currentTime = 0;
  duration = NaN;
  paused = true;
  volume = 1;
  listeners: Record<string, ((e?: any) => void)[]> = {};

  addEventListener(type: string, cb: any) {
    (this.listeners[type] ||= []).push(cb);
  }
  removeEventListener(type: string, cb: any) {
    this.listeners[type] = (this.listeners[type] || []).filter(f => f !== cb);
  }
  emit(type: string, e?: any) {
    (this.listeners[type] || []).forEach(cb => cb(e));
  }
  play() { this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.emit('pause'); }
  load() {}
  removeAttribute() {}
}

vi.stubGlobal('Audio', MockAudio);
// jsdom 无 fetch 与 rAF，补齐以避免播放错误上报/高频更新时报错
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ success: true }),
}));
vi.stubGlobal('requestAnimationFrame', () => 0);
vi.stubGlobal('cancelAnimationFrame', () => {});
