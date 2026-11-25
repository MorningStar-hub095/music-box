import { Track } from './types';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface AudioVerificationResult {
  accessible: boolean;
  size?: number;
  error?: string;
}

/**
 * 本地验证歌曲信息
 */
export function validateTrack(track: Track): ValidationResult {
  // 检查 playable 字段
  if (track.playable === false) {
    return { valid: false, error: '歌曲不可播放' };
  }

  // 检查 audioUrl
  if (!track.audioUrl || track.audioUrl.trim() === '') {
    return { valid: false, error: '歌曲音频链接为空' };
  }

  // 检查是否为示例URL
  if (track.audioUrl.includes('example.com')) {
    return { valid: false, error: '歌曲音频链接无效' };
  }

  // 检查 duration
  if (!track.duration || track.duration <= 0) {
    return { valid: false, error: '歌曲时长信息缺失' };
  }

  return { valid: true };
}

/**
 * 实时验证音频URL可访问性
 */
export async function verifyAudioUrl(url: string, timeout: number = 5000): Promise<AudioVerificationResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        accessible: false,
        error: `音频链接不可访问 (${response.status})`,
      };
    }

    const contentLength = response.headers.get('Content-Length');
    const size = contentLength ? parseInt(contentLength, 10) : undefined;

    // 检查文件大小（排除45秒预览，通常 < 1MB）
    if (size && size < 1024 * 1024) {
      return {
        accessible: false,
        size,
        error: '音频文件过小，可能为预览版本',
      };
    }

    return { accessible: true, size };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { accessible: false, error: '网络请求超时' };
    }
    return {
      accessible: false,
      error: `网络错误: ${error.message}`,
    };
  }
}

/**
 * 完整验证歌曲（本地 + 实时）
 */
export async function validateTrackFull(track: Track): Promise<ValidationResult> {
  // 第一层：本地验证
  const localResult = validateTrack(track);
  if (!localResult.valid) {
    return localResult;
  }

  // 第二层：实时验证
  const audioResult = await verifyAudioUrl(track.audioUrl);
  if (!audioResult.accessible) {
    return { valid: false, error: audioResult.error };
  }

  return { valid: true };
}
