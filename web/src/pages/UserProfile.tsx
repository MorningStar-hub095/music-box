import { useState, useCallback, useMemo, useEffect, Suspense, lazy } from 'react';
import { authApi, UserInfo, isNetworkError, RecommendedSong } from '@/services/api';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import type { PlayerState } from '@/pages/DailyRecommendation';
import './UserProfile.css';

// 懒加载重型功能组件（拆分为独立 chunk）
const DailyRecommendation = lazy(() => import('@/pages/DailyRecommendation'));
const EmotionDna = lazy(() => import('@/pages/EmotionDna'));
const GenomeMap = lazy(() => import('@/pages/GenomeMap'));
const SocialDna = lazy(() => import('@/pages/SocialDna'));
const CacheManager = lazy(() => import('@/pages/CacheManager'));

interface UserProfileProps {
  user: UserInfo;
  onClose: () => void;
  onLogout: () => void;
  onPlaySong?: (song: RecommendedSong, allSongs: RecommendedSong[]) => void;
  playerState?: PlayerState;
}

type ProfileTab = 'info' | 'security' | 'activity' | 'cache' | 'daily' | 'emotionDna' | 'genome' | 'socialDna';

/** 功能型 Tab（需要更大渲染空间 + 健康监控） */
const FEATURE_TABS: ProfileTab[] = ['daily', 'emotionDna', 'genome', 'socialDna'];
function isFeatureTab(tab: ProfileTab): boolean {
  return FEATURE_TABS.includes(tab);
}

/** API 健康状态类型 */
type HealthStatus = 'unknown' | 'checking' | 'healthy' | 'error';

// 密码强度计算（复用 LoginPage 的逻辑）
function getPasswordStrength(password: string): { level: number; text: string } {
  if (!password) return { level: 0, text: '' };
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 2) return { level: 1, text: '弱' };
  if (score <= 4) return { level: 2, text: '中等' };
  return { level: 3, text: '强' };
}

