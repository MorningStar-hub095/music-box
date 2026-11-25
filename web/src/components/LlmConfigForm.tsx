/**
 * LlmConfigForm - 共用的 LLM API 配置表单
 * 供 LlmConfigPanel（自动电台）与 RadioPanel（对话电台）复用，消除两套重复配置 UI。
 */
import { useState, useEffect } from 'react';
import { radioAPI, LlmConfig } from '../services/api';
import './LlmConfigPanel.css';

interface LlmConfigFormProps {
  onSaved?: (config: LlmConfig) => void;
}

export default function LlmConfigForm({ onSaved }: LlmConfigFormProps) {
  const [config, setConfig] = useState<LlmConfig | null>(null);
  const [provider, setProvider] = useState('ollama');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [timeout, setTimeoutSec] = useState(110);
  const [explorationRatio, setExplorationRatio] = useState(0.3);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // 挂载时加载当前 LLM 配置与电台探索比例
  useEffect(() => {
    radioAPI.getLlmConfig()
      .then(cfg => {
        setConfig(cfg);
        setProvider(cfg.provider);
        setModel(cfg.model);
        setBaseUrl(cfg.baseUrl);
        setTemperature(cfg.temperature);
        setTimeoutSec(cfg.timeout);
        setApiKey('');
        setMsg('');
      })
      .catch(err => setMsg('加载配置失败：' + (err instanceof Error ? err.message : '')));
    radioAPI.getExplorationRatio()
      .then(r => setExplorationRatio(r.explorationRatio))
      .catch(() => {});
  }, []);

  // 切换提供商时自动填充默认模型与 Base URL
  const handleProviderChange = (value: string) => {
    setProvider(value);
    const preset = config?.providers?.find(p => p.value === value);
    if (preset) {
      setModel(preset.defaultModel);
      setBaseUrl(preset.defaultBaseUrl);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg('');
    try {
      const cfg = await radioAPI.saveLlmConfig({
        provider,
        apiKey: apiKey || undefined,
        model: model || undefined,
        baseUrl: baseUrl || undefined,
        temperature,
        timeout,
      });
      await radioAPI.saveExplorationRatio(explorationRatio);
      setConfig(cfg);
      setApiKey('');
      setMsg('配置已保存并立即生效');
      onSaved?.(cfg);
    } catch (err) {
      setMsg('保存失败：' + (err instanceof Error ? err.message : ''));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="llm-config-form">
      <div className="llm-config-field">
        <label>模型服务（提供商）</label>
        <select value={provider} onChange={e => handleProviderChange(e.target.value)}>
          {(config?.providers || []).map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      <div className="llm-config-field">
        <label>API 密钥 {config?.apiKeyMasked ? `（当前：${config.apiKeyMasked}）` : ''}</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="留空表示不修改"
        />
      </div>

      <div className="llm-config-field">
        <label>模型名称</label>
        <input
          type="text"
          value={model}
          onChange={e => setModel(e.target.value)}
          placeholder="如 deepseek-chat"
        />
      </div>

      {provider === 'custom' && (
        <div className="llm-config-field">
          <label>API Base URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
          />
        </div>
      )}

      <div className="llm-config-field">
        <label>温度（随机性）：{temperature.toFixed(1)}</label>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={temperature}
          onChange={e => setTemperature(parseFloat(e.target.value))}
        />
      </div>

      <div className="llm-config-field">
        <label>探索比例：{(explorationRatio * 100).toFixed(0)}%（越高越多新歌探索，越低越贴合口味）</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={explorationRatio}
          onChange={e => setExplorationRatio(parseFloat(e.target.value))}
        />
      </div>

      <div className="llm-config-field">
        <label>请求超时：{timeout} 秒</label>
        <input
          type="range"
          min="10"
          max="300"
          step="10"
          value={timeout}
          onChange={e => setTimeoutSec(parseInt(e.target.value, 10))}
        />
      </div>

      {msg && <div className="llm-config-msg">{msg}</div>}

      <button className="llm-config-save" onClick={handleSave} disabled={saving}>
        {saving ? '保存中…' : '保存配置'}
      </button>
    </div>
  );
}
