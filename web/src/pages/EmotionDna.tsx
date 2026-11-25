import { useEffect, useState } from 'react';
import { emotionDnaApi, EmotionDnaData } from '../services/api';

const BANDS = ['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance', 'air'] as const;
const LABELS = ['低音下', '低音', '中低', '中频', '中高', '高频', '高音', '空气'];

const C = {
  bg: '#0d0d1a',
  card: '#1a1a2e',
  border: '#2a2a4a',
  primary: '#17C3B2',
  accent: '#FBBF24',
  text: '#eeeeee',
  textSec: '#888888',
  textMuted: '#666666',
};

const KEYFRAMES = `
@keyframes ed-fadeInUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes ed-radarExpand{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes ed-pulse{0%,100%{opacity:.35}50%{opacity:.75}}
@keyframes ed-barGrow{from{width:0}to{width:var(--bar-w)}}
@keyframes ed-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
`;

export default function EmotionDna() {
  const [dna, setDna] = useState<EmotionDnaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await emotionDnaApi.get();
      setDna(data);
    } catch (e) {
      console.error('[EmotionDna] 加载失败', e);
      setError(e instanceof Error ? e.message : '加载情绪DNA失败');
      setDna(null);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  /* ── skeleton ── */
  if (loading) {
    const sk = (w: number, h: number, delay = 0, radius: number | string = 6): React.CSSProperties => ({
      width: w, height: h, background: C.border, borderRadius: radius,
      animation: `ed-pulse 1.5s ease-in-out ${delay}s infinite`,
    });
    return (
      <div style={{ minHeight: '400px', background: C.bg, padding: 24 }}>
        <style>{KEYFRAMES}</style>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 32, boxShadow: '0 4px 24px rgba(0,0,0,.3)' }}>
            <div style={sk(200, 28, 0)} />
            <div style={{ ...sk(320, 14, 0.15), marginTop: 12 }} />
            <div style={{ ...sk(240, 240, 0.3, '50%'), margin: '28px auto' }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginTop: 28 }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={sk(100, 72, 0.1 * i, 8)} />
              ))}
            </div>
            <div style={{ ...sk(120, 40, 0.9, 8), marginTop: 24 }} />
          </div>
        </div>
      </div>
    );
  }

  /* ── empty ── */
  // 修复: 原 !dna.vector 判断对全零向量无效（零向量是合法对象）
  // 现增加 insufficient 标记和 eventCount === 0 判断
  if (!dna || !dna.vector || dna.insufficient || dna.eventCount === 0) {
    return (
      <div style={{ minHeight: '400px', background: C.bg, padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{KEYFRAMES}</style>
        <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 48, textAlign: 'center', maxWidth: 400, boxShadow: '0 4px 24px rgba(0,0,0,.3)' }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" style={{ display: 'block', margin: '0 auto 20px' }}>
            <path d="M9 18V5l12-2v13" stroke={error ? '#ef4444' : C.primary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity=".5" />
            <circle cx="6" cy="18" r="3" stroke={error ? '#ef4444' : C.primary} strokeWidth="1.5" opacity=".5" />
            <circle cx="18" cy="16" r="3" stroke={error ? '#ef4444' : C.primary} strokeWidth="1.5" opacity=".5" />
          </svg>
          {error ? (
            <>
              <div style={{ color: '#ef4444', fontSize: 15, marginBottom: 8 }}>加载失败</div>
              <div style={{ color: C.textMuted, fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>{error}</div>
              <button onClick={load} style={{ padding: '8px 24px', background: C.primary, color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>重试</button>
            </>
          ) : (
            <>
              <div style={{ color: C.textSec, fontSize: 16, marginBottom: 8 }}>暂无情绪指纹数据</div>
              {/* 修复: 使用后端返回的 insufficientMessage 提示具体阈值 */}
              <div style={{ color: C.textMuted, fontSize: 13, lineHeight: 1.6 }}>
                {dna?.insufficientMessage || '多听几首歌，让系统了解你的音乐情绪偏好（至少需要 5 条聆听记录）'}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  /* ── main ── */
  const v = dna.vector;
  const cx = 150, cy = 150, R = 110;
  const pt = (val: number, i: number): [number, number] => {
    const ang = -Math.PI / 2 + i * 2 * Math.PI / 8;
    const rr = R * val;
    return [cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)];
  };
  const poly = BANDS.map((_, i) => pt(v[BANDS[i]], i).join(',')).join(' ');

  const handleRecompute = async () => {
    setComputing(true);
    try {
      await emotionDnaApi.recompute();
      await load();
    } finally {
      setComputing(false);
    }
  };

  const btnBase: React.CSSProperties = {
    padding: '10px 28px', background: computing ? C.bg : C.primary,
    color: computing ? C.textSec : '#000', border: `1px solid ${computing ? C.border : C.primary}`,
    borderRadius: 8, cursor: computing ? 'not-allowed' : 'pointer',
    fontSize: 14, fontWeight: 600, transition: 'all .2s',
    display: 'inline-flex', alignItems: 'center', gap: 8,
  };

  return (
    <div style={{ minHeight: '400px', background: C.bg, padding: '24px 16px' }}>
      <style>{KEYFRAMES}</style>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{
          background: C.card, borderRadius: 12, border: `1px solid ${C.border}`,
          padding: 32, boxShadow: '0 4px 24px rgba(0,0,0,.3)',
          animation: 'ed-fadeInUp .6s ease-out',
        }}>
          {/* header */}
          <h2 style={{ margin: '0 0 8px', fontSize: 22, color: C.text, fontWeight: 700 }}>
            <span style={{ color: C.primary, marginRight: 8 }}>◆</span>情绪 DNA 指纹
          </h2>
          <p style={{ color: C.textSec, margin: '0 0 28px', fontSize: 13 }}>
            基于全部聆听历史的 8 维频段偏好 · 事件 {dna.eventCount ?? 0} 条 · 更新于 {dna.updatedAt ? new Date(dna.updatedAt).toLocaleString() : '未持久化'}
          </p>

          {/* radar */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
            <svg width={300} height={300} style={{ display: 'block', overflow: 'visible' }}>
              <defs>
                <radialGradient id="ed-fill" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={C.primary} stopOpacity=".45" />
                  <stop offset="100%" stopColor={C.primary} stopOpacity=".08" />
                </radialGradient>
                <linearGradient id="ed-stroke" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor={C.primary} />
                  <stop offset="100%" stopColor={C.accent} />
                </linearGradient>
                <filter id="ed-glow">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              {/* grid */}
              {[0.25, 0.5, 0.75, 1].map(g => (
                <polygon
                  key={g}
                  points={BANDS.map((_, i) => {
                    const a = -Math.PI / 2 + i * 2 * Math.PI / 8;
                    return [cx + R * g * Math.cos(a), cy + R * g * Math.sin(a)].join(',');
                  }).join(' ')}
                  fill="none" stroke={C.border} strokeWidth={g === 1 ? 1.2 : 0.7} opacity={g === 1 ? .6 : .35}
                />
              ))}
              {/* axis */}
              {BANDS.map((_, i) => {
                const a = -Math.PI / 2 + i * 2 * Math.PI / 8;
                return <line key={i} x1={cx} y1={cy} x2={cx + R * Math.cos(a)} y2={cy + R * Math.sin(a)} stroke={C.border} strokeWidth={.7} opacity={.4} />;
              })}

              {/* data */}
              <g style={{ transformOrigin: `${cx}px ${cy}px`, animation: 'ed-radarExpand .8s ease-out forwards' }}>
                <polygon points={poly} fill="url(#ed-fill)" stroke="url(#ed-stroke)" strokeWidth={2.5} strokeLinejoin="round" filter="url(#ed-glow)" />
                {BANDS.map((b, i) => {
                  const [px, py] = pt(v[b], i);
                  return (
                    <g key={b}>
                      <circle cx={px} cy={py} r={9} fill={C.primary} opacity={.12} />
                      <circle cx={px} cy={py} r={4} fill={C.primary} stroke={C.card} strokeWidth={2} />
                    </g>
                  );
                })}
              </g>

              {/* labels */}
              {BANDS.map((b, i) => {
                const [lx, ly] = pt(1.2, i);
                return (
                  <text key={b} x={lx} y={ly} fill={C.textSec} fontSize={12} fontWeight={500} textAnchor="middle" dominantBaseline="middle">
                    {LABELS[i]}
                  </text>
                );
              })}
            </svg>
          </div>

          {/* interpretation cards */}
          {dna.interpretation && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 28 }}>
              {dna.interpretation.map((it, idx) => {
                const pct = (it.value * 100).toFixed(0);
                const barColor = it.value > 0.6
                  ? `linear-gradient(90deg,${C.primary},#2dd4bf)`
                  : it.value > 0.3
                    ? `linear-gradient(90deg,${C.accent},#f59e0b)`
                    : '#4a4a6a';
                return (
                  <div key={it.band} style={{
                    padding: '14px 16px', background: C.bg, borderRadius: 8,
                    border: `1px solid ${C.border}`, animation: `ed-fadeInUp .4s ease-out ${idx * .05}s both`,
                  }}>
                    <div style={{ color: C.textMuted, fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: .5 }}>{it.band}</div>
                    <div style={{ color: C.text, fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{it.label}</div>
                    <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 2, background: barColor, transition: 'width .8s ease-out' }} />
                    </div>
                    <div style={{ color: C.textMuted, fontSize: 11, marginTop: 5 }}>{pct}%</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* button */}
          <button
            onClick={handleRecompute}
            disabled={computing}
            style={btnBase}
            onMouseEnter={e => { if (!computing) { const t = e.currentTarget; t.style.background = '#14a89b'; t.style.transform = 'translateY(-1px)'; t.style.boxShadow = '0 4px 14px rgba(23,195,178,.35)'; } }}
            onMouseLeave={e => { if (!computing) { const t = e.currentTarget; t.style.background = C.primary; t.style.transform = 'translateY(0)'; t.style.boxShadow = 'none'; } }}
          >
            {computing && (
              <svg width="16" height="16" viewBox="0 0 24 24" style={{ animation: 'ed-spin 1s linear infinite' }}>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" />
              </svg>
            )}
            {computing ? '计算中…' : '重新计算'}
          </button>
        </div>
      </div>
    </div>
  );
}
