/**
 * LLM Provider 兼容层（重构版）
 * 使用模块化提供商架构，支持 Ollama 和 OpenAI 无缝切换
 *
 * 向后兼容：保留 createLLM()、isLLMConfigured()、getLLMConfig() 接口
 * 新增：getProvider()、switchProvider()、registerProvider() 等模块化接口
 */

// 重新导出模块化接口
export type { ILLMProvider, LLMProviderConfig, LLMProviderType, ProviderHealthStatus } from './llm/llm-provider.interface';
export { getProvider, switchProvider, registerProvider, getRegisteredProviders } from './llm/provider-factory';

// 重新导出提供商实现（便于直接使用）
export { OllamaProvider } from './llm/providers/ollama.provider';
export { OpenAIProvider } from './llm/providers/openai.provider';
export { OpenAICompatibleProvider } from './llm/providers/openai-compatible.provider';

import type { LLMProviderType } from './llm/llm-provider.interface';

// 向后兼容接口
export interface LLMConfig {
  provider: LLMProviderType;
  openaiApiKey?: string;
  openaiModel?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  /** 兼容提供商的统一 API Key（deepseek/qwen/glm/kimi/custom） */
  llmApiKey?: string;
  llmModel?: string;
  llmBaseUrl?: string;
}

/**
 * 获取 LLM 配置（向后兼容）
 */
export function getLLMConfig(): LLMConfig {
  return {
    provider: (process.env.LLM_PROVIDER as LLMProviderType) || 'ollama',
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
    llmApiKey: process.env.LLM_API_KEY,
    llmModel: process.env.LLM_MODEL,
    llmBaseUrl: process.env.LLM_BASE_URL,
  };
}

/**
 * 创建 LLM 实例（向后兼容，内部使用模块化提供商）
 */
export function createLLM() {
  const { getProvider } = require('./llm/provider-factory');
  return getProvider().getLLM();
}

/**
 * 检查 LLM 是否已配置（向后兼容）
 */
export function isLLMConfigured(): boolean {
  const config = getLLMConfig();
  if (config.provider === 'ollama') return true;
  if (config.provider === 'openai') {
    return !!(config.openaiApiKey && config.openaiApiKey !== 'sk-your-api-key-here');
  }
  // 其他 OpenAI 兼容提供商（deepseek / qwen / glm / kimi / custom）
  return !!(config.llmApiKey && config.llmApiKey !== 'sk-your-api-key-here');
}
