import { useState, useCallback, useMemo, useRef } from 'react';
import { authApi, UserInfo, isNetworkError } from '../services/api';
import './LoginPage.css';

interface LoginPageProps {
  onAuth: (token: string, user: UserInfo) => void;
}

// SVG 图标组件
const EyeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const EyeOffIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const UserIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
);

const HelpCircleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);

const MusicIcon = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5.5" cy="17.5" r="2.5"/>
    <circle cx="17.5" cy="15.5" r="2.5"/>
    <path d="M8 17.5V5l12-2v12.5"/>
  </svg>
);

// 密码强度计算
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

export default function LoginPage({ onAuth }: LoginPageProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState('你的第一只宠物叫什么？');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [isNetworkErr, setIsNetworkErr] = useState(false);

  // 表单验证（仅用于实时显示提示，不阻塞提交）
  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (username && username.length < 3) {
      errors.username = '用户名至少3个字符';
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = '请输入有效的邮箱地址';
    }
    if (password && password.length < 6) {
      errors.password = '密码至少6个字符';
    }
    if (mode === 'register' && confirmPassword && confirmPassword !== password) {
      errors.confirmPassword = '两次输入的密码不一致';
    }
    return errors;
  }, [username, email, password, mode, confirmPassword]);

  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);

  // 验证函数（用于提交前校验，不依赖 memo）
  const validate = useCallback((m: 'login' | 'register'): string | null => {
    if (username.trim().length < 3) return '用户名至少3个字符';
    if (m === 'register' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return '请输入有效的邮箱地址';
    if (password.length < 6) return '密码至少6个字符';
    if (m === 'register' && password !== confirmPassword) return '两次输入的密码不一致';
    return null;
  }, [username, email, password, confirmPassword]);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsNetworkErr(false);
    const validationError = validate('login');
    if (validationError) { setError(validationError); return; }
    setLoading(true);
    try {
      const result = await authApi.login(username.trim(), password);
      localStorage.setItem('mb_token', result.token);
      onAuth(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请检查用户名和密码');
      setIsNetworkErr(isNetworkError(err));
    } finally {
      setLoading(false);
    }
  }, [username, password, validate, onAuth]);

  const handleRegister = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsNetworkErr(false);
    const validationError = validate('register');
    if (validationError) { setError(validationError); return; }
    setLoading(true);
    try {
      await authApi.register({
        username: username.trim(),
        email: email.trim(),
        password,
        securityQuestion,
        securityAnswer: securityAnswer.trim() || '默认答案',
      });
      // 注册成功 → 切换到登录模式，提示用户登录
      setSuccess('注册成功！请使用新账号登录');
      setMode('login');
      setPassword('');
      setEmail('');
      setSecurityAnswer('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败，请稍后重试');
      setIsNetworkErr(isNetworkError(err));
    } finally {
      setLoading(false);
    }
  }, [username, email, password, securityQuestion, securityAnswer, validate]);

  const handleGuest = useCallback(async () => {
    setError('');
    setSuccess('');
    setIsNetworkErr(false);
    setGuestLoading(true);
    try {
      const result = await authApi.guest();
      localStorage.setItem('mb_token', result.token);
      onAuth(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '访客登录失败，请稍后重试');
      setIsNetworkErr(isNetworkError(err));
    } finally {
      setGuestLoading(false);
    }
  }, [onAuth]);

  const switchMode = useCallback((newMode: 'login' | 'register') => {
    setMode(newMode);
    setError('');
    setSuccess('');
    setIsNetworkErr(false);
    setConfirmPassword('');
  }, []);

  const isFormValid = useMemo(() => {
    if (mode === 'login') {
      return username.length >= 3 && password.length >= 6;
    }
    return (
      username.length >= 3 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
      password.length >= 6 &&
      confirmPassword.length > 0 &&
      password === confirmPassword
    );
  }, [mode, username, email, password, confirmPassword]);

  return (
    <div className="lp-page">
      <div className="lp-card">
        {/* Logo */}
        <div className="lp-logo">
          <div className="lp-logo-icon">
            <MusicIcon />
          </div>
          <h1>音乐盒子</h1>
          <p>{mode === 'login' ? '登录以体验完整功能' : '创建账号开始你的音乐之旅'}</p>
        </div>

        {/* Tab 切换 */}
        <div className="lp-tabs" role="tablist">
          <button
            className={`lp-tab ${mode === 'login' ? 'lp-tab--active' : ''}`}
            onClick={() => switchMode('login')}
            role="tab"
            aria-selected={mode === 'login'}
            aria-controls="login-form"
          >
            登录
          </button>
          <button
            className={`lp-tab ${mode === 'register' ? 'lp-tab--active' : ''}`}
            onClick={() => switchMode('register')}
            role="tab"
            aria-selected={mode === 'register'}
            aria-controls="register-form"
          >
            注册
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className={`lp-message ${isNetworkErr ? 'lp-message--warning' : 'lp-message--error'}`} role="alert">
            <span className="lp-message-icon"><AlertIcon /></span>
            <span className="lp-message-text">{error}</span>
            <button className="lp-message-close" onClick={() => { setError(''); setIsNetworkErr(false); }} aria-label="关闭">
              <CloseIcon />
            </button>
          </div>
        )}

        {/* 成功提示 */}
        {success && (
          <div className="lp-message lp-message--success" role="status">
            <span className="lp-message-icon"><AlertIcon /></span>
            <span className="lp-message-text">{success}</span>
          </div>
        )}

        {/* 表单 */}
        <form
          className="lp-form"
          id={mode === 'login' ? 'login-form' : 'register-form'}
          onSubmit={mode === 'login' ? handleLogin : handleRegister}
          noValidate
        >
          {/* 用户名 */}
          <div className="lp-field">
            <label className="lp-label" htmlFor="username">
              <span className="lp-label-text">
                <UserIcon />
                用户名
              </span>
              <span className="lp-label-hint">3-32个字符</span>
            </label>
            <div className="lp-input-wrap">
              <input
                id="username"
                type="text"
                className="lp-input"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="输入用户名"
                minLength={3}
                maxLength={32}
                required
                autoComplete="username"
                aria-invalid={!!fieldErrors.username}
                aria-describedby={fieldErrors.username ? 'username-error' : undefined}
              />
            </div>
            {fieldErrors.username && (
              <div className="lp-field-error" id="username-error">
                <AlertIcon />
                {fieldErrors.username}
              </div>
            )}
          </div>

          {/* 邮箱（仅注册） */}
          {mode === 'register' && (
            <div className="lp-field">
              <label className="lp-label" htmlFor="email">
                <span className="lp-label-text">邮箱</span>
              </label>
              <div className="lp-input-wrap">
                <input
                  id="email"
                  type="email"
                  className="lp-input"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  autoComplete="email"
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                />
              </div>
              {fieldErrors.email && (
                <div className="lp-field-error" id="email-error">
                  <AlertIcon />
                  {fieldErrors.email}
                </div>
              )}
            </div>
          )}

          {/* 密码 */}
          <div className="lp-field">
            <label className="lp-label" htmlFor="password">
              <span className="lp-label-text">密码</span>
              <span className="lp-label-hint">至少6个字符</span>
            </label>
            <div className="lp-input-wrap">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="lp-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="输入密码"
                minLength={6}
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                aria-invalid={!!fieldErrors.password}
                aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                style={{ paddingRight: 40 }}
              />
              <button
                type="button"
                className="lp-input-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            {fieldErrors.password && (
              <div className="lp-field-error" id="password-error">
                <AlertIcon />
                {fieldErrors.password}
              </div>
            )}
            {/* 密码强度指示器（仅注册） */}
            {mode === 'register' && password && (
              <>
                <div className="lp-password-strength">
                  {[1, 2, 3].map(level => (
                    <div
                      key={level}
                      className={`lp-password-strength-bar ${
                        passwordStrength.level >= level
                          ? level === 1 ? 'lp-password-strength-bar--weak'
                            : level === 2 ? 'lp-password-strength-bar--medium'
                            : 'lp-password-strength-bar--strong'
                          : ''
                      }`}
                    />
                  ))}
                </div>
                <div className="lp-password-strength-text">
                  密码强度：{passwordStrength.text}
                </div>
              </>
            )}
          </div>

          {/* 确认密码（仅注册） */}
          {mode === 'register' && (
            <div className="lp-field">
              <label className="lp-label" htmlFor="confirm-password">
                <span className="lp-label-text">确认密码</span>
                <span className="lp-label-hint">再次输入密码</span>
              </label>
              <div className="lp-input-wrap">
                <input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  className="lp-input"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="再次输入密码"
                  minLength={6}
                  required
                  autoComplete="new-password"
                  aria-invalid={!!fieldErrors.confirmPassword}
                  aria-describedby={fieldErrors.confirmPassword ? 'confirm-password-error' : undefined}
                  style={{ paddingRight: 40 }}
                />
                <button
                  type="button"
                  className="lp-input-toggle"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? '隐藏密码' : '显示密码'}
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {fieldErrors.confirmPassword && (
                <div className="lp-field-error" id="confirm-password-error">
                  <AlertIcon />
                  {fieldErrors.confirmPassword}
                </div>
              )}
            </div>
          )}

          {/* 安全问题（仅注册） */}
          {mode === 'register' && (
            <>
              <div className="lp-field">
                <label className="lp-label" htmlFor="security-question">
                  <span className="lp-label-text">
                    <HelpCircleIcon />
                    安全问题
                  </span>
                  <span className="lp-label-hint">用于密码找回</span>
                </label>
                <select
                  id="security-question"
                  className="lp-select"
                  value={securityQuestion}
                  onChange={e => setSecurityQuestion(e.target.value)}
                >
                  <option value="你的第一只宠物叫什么？">你的第一只宠物叫什么？</option>
                  <option value="你出生的城市是？">你出生的城市是？</option>
                  <option value="你最喜欢的电影是？">你最喜欢的电影是？</option>
                  <option value="你的小学校名是？">你的小学校名是？</option>
                </select>
              </div>

              <div className="lp-field">
                <label className="lp-label" htmlFor="security-answer">
                  <span className="lp-label-text">安全答案</span>
                </label>
                <div className="lp-input-wrap">
                  <input
                    id="security-answer"
                    type="text"
                    className="lp-input"
                    value={securityAnswer}
                    onChange={e => setSecurityAnswer(e.target.value)}
                    placeholder="输入安全问题的答案"
                    autoComplete="off"
                  />
                </div>
              </div>
            </>
          )}

          {/* 提交按钮 */}
          <button
            type="submit"
            className="lp-btn-primary"
            disabled={loading || !isFormValid}
          >
            {loading && <span className="lp-spinner" />}
            {loading ? '处理中...' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        {/* 分隔线 */}
        <div className="lp-divider">
          <div className="lp-divider-line" />
          <span className="lp-divider-text">或</span>
          <div className="lp-divider-line" />
        </div>

        {/* 访客登录 */}
        <button
          className="lp-btn-ghost"
          onClick={handleGuest}
          disabled={guestLoading}
        >
          {guestLoading && <span className="lp-spinner" />}
          {guestLoading ? '正在创建访客...' : '以访客身份体验'}
        </button>

        <div className="lp-footer">
          <p className="lp-footer-text">访客账号数据将保留在服务器中</p>
        </div>

        {/* 帮助链接 */}
        <div className="lp-help-links">
          {mode === 'login' && (
            <button
              className="lp-help-link"
              onClick={() => setShowForgotModal(true)}
            >
              忘记密码？
            </button>
          )}
          <button
            className="lp-help-link"
            onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? '没有账号？立即注册' : '已有账号？立即登录'}
          </button>
        </div>
      </div>

      {/* 忘记密码模态框 */}
      {showForgotModal && (
        <ForgotPasswordModal
          onClose={() => {
            setShowForgotModal(false);
            setError('');
            setSuccess('密码重置成功！请使用新密码登录');
          }}
        />
      )}
    </div>
  );
}

