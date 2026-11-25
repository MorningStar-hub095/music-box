/**
 * OpenAI LLM Provider
 * 调用 OpenAI 官方 API
 */

import { ChatOpenAI } from '@langchain/openai';
import type { ILLMProvider, LLMProviderConfig, ProviderHealthStatus } from '../llm-provider.interface';
import https from 'https';

export class OpenAIProvider implements ILLMProvider {
  readonly type = 'openai' as const;
  private llm: any;
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;

    if (!config.apiKey || config.apiKey === 'sk-your-api-key-here') {
      console.warn('[LLM:OpenAI] WARNING: API Key 未配置，AI 电台功能将不可用');
      console.warn('[LLM:OpenAI] 请在 server/.env 中设置 OPENAI_API_KEY');
    }

    this.llm = new ChatOpenAI({
      openAIApiKey: config.apiKey,
      modelName: config.model,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 2000,
    });
    console.log(`[LLM:OpenAI] 初始化完成: model=${config.model}`);
  }

  getLLM(): any {
    return this.llm;
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    const start = Date.now();

    if (!this.config.apiKey || this.config.apiKey === 'sk-your-api-key-here') {
      return {
        healthy: false,
        provider: 'openai',
        model: this.config.model,
        error: 'API Key 未配置',
      };
    }

    return new Promise((resolve) => {
      const req = https.get('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
        timeout: 10000,
      }, (res) => {
        const latencyMs = Date.now() - start;
        if (res.statusCode === 200) {
          resolve({ healthy: true, provider: 'openai', model: this.config.model, latencyMs });
        } else {
          resolve({
            healthy: false,
            provider: 'openai',
            model: this.config.model,
            latencyMs,
            error: `API 返回 ${res.statusCode}`,
          });
        }
      });

      req.on('error', (err) => {
        resolve({
          healthy: false,
          provider: 'openai',
          model: this.config.model,
          latencyMs: Date.now() - start,
          error: `连接失败: ${err.message}`,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          healthy: false,
          provider: 'openai',
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
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    };
  }
}
