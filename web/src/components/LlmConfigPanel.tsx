/**
 * LlmConfigPanel - LLM API 配置面板（薄壳容器，表单逻辑见 LlmConfigForm）
 */

import LlmConfigForm from './LlmConfigForm';
import './LlmConfigPanel.css';

interface LlmConfigPanelProps {
  visible: boolean;
  onClose: () => void;
}

export default function LlmConfigPanel({ visible, onClose }: LlmConfigPanelProps) {
  if (!visible) return null;

  return (
    <div className="llm-config-panel">
      <div className="llm-config-header">
        <span>LLM API 配置</span>
        <button className="llm-config-close" onClick={onClose} title="关闭">✕</button>
      </div>
      <LlmConfigForm />
    </div>
  );
}