// ── 忘记密码模态框（两步流程）──
const ForgotPasswordModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [username, setUsername] = useState('');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const newPwdStrength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);
  const modalRef = useRef<HTMLDivElement>(null);

  const resetAll = useCallback(() => {
    setStep(1);
    setUsername('');
    setSecurityAnswer('');
    setNewPassword('');
    setConfirmPassword('');
    setResetToken('');
    setSuccess('');
    setError('');
  }, []);

  const handleOverlayClick = useCallback(() => {
    resetAll();
    onClose();
  }, [resetAll, onClose]);

  const handleVerifyAnswer = useCallback(async () => {
    if (!username.trim() || !securityAnswer.trim()) {
      setError('请填写用户名和安全答案');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await authApi.requestPasswordReset(username.trim(), securityAnswer.trim());
      setResetToken(result.resetToken);
      setStep(2);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '验证失败，请检查用户名和安全答案');
    } finally {
      setLoading(false);
    }
  }, [username, securityAnswer]);

  const handleResetPassword = useCallback(async () => {
    if (newPassword.length < 6) {
      setError('新密码至少需要6个字符');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await authApi.resetPassword(resetToken, newPassword);
      setSuccess('密码重置成功！请使用新密码登录');
      setTimeout(() => {
        resetAll();
        onClose();
      }, 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '密码重置失败');
    } finally {
      setLoading(false);
    }
  }, [newPassword, confirmPassword, resetToken, resetAll, onClose]);

  return (
    <div className="lp-modal-overlay" onClick={handleOverlayClick}>
      <div className="lp-modal" ref={modalRef} onClick={e => e.stopPropagation()}>
        <div className="lp-modal-header">
          <h2 className="lp-modal-title">重置密码</h2>
          <button className="lp-modal-close" onClick={() => { resetAll(); onClose(); }}>
            <CloseIcon />
          </button>
        </div>

        {/* 步骤指示器 */}
        <div className="lp-steps">
          <div className={`lp-step ${step === 1 ? 'lp-step--active' : step === 2 ? 'lp-step--done' : ''}`} />
          <div className={`lp-step ${step === 2 ? 'lp-step--active' : ''}`} />
        </div>

        {success ? (
          <div className="lp-message lp-message--success" role="status">
            <span className="lp-message-icon"><AlertIcon /></span>
            <span className="lp-message-text">{success}</span>
          </div>
        ) : step === 1 ? (
          <>
            <p style={{ color: '#888', fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
              请输入您的用户名和注册时设置的安全答案以验证身份
            </p>
            <div className="lp-field">
              <label className="lp-label" htmlFor="reset-username">
                <span className="lp-label-text">
                  <UserIcon />
                  用户名
                </span>
              </label>
              <div className="lp-input-wrap">
                <input
                  id="reset-username"
                  type="text"
                  className="lp-input"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="请输入注册时的用户名"
                  autoComplete="username"
                />
              </div>
            </div>
            <div className="lp-field">
              <label className="lp-label" htmlFor="reset-answer">
                <span className="lp-label-text">
                  <HelpCircleIcon />
                  安全答案
                </span>
              </label>
              <div className="lp-input-wrap">
                <input
                  id="reset-answer"
                  type="text"
                  className="lp-input"
                  value={securityAnswer}
                  onChange={e => setSecurityAnswer(e.target.value)}
                  placeholder="请输入注册时设置的安全答案"
                  autoComplete="off"
                  onKeyDown={e => { if (e.key === 'Enter') handleVerifyAnswer(); }}
                />
              </div>
            </div>
            {error && (
              <div className="lp-message lp-message--error" role="alert">
                <span className="lp-message-icon"><AlertIcon /></span>
                <span className="lp-message-text">{error}</span>
              </div>
            )}
            <button
              className="lp-btn-primary"
              onClick={handleVerifyAnswer}
              disabled={loading || !username.trim() || !securityAnswer.trim()}
            >
              {loading && <span className="lp-spinner" />}
              {loading ? '验证中...' : '下一步'}
            </button>
          </>
        ) : (
          <>
            <p style={{ color: '#888', fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
              请设置您的新密码
            </p>
            <div className="lp-field">
              <label className="lp-label" htmlFor="new-password">
                <span className="lp-label-text">新密码</span>
                <span className="lp-label-hint">至少6个字符</span>
              </label>
              <div className="lp-input-wrap">
                <input
                  id="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  className="lp-input"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="输入新密码"
                  minLength={6}
                  autoComplete="new-password"
                  style={{ paddingRight: 40 }}
                />
                <button
                  type="button"
                  className="lp-input-toggle"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  aria-label={showNewPassword ? '隐藏密码' : '显示密码'}
                  tabIndex={-1}
                >
                  {showNewPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {newPassword && (
                <>
                  <div className="lp-password-strength">
                    {[1, 2, 3].map(level => (
                      <div
                        key={level}
                        className={`lp-password-strength-bar ${
                          newPwdStrength.level >= level
                            ? level === 1 ? 'lp-password-strength-bar--weak'
                              : level === 2 ? 'lp-password-strength-bar--medium'
                              : 'lp-password-strength-bar--strong'
                            : ''
                        }`}
                      />
                    ))}
                  </div>
                  <div className="lp-password-strength-text">
                    密码强度：{newPwdStrength.text}
                  </div>
                </>
              )}
            </div>
            <div className="lp-field">
              <label className="lp-label" htmlFor="confirm-password">
                <span className="lp-label-text">确认新密码</span>
              </label>
              <div className="lp-input-wrap">
                <input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  className="lp-input"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="再次输入新密码"
                  autoComplete="new-password"
                  style={{ paddingRight: 40 }}
                  onKeyDown={e => { if (e.key === 'Enter') handleResetPassword(); }}
                />
                <button
                  type="button"
                  className="lp-input-toggle"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? '隐藏密码' : '显示密码'}
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>
            {error && (
              <div className="lp-message lp-message--error" role="alert">
                <span className="lp-message-icon"><AlertIcon /></span>
                <span className="lp-message-text">{error}</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="lp-btn-ghost"
                style={{ flex: '0 0 auto', width: 'auto', padding: '13px 20px' }}
                onClick={() => { setStep(1); setError(''); }}
              >
                返回
              </button>
              <button
                className="lp-btn-primary"
                style={{ flex: 1 }}
                onClick={handleResetPassword}
                disabled={loading || newPassword.length < 6 || !confirmPassword}
              >
                {loading && <span className="lp-spinner" />}
                {loading ? '重置中...' : '重置密码'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