export default function UserProfile({ user, onClose, onLogout, onPlaySong, playerState }: UserProfileProps) {
  const [activeTab, setActiveTab] = useState<ProfileTab>('info');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  // 健康监控：每个功能 Tab 的后端 API 可达状态
  const [healthMap, setHealthMap] = useState<Record<string, HealthStatus>>({});

  const featureActive = isFeatureTab(activeTab);

  const handleClose = useCallback(() => {
    if (hasUnsavedChanges && !window.confirm('你有未保存的修改，确定要关闭吗？')) {
      return;
    }
    onClose();
  }, [hasUnsavedChanges, onClose]);

  // 切换到功能 Tab 时触发健康检查
  const checkFeatureHealth = useCallback(async (tab: ProfileTab) => {
    setHealthMap(prev => ({ ...prev, [tab]: 'checking' }));
    try {
      // 用 authApi.getMe 作为轻量级健康探针（所有功能API都依赖认证）
      await authApi.getMe();
      setHealthMap(prev => ({ ...prev, [tab]: 'healthy' }));
    } catch {
      setHealthMap(prev => ({ ...prev, [tab]: 'error' }));
    }
  }, []);

  const handleTabSwitch = useCallback((tab: ProfileTab) => {
    if (isFeatureTab(tab)) {
      checkFeatureHealth(tab);
    }
    setActiveTab(tab);
  }, [checkFeatureHealth]);

  // 健康状态指示器颜色
  const healthDot = (tab: ProfileTab): string => {
    const s = healthMap[tab];
    if (s === 'healthy') return '#22c55e';
    if (s === 'checking') return '#FBBF24';
    if (s === 'error') return '#ef4444';
    return '#555';
  };

  return (
    <div className={`up-overlay${featureActive ? ' up-overlay--wide' : ''}`} onClick={handleClose}>
      <div className={`up-modal${featureActive ? ' up-modal--wide' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="up-header">
          <div className="up-header-left">
            <div className="up-avatar">
              {user.username.charAt(0).toUpperCase()}
            </div>
            <div className="up-header-info">
              <h2 className="up-username">{user.username}</h2>
              <span className="up-role">{user.role}</span>
            </div>
          </div>
          <div className="up-header-actions">
            <button className="up-logout-btn" onClick={onLogout} title="退出登录">
              退出
            </button>
            <button className="up-close-btn" onClick={handleClose} title="关闭">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="up-tabs">
          <button
            className={`up-tab ${activeTab === 'info' ? 'up-tab--active' : ''}`}
            onClick={() => handleTabSwitch('info')}
          >
            个人信息
          </button>
          <button
            className={`up-tab ${activeTab === 'security' ? 'up-tab--active' : ''}`}
            onClick={() => handleTabSwitch('security')}
          >
            账户安全
          </button>
          <button
            className={`up-tab ${activeTab === 'activity' ? 'up-tab--active' : ''}`}
            onClick={() => handleTabSwitch('activity')}
          >
            活动记录
          </button>
          <button
            className={`up-tab ${activeTab === 'cache' ? 'up-tab--active' : ''}`}
            onClick={() => handleTabSwitch('cache')}
          >
            缓存管理
          </button>
          <button
            className={`up-tab ${activeTab === 'daily' ? 'up-tab--active' : ''}`}
            onClick={() => handleTabSwitch('daily')}
            onMouseEnter={() => import('@/pages/DailyRecommendation')}
            title="每日推荐"
          >
            每日推荐
            <span className="up-tab-dot" style={{ background: healthDot('daily') }} />
          </button>
          <button
            className={`up-tab ${activeTab === 'emotionDna' ? 'up-tab--active' : ''}`}
            onClick={() => handleTabSwitch('emotionDna')}
            onMouseEnter={() => import('@/pages/EmotionDna')}
            title="情绪DNA"
          >
            情绪DNA
            <span className="up-tab-dot" style={{ background: healthDot('emotionDna') }} />
          </button>
          <button
            className={`up-tab ${activeTab === 'genome' ? 'up-tab--active' : ''}`}
            onClick={() => handleTabSwitch('genome')}
            onMouseEnter={() => import('@/pages/GenomeMap')}
            title="基因图谱"
          >
            基因图谱
            <span className="up-tab-dot" style={{ background: healthDot('genome') }} />
          </button>
          <button
            className={`up-tab ${activeTab === 'socialDna' ? 'up-tab--active' : ''}`}
            onClick={() => handleTabSwitch('socialDna')}
            onMouseEnter={() => import('@/pages/SocialDna')}
            title="社交DNA"
          >
            社交DNA
            <span className="up-tab-dot" style={{ background: healthDot('socialDna') }} />
          </button>
        </div>

        <div className="up-body">
          {/* 原有三个 Tab（表单类，窄布局） */}
          {activeTab === 'info' && <InfoTab user={user} onDirtyChange={setHasUnsavedChanges} />}
          {activeTab === 'security' && <SecurityTab onDirtyChange={setHasUnsavedChanges} />}
          {activeTab === 'activity' && <ActivityTab user={user} />}
          {activeTab === 'cache' && (
            <ErrorBoundary>
              <Suspense fallback={<div className="up-feature-loading"><span>加载缓存管理…</span></div>}>
                <CacheManager />
              </Suspense>
            </ErrorBoundary>
          )}

          {/* 迁移的功能 Tab（懒加载 + ErrorBoundary + 健康监控） */}
          {featureActive && (
            <div className="up-feature-wrap">
              {healthMap[activeTab] === 'error' && (
                <div className="up-health-banner">
                  <span>无法连接服务器，请检查后端是否运行</span>
                  <button onClick={() => checkFeatureHealth(activeTab)}>重试</button>
                </div>
              )}
              <ErrorBoundary>
                <Suspense fallback={
                  <div className="up-feature-loading">
                    <div className="up-feature-spinner" />
                    <span>加载功能模块…</span>
                  </div>
                }>
                  {activeTab === 'daily' && <DailyRecommendation onPlaySong={onPlaySong} playerState={playerState} />}
                  {activeTab === 'emotionDna' && <EmotionDna />}
                  {activeTab === 'genome' && <GenomeMap />}
                  {activeTab === 'socialDna' && <SocialDna />}
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab 1: 个人信息 ──
function InfoTab({ user, onDirtyChange }: { user: UserInfo; onDirtyChange: (dirty: boolean) => void }) {
  const [email, setEmail] = useState(user.email || '');
  const [securityQuestion, setSecurityQuestion] = useState(user.securityQuestion || '你的第一只宠物叫什么？');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isNetworkErr, setIsNetworkErr] = useState(false);

  const hasChanges = useMemo(() => {
    return email !== (user.email || '') ||
      securityQuestion !== (user.securityQuestion || '你的第一只宠物叫什么？') ||
      securityAnswer.length > 0;
  }, [email, securityQuestion, securityAnswer, user]);

  // 通知父组件脏状态变化
  useEffect(() => {
    onDirtyChange(hasChanges);
    return () => onDirtyChange(false);
  }, [hasChanges, onDirtyChange]);

  // 成功提示 2 秒后自动消失
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 2000);
    return () => clearTimeout(timer);
  }, [success]);

  const handleSave = useCallback(async () => {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('请输入有效的邮箱地址');
      return;
    }
    if (securityAnswer.length > 0 && securityAnswer.length < 2) {
      setError('安全答案至少需要2个字符');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    setIsNetworkErr(false);
    try {
      await authApi.updateProfile({
        email: email || undefined,
        securityQuestion,
        securityAnswer: securityAnswer || undefined,
      });
      setSuccess('个人信息已更新');
      setSecurityAnswer('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '更新失败');
      setIsNetworkErr(isNetworkError(e));
    } finally {
      setLoading(false);
    }
  }, [email, securityQuestion, securityAnswer]);

  return (
    <div className="up-tab-content">
      <div className="up-section">
        <h3 className="up-section-title">基本信息</h3>
        <div className="up-field-row">
          <div className="up-field">
            <label className="up-label">用户名</label>
            <input
              type="text"
              className="up-input"
              value={user.username}
              readOnly
              disabled
            />
            <span className="up-field-hint">用户名不可修改</span>
          </div>
          <div className="up-field">
            <label className="up-label">角色</label>
            <input
              type="text"
              className="up-input"
              value={user.role}
              readOnly
              disabled
            />
          </div>
        </div>
      </div>

      <div className="up-section">
        <h3 className="up-section-title">可编辑信息</h3>
        <div className="up-field">
          <label className="up-label">邮箱</label>
          <input
            type="email"
            className="up-input"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="your@email.com"
          />
        </div>
        <div className="up-field">
          <label className="up-label">安全问题</label>
          <select
            className="up-select"
            value={securityQuestion}
            onChange={e => setSecurityQuestion(e.target.value)}
          >
            <option value="你的第一只宠物叫什么？">你的第一只宠物叫什么？</option>
            <option value="你出生的城市是？">你出生的城市是？</option>
            <option value="你最喜欢的电影是？">你最喜欢的电影是？</option>
            <option value="你的小学校名是？">你的小学校名是？</option>
          </select>
        </div>
        <div className="up-field">
          <label className="up-label">安全答案</label>
          <input
            type="text"
            className="up-input"
            value={securityAnswer}
            onChange={e => setSecurityAnswer(e.target.value)}
            placeholder="留空表示不修改（至少2个字符）"
          />
        </div>
      </div>

      {error && (
        <div className="up-message up-message--error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>{error}</span>
          {isNetworkErr && (
            <button className="up-retry-btn" onClick={handleSave}>
              重试
            </button>
          )}
        </div>
      )}
      {success && (
        <div className="up-message up-message--success">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <span>{success}</span>
        </div>
      )}

      <div className="up-actions">
        <button
          className="up-btn-primary"
          onClick={handleSave}
          disabled={loading || !hasChanges}
        >
          {loading && <span className="up-spinner" />}
          {loading ? '保存中...' : '保存修改'}
        </button>
      </div>
    </div>
  );
}

// ── Tab 2: 账户安全 ──
function SecurityTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isNetworkErr, setIsNetworkErr] = useState(false);

  const pwdStrength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);

  const hasChanges = oldPassword.length > 0 || newPassword.length > 0 || confirmPassword.length > 0;

  // 通知父组件脏状态变化
  useEffect(() => {
    onDirtyChange(hasChanges);
    return () => onDirtyChange(false);
  }, [hasChanges, onDirtyChange]);

  // 成功提示 2 秒后自动消失
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 2000);
    return () => clearTimeout(timer);
  }, [success]);

  const canSubmit = oldPassword.length >= 6 && newPassword.length >= 6 && confirmPassword.length > 0;

  const handleChangePassword = useCallback(async () => {
    if (newPassword.length < 6) {
      setError('新密码至少需要6个字符');
      return;
    }
    if (newPassword === oldPassword) {
      setError('新密码不能与旧密码相同');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    setIsNetworkErr(false);
    try {
      await authApi.changePassword(oldPassword, newPassword);
      setSuccess('密码修改成功');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '密码修改失败');
      setIsNetworkErr(isNetworkError(e));
    } finally {
      setLoading(false);
    }
  }, [oldPassword, newPassword, confirmPassword]);

  return (
    <div className="up-tab-content">
      <div className="up-section">
        <h3 className="up-section-title">修改密码</h3>
        <div className="up-field">
          <label className="up-label">当前密码</label>
          <input
            type="password"
            className="up-input"
            value={oldPassword}
            onChange={e => setOldPassword(e.target.value)}
            placeholder="输入当前密码"
            autoComplete="current-password"
          />
        </div>
        <div className="up-field">
          <label className="up-label">新密码</label>
          <input
            type="password"
            className="up-input"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="至少6个字符"
            autoComplete="new-password"
          />
          {newPassword && (
            <>
              <div className="up-pwd-strength">
                {[1, 2, 3].map(level => (
                  <div
                    key={level}
                    className={`up-pwd-strength-bar ${
                      pwdStrength.level >= level
                        ? level === 1 ? 'up-pwd-strength-bar--weak'
                          : level === 2 ? 'up-pwd-strength-bar--medium'
                          : 'up-pwd-strength-bar--strong'
                        : ''
                    }`}
                  />
                ))}
              </div>
              <div className="up-pwd-strength-text">密码强度：{pwdStrength.text}</div>
            </>
          )}
        </div>
        <div className="up-field">
          <label className="up-label">确认新密码</label>
          <input
            type="password"
            className="up-input"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="再次输入新密码"
            autoComplete="new-password"
          />
        </div>
      </div>

      {error && (
        <div className="up-message up-message--error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>{error}</span>
          {isNetworkErr && (
            <button className="up-retry-btn" onClick={handleChangePassword}>
              重试
            </button>
          )}
        </div>
      )}
      {success && (
        <div className="up-message up-message--success">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <span>{success}</span>
        </div>
      )}

      <div className="up-actions">
        <button
          className="up-btn-primary"
          onClick={handleChangePassword}
          disabled={loading || !canSubmit}
        >
          {loading && <span className="up-spinner" />}
          {loading ? '修改中...' : '修改密码'}
        </button>
      </div>
    </div>
  );
}

// ── Tab 3: 活动记录 ──
function ActivityTab({ user }: { user: UserInfo }) {
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '未知';
    try {
      return new Date(dateStr).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="up-tab-content">
      <div className="up-section">
        <h3 className="up-section-title">账户信息</h3>
        <div className="up-info-list">
          <div className="up-info-item">
            <span className="up-info-label">注册时间</span>
            <span className="up-info-value">{formatDate(user.createdAt)}</span>
          </div>
          <div className="up-info-item">
            <span className="up-info-label">最后登录</span>
            <span className="up-info-value">{formatDate(user.lastLoginAt)}</span>
          </div>
          <div className="up-info-item">
            <span className="up-info-label">账号状态</span>
            <span className={`up-info-value up-status ${user.status === 'active' ? 'up-status--active' : ''}`}>
              {user.status === 'active' ? '正常' : user.status === 'disabled' ? '已禁用' : user.status || '正常'}
            </span>
          </div>
          <div className="up-info-item">
            <span className="up-info-label">用户角色</span>
            <span className="up-info-value">{user.role}</span>
          </div>
        </div>
      </div>

      <div className="up-section">
        <h3 className="up-section-title">操作日志</h3>
        <div className="up-empty-hint">
          <span className="up-empty-icon">📋</span>
          <p>暂无操作记录</p>
          <span className="up-empty-sub">后续版本将支持查看详细操作日志</span>
        </div>
      </div>
    </div>
  );
}
