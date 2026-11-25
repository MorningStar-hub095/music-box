/**
 * Ollama LLM Provider
 * 通过 OpenAI 兼容接口调用本地 Ollama 模型
 */

import { ChatOpenAI } from '@langchain/openai';
import type { ILLMProvider, LLMProviderConfig, ProviderHealthStatus } from '../llm-provider.interface';
import http from 'http';

export class OllamaProvider implements ILLMProvider {
  readonly type = 'ollama' as const;
  private llm: any;
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
    this.llm = new ChatOpenAI({
      openAIApiKey: 'ollama',
      modelName: config.model,
      temperature: config.temperature ?? 0.7,
      configuration: {
        baseURL: `${config.baseUrl || 'http://localhost:11434'}/v1`,
      },
    });
    console.log(`[LLM:Ollama] 初始化完成: ${config.baseUrl || 'http://localhost:11434'} model=${config.model}`);
  }

  getLLM(): any {
    return this.llm;
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    const start = Date.now();
    const baseUrl = this.config.baseUrl || 'http://localhost:11434';

    return new Promise((resolve) => {
      const req = http.get(`${baseUrl}/api/tags`, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const latencyMs = Date.now() - start;
          try {
            const models = JSON.parse(data);
            const hasModel = models.models?.some(
              (m: any) => m.name === this.config.model || m.name === this.config.model + ':latest'
            );
            if (hasModel) {
              resolve({ healthy: true, provider: 'ollama', model: this.config.model, latencyMs });
            } else {
              resolve({
                healthy: false,
                provider: 'ollama',
                model: this.config.model,
                latencyMs,
                error: `模型 ${this.config.model} 未找到，可用模型: ${models.models?.map((m: any) => m.name).join(', ')}`,
              });
            }
          } catch {
            resolve({ healthy: false, provider: 'ollama', model: this.config.model, latencyMs, error: '响应解析失败' });
          }
        });
      });

      req.on('error', (err) => {
        resolve({
          healthy: false,
          provider: 'ollama',
          model: this.config.model,
          latencyMs: Date.now() - start,
          error: `Ollama 服务不可达: ${err.message}`,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          healthy: false,
          provider: 'ollama',
          model: this.config.model,
          latencyMs: Date.now() - start,
          error: '连接超时（5秒）',
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
