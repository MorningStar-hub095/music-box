/**
 * OpenAI 兼容 LLM Provider
 * 通过自定义 baseURL 接入任意 OpenAI 兼容 API（DeepSeek、通义千问、智谱 GLM、Moonshot Kimi 等）
 * 底层复用 LangChain ChatOpenAI，仅改写 baseURL 与健康检查端点
 */

import { ChatOpenAI } from '@langchain/openai';
import type { ILLMProvider, LLMProviderConfig, LLMProviderType, ProviderHealthStatus } from '../llm-provider.interface';
import https from 'https';
import http from 'http';

export class OpenAICompatibleProvider implements ILLMProvider {
  readonly type: LLMProviderType;
  private llm: any;
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
    this.type = config.type;

    if (!config.apiKey || config.apiKey === 'sk-your-api-key-here') {
      console.warn(`[LLM:${config.type}] WARNING: API Key 未配置，AI 电台将无法使用该提供商`);
    }

    this.llm = new ChatOpenAI({
      openAIApiKey: config.apiKey || 'not-set',
      modelName: config.model,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 2000,
      configuration: {
        baseURL: config.baseUrl,
      },
    });
    console.log(`[LLM:${config.type}] 初始化完成: baseURL=${config.baseUrl} model=${config.model}`);
  }

  getLLM(): any {
    return this.llm;
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    const start = Date.now();
    const baseUrl = (this.config.baseUrl || '').replace(/\/$/, '');

    if (!this.config.apiKey || this.config.apiKey === 'sk-your-api-key-here') {
      return {
        healthy: false,
        provider: this.type,
        model: this.config.model,
        error: 'API Key 未配置',
      };
    }

    return new Promise((resolve) => {
      const url = `${baseUrl}/models`;
      const lib = url.startsWith('https') ? https : http;
      const req = lib.get(url, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
        timeout: 10000,
      }, (res) => {
        const latencyMs = Date.now() - start;
        if (res.statusCode === 200) {
          resolve({ healthy: true, provider: this.type, model: this.config.model, latencyMs });
        } else {
          resolve({
            healthy: false,
            provider: this.type,
            model: this.config.model,
            latencyMs,
            error: `API 返回 ${res.statusCode}`,
          });
        }
      });

      req.on('error', (err) => {
        resolve({
          healthy: false,
          provider: this.type,
          model: this.config.model,
          latencyMs: Date.now() - start,
          error: `连接失败: ${err.message}`,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          healthy: false,
          provider: this.type,
          model: this.config.model,
          latencyMs: Date.now() - start,
          error: '连接超时（10秒）',
        });
      });
    });
  }

  getConfig() {
    return {
      type: this.config.type,
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    };
  }
}
