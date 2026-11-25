/**
 * RadioPanel - AI 电台对话面板
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { radioAPI, RadioMessage, RadioSession } from '../services/api';
import { useVoiceInput } from '../hooks/useVoiceInput';
import LlmConfigForm from './LlmConfigForm';
import './RadioPanel.css';

interface RadioPanelProps {
  visible: boolean;
  onClose: () => void;
  onPlaySong: (song: any) => void;
  onPlayPlaylist: (songs: any[]) => void;
}

export default function RadioPanel({ visible, onClose, onPlaySong, onPlayPlaylist }: RadioPanelProps) {
  const [sessions, setSessions] = useState<RadioSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<RadioMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isConfigured, setIsConfigured] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // LLM API 配置面板状态
  const [showConfig, setShowConfig] = useState(false);
  // 以下配置表单状态已迁移到 LlmConfigForm（共用组件，见 web/src/components/LlmConfigForm.tsx）
  // const [llmConfig, setLlmConfig] = useState<LlmConfig | null>(null);
  // const [configSaving, setConfigSaving] = useState(false);
  // const [configMsg, setConfigMsg] = useState('');
  // const [formProvider, setFormProvider] = useState('ollama');
  // const [formApiKey, setFormApiKey] = useState('');
  // const [formModel, setFormModel] = useState('');
  // const [formBaseUrl, setFormBaseUrl] = useState('');
  // const [formTemperature, setFormTemperature] = useState(0.7);
  // const [formTimeout, setFormTimeout] = useState(110);

  const { isListening, isSupported, startListening, stopListening } = useVoiceInput({
    onResult: (text) => {
      setInputText(text);
    },
    onError: (err) => {
      alert(err);
    },
  });

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // LLM 配置状态缓存（避免每次打开面板都请求）
  const configCheckedRef = useRef(false);

  // 检查配置状态（仅首次检查）
  useEffect(() => {
    if (visible && !configCheckedRef.current) {
      configCheckedRef.current = true;
      radioAPI.status()
        .then(res => setIsConfigured(res.configured))
        .catch((err) => {
          console.warn('[Radio] 状态检查失败:', err?.message);
          setIsConfigured(true);
        });
      loadSessions();
    }
  }, [visible]);

  // 加载会话列表
  const loadSessions = async () => {
    try {
      const list = await radioAPI.getSessions();
      setSessions(list);
    } catch {}
  };

  // 加载会话消息
  const loadMessages = async (sessionId: string) => {
    try {
      const msgs = await radioAPI.getMessages(sessionId);
      setMessages(msgs);
      setCurrentSessionId(sessionId);
    } catch {}
  };

  // 创建新会话（返回新会话 id，供调用方立即使用，避免依赖异步 setState）
  const handleNewSession = async (): Promise<string | null> => {
    try {
      const session = await radioAPI.createSession();
      setCurrentSessionId(session.id);
      setMessages([]);
      // 会话列表延迟刷新
      loadSessions();
      return session.id;
    } catch {
      return null;
    }
  };

  // 发送消息
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isLoading) return;

    // 首次发送时先创建会话，拿到真实 id（不能用过期的 currentSessionId 闭包值）
    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = await handleNewSession();
    }
    if (!sessionId) return;

    setInputText('');
    setIsLoading(true);

    // 添加用户消息到 UI
    const userMsg: RadioMessage = {
      id: Date.now().toString(),
      sessionId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const result = await radioAPI.sendMessage(sessionId, text);
      setMessages(prev => [...prev, result.message]);

      // 如果有推荐歌曲，显示播放按钮
      if (result.songs && result.songs.length > 0) {
        // songs 已经在 result.message.songs 中了
      }
    } catch (err) {
      const errorMsg: RadioMessage = {
        id: (Date.now() + 1).toString(),
        sessionId: currentSessionId!,
        role: 'assistant',
        content: `抱歉，发生了错误：${err instanceof Error ? err.message : '请稍后重试'}`,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  // 一键电台
  const handleQuickRecommend = async () => {
    setIsLoading(true);
    // 显示加载提示
    const loadingMsg: RadioMessage = {
      id: 'loading',
      sessionId: '0',
      role: 'assistant',
      content: '🎵 正在分析你的音乐品味，AI 正在思考中，请耐心等待...',
      createdAt: new Date().toISOString(),
    };
    setMessages([loadingMsg]);
    try {
      const result = await radioAPI.quickRecommend();
      setCurrentSessionId(result.sessionId);
      setMessages([result.message]);
      // 会话列表延迟刷新，不阻塞主流程
      loadSessions();
    } catch (err) {
      const errorMsg: RadioMessage = {
        id: 'error',
        sessionId: '0',
        role: 'assistant',
        content: `抱歉，推荐失败：${err instanceof Error ? err.message : '请稍后重试'}`,
        createdAt: new Date().toISOString(),
      };
      setMessages([errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  // 删除会话
  const handleDeleteSession = async (sessionId: string) => {
    try {
      await radioAPI.deleteSession(sessionId);
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setMessages([]);
      }
      await loadSessions();
    } catch {}
  };

  // 播放推荐歌曲
  const handlePlaySongs = (songs: any[]) => {
    if (songs.length === 1) {
      onPlaySong(songs[0]);
    } else {
      onPlayPlaylist(songs);
    }
  };

  // 打开 LLM 配置面板（原配置加载逻辑已迁移到 LlmConfigForm）
  const openConfig = () => {
    setShowConfig(true);
  };

  // ==== 已迁移到 LlmConfigForm（保存/切换 provider 逻辑抽离到共用组件）====
  // 保存 LLM 配置
  // const saveConfig = async () => {
  //   setConfigSaving(true);
  //   setConfigMsg('');
  //   try {
  //     const cfg = await radioAPI.saveLlmConfig({
  //       provider: formProvider,
  //       apiKey: formApiKey || undefined,
  //       model: formModel || undefined,
  //       baseUrl: formBaseUrl || undefined,
  //       temperature: formTemperature,
  //       timeout: formTimeout,
  //     });
  //     setLlmConfig(cfg);
  //     setFormApiKey('');
  //     setIsConfigured(cfg.configured);
  //     setConfigMsg('配置已保存并立即生效');
  //   } catch (err) {
  //     setConfigMsg('保存失败：' + (err instanceof Error ? err.message : ''));
  //   } finally {
  //     setConfigSaving(false);
  //   }
  // };

  // 切换 provider 时自动填充默认模型和 baseUrl
  // const handleProviderChange = (value: string) => {
  //   setFormProvider(value);
  //   const preset = llmConfig?.providers?.find(p => p.value === value);
  //   if (preset) {
  //     setFormModel(preset.defaultModel);
  //     setFormBaseUrl(preset.defaultBaseUrl);
  //   }
  // };

  // 键盘发送
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!visible) return null;

  return (
    <div className="radio-panel-overlay" onClick={onClose}>
      <div className="radio-panel" onClick={e => e.stopPropagation()}>
        <div className="radio-panel-header">
          <h3>
            AI 电台
            <span className={`radio-llm-badge${isConfigured ? ' configured' : ''}`} title="LLM API 状态">
              {isConfigured ? 'LLM' : 'LLM 未配置'}
            </span>
          </h3>
          <div className="radio-panel-actions">
            <button onClick={handleQuickRecommend} disabled={isLoading || !isConfigured} title="一键电台">
              ⚡
            </button>
            <button onClick={handleNewSession} title="新建对话">➕</button>
            <button onClick={openConfig} title="LLM API 配置">⚙️</button>
            <button onClick={onClose} title="关闭">✕</button>
          </div>
        </div>

        {showConfig && (
          <div className="radio-config-panel">
            <div className="config-header">
              <span>LLM API 配置</span>
              <button className="config-close" onClick={() => setShowConfig(false)}>✕</button>
            </div>
            <LlmConfigForm onSaved={(cfg) => setIsConfigured(cfg.configured)} />
          </div>
        )}

        {!isConfigured && (
          <div className="radio-panel-warning">
            AI 模型未就绪。请点击右上角 ⚙️ 配置 LLM API，或确认 Ollama 服务正在运行。
          </div>
        )}

        <div className="radio-panel-body">
          <div className="radio-sessions-list">
            {sessions.map(session => (
              <div
                key={session.id}
                className={`radio-session-item ${currentSessionId === session.id ? 'active' : ''}`}
                onClick={() => loadMessages(session.id)}
              >
                <span className="session-title">{session.title || '新对话'}</span>
                <button
                  className="session-delete"
                  onClick={e => { e.stopPropagation(); handleDeleteSession(session.id); }}
                >
                  ✕
                </button>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="radio-sessions-empty">暂无对话</div>
            )}
          </div>

          <div className="radio-chat-area">
            <div className="radio-messages">
              {messages.length === 0 && (
                <div className="radio-welcome">
                  <div className="radio-welcome-icon">🎵</div>
                  <p>你好！我是音乐盒子电台 DJ</p>
                  <p>告诉我你想听什么类型的音乐，或点击 ⚡ 一键推荐</p>
                </div>
              )}
              {messages.map(msg => (
                <div key={msg.id} className={`radio-message radio-message-${msg.role}`}>
                  <div className="message-bubble">
                    <div className="message-content">{msg.content}</div>
                    {msg.songs && msg.songs.length > 0 && (
                      <div className="message-songs">
                        <div className="songs-header">推荐歌曲：</div>
                        {msg.songs.map((song: any, idx: number) => (
                          <div key={idx} className="song-item" onClick={() => onPlaySong(song)}>
                            <span className="song-index">{idx + 1}</span>
                            <span className="song-title">{song.title}</span>
                            <span className="song-artist">{song.artist}</span>
                          </div>
                        ))}
                        <button
                          className="play-all-btn"
                          onClick={() => handlePlaySongs(msg.songs!)}
                        >
                          ▶ 播放全部
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="radio-message radio-message-assistant">
                  <div className="message-bubble">
                    <div className="message-loading">
                      <span className="dot"></span>
                      <span className="dot"></span>
                      <span className="dot"></span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="radio-input-area">
              <textarea
                className="radio-input"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="告诉我你想听什么..."
                disabled={isLoading}
                rows={1}
              />
              {isSupported && (
                <button
                  className={`voice-btn ${isListening ? 'listening' : ''}`}
                  onMouseDown={startListening}
                  onMouseUp={stopListening}
                  onTouchStart={startListening}
                  onTouchEnd={stopListening}
                  title="按住说话"
                >
                  🎤
                </button>
              )}
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={!inputText.trim() || isLoading}
              >
                ➤
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
