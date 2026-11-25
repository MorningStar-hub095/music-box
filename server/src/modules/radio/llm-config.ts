/**
 * LLM 配置管理：读写 .env、运行时切换 Provider
 * 供 AI 电台界面的「LLM API 配置」功能使用
 */

import fs from 'fs';
import path from 'path';
import { switchProvider, getLLMConfig, isLLMConfigured } from '../../lib/llm-provider';
import { invalidateLLMHealthCache } from '../../lib/llm-health';
import type { LLMProviderType } from '../../lib/llm/llm-provider.interface';
import { clearRadioAgentCache } from './agent';

// 持久化文件路径：桌面安装版通过 MB_ENV_FILE 指向用户数据目录（安装目录不可写）；
// 开发/服务器部署默认落到 server/.env（由 __dirname 上溯定位，编译前后均成立）
const ENV_PATH = process.env.MB_ENV_FILE || path.join(__dirname, '..', '..', '..', '.env');

/** 可用提供商预设（供前端下拉菜单展示） */
export const LLM_PROVIDERS = [
  { value: 'ollama', label: 'Ollama（本地）', defaultModel: 'qwen2.5:7b', defaultBaseUrl: 'http://localhost:11434', needsKey: false },
  { value: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o-mini', defaultBaseUrl: '', needsKey: true },
  { value: 'deepseek', label: 'DeepSeek', defaultModel: 'deepseek-chat', defaultBaseUrl: 'https://api.deepseek.com/v1', needsKey: true },
  { value: 'qwen', label: '通义千问 Qwen', defaultModel: 'qwen-plus', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', needsKey: true },
  { value: 'glm', label: '智谱 GLM', defaultModel: 'glm-4-flash', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', needsKey: true },
  { value: 'kimi', label: 'Moonshot Kimi', defaultModel: 'moonshot-v1-8k', defaultBaseUrl: 'https://api.moonshot.cn/v1', needsKey: true },
  { value: 'custom', label: '自定义（OpenAI 兼容）', defaultModel: '', defaultBaseUrl: '', needsKey: true },
];

function maskKey(key?: string): string {
  if (!key || key === 'sk-your-api-key-here') return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

/** 根据 provider 返回需要写入的环境变量键 */
function envKeys(provider: string) {
  if (provider === 'ollama') return { modelKey: 'OLLAMA_MODEL', baseUrlKey: 'OLLAMA_BASE_URL', apiKeyKey: null as string | null };
  if (provider === 'openai') return { modelKey: 'OPENAI_MODEL', baseUrlKey: null as string | null, apiKeyKey: 'OPENAI_API_KEY' };
  return { modelKey: 'LLM_MODEL', baseUrlKey: 'LLM_BASE_URL', apiKeyKey: 'LLM_API_KEY' };
}

/** 环境变量值清洗：禁止换行注入（防止值中夹带额外的 KEY=VALUE 行） */
function sanitizeEnvValue(value: string): string {
  return String(value).replace(/\r|\n/g, ' ').trim();
}

/** 更新 .env 中的键值（不破坏其他配置，键不存在则追加） */
function updateEnv(entries: Record<string, string>) {
  let content = '';
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  }
  for (const [key, rawValue] of Object.entries(entries)) {
    const value = sanitizeEnvValue(rawValue);
    const line = `${key}=${value}`;
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      content = content.trimEnd() + '\n' + line;
    }
  }
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

/** 读取当前 LLM 配置（脱敏），返回给前端 */
export function getLlmConfigView() {
  const c = getLLMConfig();
  const preset = LLM_PROVIDERS.find(p => p.value === c.provider);

  let model = c.llmModel || preset?.defaultModel || '';
  let baseUrl = c.llmBaseUrl || preset?.defaultBaseUrl || '';
  if (c.provider === 'openai') model = c.openaiModel || model;
  if (c.provider === 'ollama') {
    model = c.ollamaModel || model;
    baseUrl = c.ollamaBaseUrl || baseUrl;
  }
  const apiKey = c.provider === 'openai' ? c.openaiApiKey : c.llmApiKey;

  return {
    provider: c.provider,
    model,
    baseUrl,
    apiKeyMasked: maskKey(apiKey),
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
    timeout: parseInt(process.env.LLM_TIMEOUT || '110', 10),
    configured: isLLMConfigured(),
    providers: LLM_PROVIDERS,
  };
}

/** 保存 LLM 配置：写 .env 持久化 + 更新 process.env + 运行时切换 Provider */
export function saveLlmConfig(input: {
  provider: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
  timeout?: number;
}) {
  const provider = input.provider as LLMProviderType;
  const keys = envKeys(provider);

  const envEntries: Record<string, string> = {
    LLM_PROVIDER: provider,
  };
  if (input.model !== undefined && input.model !== '') envEntries[keys.modelKey] = input.model;
  if (keys.baseUrlKey && input.baseUrl !== undefined && input.baseUrl !== '') envEntries[keys.baseUrlKey] = input.baseUrl;
  if (keys.apiKeyKey && input.apiKey) envEntries[keys.apiKeyKey] = input.apiKey;
  if (input.temperature !== undefined) envEntries.LLM_TEMPERATURE = String(input.temperature);
  if (input.timeout !== undefined) envEntries.LLM_TIMEOUT = String(input.timeout);

  // 1. 更新 process.env（立即生效）
  for (const [k, v] of Object.entries(envEntries)) process.env[k] = v;

  // 2. 持久化到 .env（失败不阻塞，仅本次运行生效）
  try {
    updateEnv(envEntries);
  } catch (e) {
    console.warn('[LLM-CONFIG] 写入 .env 失败（配置仅本次运行生效）:', e instanceof Error ? e.message : e);
  }

  // 3. 运行时切换 Provider（重建 LLM 实例，立即生效，无需重启）
  switchProvider(provider);
  // 4. 清空 Agent 缓存，使下次请求使用新模型
  clearRadioAgentCache();
  // 5. 配置已变更，强制下次健康探针重新探测
  invalidateLLMHealthCache();

  return getLlmConfigView();
}
