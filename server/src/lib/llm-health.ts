/**
 * LLM 服务可达性健康检查（2026-11-04）
 *
 * 背景：isLLMConfigured() 只校验"配置存在"，不校验"服务可达"。
 * 实测本机 Ollama 未启动时，radio/quick 请求会挂起 30s+ 才失败。
 * 本模块提供带缓存的快速探针：任何 HTTP 响应（含 401/403）都视为可达，
 * 只有网络错误/超时才算不可达。缓存 60 秒，避免高频探测。
 */
import { getLLMConfig } from './llm-provider';

const PROBE_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60_000;

let cachedAt = 0;
let cachedReachable = false;

function probeUrl(): string | null {
  const cfg = getLLMConfig();
  switch (cfg.provider) {
    case 'ollama':
      return `${(cfg.ollamaBaseUrl || 'http://localhost:11434').replace(/\/$/, '')}/api/tags`;
    case 'openai':
      return 'https://api.openai.com/v1/models';
    default:
      // deepseek / qwen / glm / kimi / custom 等 OpenAI 兼容提供商
      if (cfg.llmBaseUrl) return `${cfg.llmBaseUrl.replace(/\/$/, '')}/models`;
      return null; // 无法探测（未配 baseUrl）时视为已配置，不阻塞
  }
}

export async function checkLLMReachable(force = false): Promise<boolean> {
  if (!force && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedReachable;
  }
  const url = probeUrl();
  if (!url) {
    cachedReachable = true;
    cachedAt = Date.now();
    return true;
  }
  try {
    await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // 任何 HTTP 状态码都说明服务在监听
    cachedReachable = true;
  } catch {
    // 网络错误 / 超时 = 不可达
    cachedReachable = false;
  }
  cachedAt = Date.now();
  return cachedReachable;
}

/** 配置变更（switchProvider / saveLlmConfig）后调用，强制下次重新探测 */
export function invalidateLLMHealthCache(): void {
  cachedAt = 0;
}
