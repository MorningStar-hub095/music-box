/**
 * LLM Provider 统一接口
 * 所有 LLM 提供商必须实现此接口，确保一致的输入输出和错误处理
 */

/** LLM 提供商类型 */
export type LLMProviderType =
  | 'ollama'            // 本地 Ollama（OpenAI 兼容 /v1）
  | 'openai'            // 官方 OpenAI
  | 'deepseek'          // DeepSeek（OpenAI 兼容）
  | 'qwen'              // 阿里云通义千问（OpenAI 兼容）
  | 'glm'               // 智谱 GLM（OpenAI 兼容）
  | 'kimi'              // Moonshot Kimi（OpenAI 兼容）
  | 'custom';           // 自定义 OpenAI 兼容端点

/** LLM 提供商配置 */
export interface LLMProviderConfig {
  type: LLMProviderType;
  /** 模型名称 */
  model: string;
  /** API 基础 URL */
  baseUrl?: string;
  /** API Key（OpenAI 需要） */
  apiKey?: string;
  /** 温度参数 */
  temperature?: number;
  /** 最大 token 数 */
  maxTokens?: number;
}

/** 提供商健康状态 */
export interface ProviderHealthStatus {
  healthy: boolean;
  provider: LLMProviderType;
  model: string;
  latencyMs?: number;
  error?: string;
}

/** LLM 提供商接口 */
export interface ILLMProvider {
  /** 提供商类型 */
  readonly type: LLMProviderType;

  /** 获取 LangChain 兼容的 LLM 实例 */
  getLLM(): any;

  /** 健康检查 */
  healthCheck(): Promise<ProviderHealthStatus>;

  /** 获取当前配置（脱敏） */
  getConfig(): Omit<LLMProviderConfig, 'apiKey'>;
}
