/**
 * LLM Provider Factory
 * 根据配置创建对应的 LLM 提供商实例
 */

import type { ILLMProvider, LLMProviderConfig, LLMProviderType } from './llm-provider.interface';
import { OllamaProvider } from './providers/ollama.provider';
import { OpenAIProvider } from './providers/openai.provider';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';

/** OpenAI 兼容提供商的默认 baseURL 与默认模型（可按需覆盖） */
const COMPATIBLE_PRESETS: Record<string, { baseURL: string; defaultModel: string }> = {
  deepseek: { baseURL: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  qwen: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
  glm: { baseURL: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash' },
  kimi: { baseURL: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k' },
};

/** 提供商注册表（便于扩展新提供商） */
const providerRegistry: Record<LLMProviderType, new (config: LLMProviderConfig) => ILLMProvider> = {
  ollama: OllamaProvider,
  openai: OpenAIProvider,
  deepseek: OpenAICompatibleProvider,
  qwen: OpenAICompatibleProvider,
  glm: OpenAICompatibleProvider,
  kimi: OpenAICompatibleProvider,
  custom: OpenAICompatibleProvider,
};

/** 从环境变量读取配置 */
function loadConfigFromEnv(): LLMProviderConfig {
  const type = (process.env.LLM_PROVIDER as LLMProviderType) || 'ollama';
  const temperature = process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : 0.7;
  const maxTokens = process.env.LLM_MAX_TOKENS ? parseInt(process.env.LLM_MAX_TOKENS) : 2000;

  if (type === 'ollama') {
    return {
      type: 'ollama',
      model: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      temperature,
    };
  }

  if (type === 'openai') {
    return {
      type: 'openai',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      apiKey: process.env.OPENAI_API_KEY,
      temperature,
      maxTokens,
    };
  }

  // OpenAI 兼容提供商（deepseek / qwen / glm / kimi / custom）
  const preset = COMPATIBLE_PRESETS[type];
  return {
    type,
    model: process.env.LLM_MODEL || preset?.defaultModel || '',
    baseUrl: process.env.LLM_BASE_URL || preset?.baseURL || '',
    apiKey: process.env.LLM_API_KEY,
    temperature,
    maxTokens,
  };
}

/** 全局单例 */
let currentProvider: ILLMProvider | null = null;

/**
 * 获取当前 LLM 提供商实例（单例）
 */
export function getProvider(): ILLMProvider {
  if (!currentProvider) {
    const config = loadConfigFromEnv();
    const ProviderClass = providerRegistry[config.type];
    if (!ProviderClass) {
      throw new Error(`不支持的 LLM 提供商: ${config.type}，支持的类型: ${Object.keys(providerRegistry).join(', ')}`);
    }
    currentProvider = new ProviderClass(config);
  }
  return currentProvider;
}

/**
 * 切换 LLM 提供商（运行时切换）
 */
export function switchProvider(type: LLMProviderType, overrides?: Partial<LLMProviderConfig>): ILLMProvider {
  const config = { ...loadConfigFromEnv(), type, ...overrides };
  const ProviderClass = providerRegistry[config.type];
  if (!ProviderClass) {
    throw new Error(`不支持的 LLM 提供商: ${config.type}`);
  }
  currentProvider = new ProviderClass(config);
  console.log(`[LLM] 已切换到 ${type} 提供商`);
  return currentProvider;
}

/**
 * 注册新的 LLM 提供商（扩展点）
 */
export function registerProvider(type: string, providerClass: new (config: LLMProviderConfig) => ILLMProvider) {
  (providerRegistry as any)[type] = providerClass;
  console.log(`[LLM] 已注册新提供商: ${type}`);
}

/**
 * 获取所有已注册的提供商类型
 */
export function getRegisteredProviders(): string[] {
  return Object.keys(providerRegistry);
}
