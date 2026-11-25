import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useAudioPlayer } from '../useAudioPlayer';

const fetchMock = vi.fn();

describe('useAudioPlayer', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as any);
    vi.stubGlobal('fetch', fetchMock);
  });

  it('初始状态为未播放', () => {
    const { result } = renderHook(() => useAudioPlayer());
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.position).toBe(0);
  });

  it('play 成功设置 isPlaying 为 true', async () => {
    const { result } = renderHook(() => useAudioPlayer());
    await act(async () => {
      result.current.play('https://example.com/a.mp3', 'netease:1');
    });
    expect(result.current.isPlaying).toBe(true);
  });

  it('播放错误触发 /api/refresh-track 刷新请求', async () => {
    fetchMock.mockImplementation((url: any) => {
      if (String(url).includes('/api/refresh-track')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, new_url: 'https://example.com/new.mp3' }) } as any);
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true }) } as any);
    });

    const { result } = renderHook(() => useAudioPlayer());
    await act(async () => {
      result.current.play('https://example.com/bad.mp3', 'netease:2');
    });

    const audio: any = result.current.getAudioElement();
    await act(async () => {
      audio.emit('error');
    });

    await waitFor(() => {
      const refreshCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/refresh-track'));
      expect(refreshCalls.length).toBeGreaterThan(0);
    });
  });

  it('MEDIA_ERR_ABORTED（音源切换）错误不触发刷新请求', async () => {
    const { result } = renderHook(() => useAudioPlayer());
    await act(async () => {
      result.current.play('https://example.com/a.mp3', 'netease:abort');
    });

    const audio: any = result.current.getAudioElement();
    // 模拟 tryPlay 中 removeAttribute('src')/load() 切换音源导致的 MEDIA_ERR_ABORTED(code=1)
    audio.error = { code: 1 };
    await act(async () => {
      audio.emit('error');
    });

    // 不应触发 /api/refresh-track 刷新（否则会误显示「音频URL已失效」）
    const refreshCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/refresh-track'));
    expect(refreshCalls.length).toBe(0);
  });

  it('刷新失败后进入自动切歌倒计时（用户场景）', async () => {
    const onEnded = vi.fn();
    fetchMock.mockImplementation((url: any) => {
      if (String(url).includes('/api/refresh-track')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ success: false }) } as any);
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true }) } as any);
    });

    const { result } = renderHook(() => useAudioPlayer());
    act(() => {
      result.current.setOnEnded(onEnded);
    });

    await act(async () => {
      result.current.play('https://example.com/bad.mp3', 'netease:3');
    });

    const audio: any = result.current.getAudioElement();
    await act(async () => {
      audio.emit('error');
    });

    await waitFor(() => {
      expect(result.current.autoSkipCountdown).toBe(3);
    });
    expect(result.current.error).toContain('自动切换');
  });
});
