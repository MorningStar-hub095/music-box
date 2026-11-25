import { useEffect, useState } from 'react';
import { socialDnaApi, SocialMatch, SocialDnaData } from '../services/api';

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

// 12 维向量构成：情绪 DNA 8 维（频段偏好）+ 基因图谱质心 4 维
// 顺序与后端 social-dna.service.ts 中 EMO_KEYS + [genomeX, genomeY, bpm, energy] 严格一致
const DNA_DIMENSIONS = [
  { name: '超低频', en: 'Sub Bass', range: '20-60Hz', desc: '鼓点与低频冲击力的偏好程度' },
  { name: '低频', en: 'Bass', range: '60-250Hz', desc: '贝斯与低音厚度的偏好程度' },
  { name: '中低频', en: 'Low Mid', range: '250-500Hz', desc: '声音温暖度与饱满度' },
  { name: '中频', en: 'Mid', range: '500-2kHz', desc: '人声与旋律主体的偏好程度' },
  { name: '中高频', en: 'High Mid', range: '2-4kHz', desc: '声音清晰度与存在感' },
  { name: '临场感', en: 'Presence', range: '4-6kHz', desc: '声音贴近与临场感的程度' },
  { name: '明亮度', en: 'Brilliance', range: '6-20kHz', desc: '高频亮度与细节丰富度' },
  { name: '空气感', en: 'Air', range: '20kHz+', desc: '极高频空气感与空间通透度' },
  { name: '基因图谱X', en: 'Genome X', range: 'PCA', desc: '声学特征空间横坐标（PCA 降维结果）' },
  { name: '基因图谱Y', en: 'Genome Y', range: 'PCA', desc: '声学特征空间纵坐标（PCA 降维结果）' },
  { name: '节奏', en: 'BPM', range: '归一化', desc: '歌曲速度，值越高节奏越快' },
  { name: '能量', en: 'Energy', range: '归一化', desc: '音频能量与力度，值越高越强烈' },
];

const KEYFRAMES = `
@keyframes sd-fadeInUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes sd-pulse{0%,100%{opacity:.35}50%{opacity:.75}}
@keyframes sd-barGrow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes sd-glow{0%,100%{box-shadow:0 0 12px rgba(23,195,178,.25),0 0 24px rgba(23,195,178,.1)}50%{box-shadow:0 0 20px rgba(23,195,178,.4),0 0 40px rgba(23,195,178,.15)}}
@keyframes sd-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
`;

export default function SocialDna() {
  // 修复: 使用 SocialDnaData 接口（已扩展 eventCount/insufficient/insufficientMessage/updatedAt 字段）
  const [data, setData] = useState<SocialDnaData | null>(null);
  const [matches, setMatches] = useState<SocialMatch[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await socialDnaApi.get();
      setData(d);
    } catch (e) {
      console.error('[SocialDna] 加载失败', e);
      setError(e instanceof Error ? e.message : '加载社交DNA失败');
      setData(null);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  /* ── skeleton ── */
  if (loading) {
    const sk = (w: number, h: number, delay = 0, radius = 6): React.CSSProperties => ({
      width: w, height: h, background: C.border, borderRadius: radius,
      animation: `sd-pulse 1.5s ease-in-out ${delay}s infinite`,
    });
    return (
      <div style={{ minHeight: '400px', background: C.bg, padding: 24 }}>
        <style>{KEYFRAMES}</style>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 32, boxShadow: '0 4px 24px rgba(0,0,0,.3)' }}>
            <div style={sk(240, 28, 0)} />
            <div style={{ ...sk(340, 14, 0.15), marginTop: 12 }} />
            <div style={{ display: 'flex', gap: 24, marginTop: 28, flexWrap: 'wrap' }}>
              <div style={sk(220, 220, 0.3, 12)} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ ...sk(120, 20, 0.4), marginBottom: 16 }} />
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 140 }}>
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} style={{ ...sk(14, 60 + Math.random() * 60, 0.05 * i, 3) }} />
                  ))}
                </div>
              </div>
            </div>
            <div style={{ ...sk(160, 40, 0.8, 8), marginTop: 28 }} />
          </div>
        </div>
      </div>
    );
  }

  /* ── empty ── */
  // 修复: 原 !data 判断对全零向量无效（全零向量仍会返回 data 对象）
  // 现增加 insufficient 标记和 eventCount 判断
  if (!data || data.insufficient || (data.eventCount !== undefined && data.eventCount < 5)) {
    return (
      <div style={{ minHeight: '400px', background: C.bg, padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{KEYFRAMES}</style>
        <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 48, textAlign: 'center', maxWidth: 400, boxShadow: '0 4px 24px rgba(0,0,0,.3)' }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" style={{ display: 'block', margin: '0 auto 20px' }}>
            <circle cx="12" cy="8" r="4" stroke={error ? '#ef4444' : C.primary} strokeWidth="1.5" opacity=".5" />
            <path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke={error ? '#ef4444' : C.primary} strokeWidth="1.5" strokeLinecap="round" opacity=".5" />
            <circle cx="20" cy="8" r="2" stroke={C.accent} strokeWidth="1" opacity=".35" />
          </svg>
          {error ? (
            <>
              <div style={{ color: '#ef4444', fontSize: 15, marginBottom: 8 }}>加载失败</div>
              <div style={{ color: C.textMuted, fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>{error}</div>
              <button onClick={loadData} style={{ padding: '8px 24px', background: C.primary, color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>重试</button>
            </>
          ) : (
            <>
              <div style={{ color: C.textSec, fontSize: 16, marginBottom: 8 }}>暂无社交 DNA</div>
              {/* 修复: 使用后端返回的 insufficientMessage 提示具体阈值 */}
              <div style={{ color: C.textMuted, fontSize: 13, lineHeight: 1.6 }}>
                {data?.insufficientMessage || '多听歌后系统会自动生成你的声学社交暗号（至少需要 5 条聆听记录）'}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const onMatch = async () => {
    setMatching(true);
    setMatchError(false);
    try {
      setMatches(await socialDnaApi.match(10));
    } catch {
      setMatches([]);
      setMatchError(true);
    }
    setMatching(false);
  };

  const btnBase: React.CSSProperties = {
    padding: '10px 28px', background: matching ? C.bg : C.primary,
    color: matching ? C.textSec : '#000', border: `1px solid ${matching ? C.border : C.primary}`,
    borderRadius: 8, cursor: matching ? 'not-allowed' : 'pointer',
    fontSize: 14, fontWeight: 600, transition: 'all .2s',
    display: 'inline-flex', alignItems: 'center', gap: 8,
  };

  const rankColors = [C.accent, '#c0c0c0', '#cd7f32'];

  return (
    <div style={{ minHeight: '400px', background: C.bg, padding: '24px 16px' }}>
      <style>{KEYFRAMES}</style>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{
          background: C.card, borderRadius: 12, border: `1px solid ${C.border}`,
          padding: 32, boxShadow: '0 4px 24px rgba(0,0,0,.3)',
          animation: 'sd-fadeInUp .6s ease-out',
        }}>
          {/* header */}
          <h2 style={{ margin: '0 0 8px', fontSize: 22, color: C.text, fontWeight: 700 }}>
            <span style={{ color: C.primary, marginRight: 8 }}>◆</span>声学社交 DNA 暗号
          </h2>
          <p style={{ color: C.textSec, margin: '0 0 28px', fontSize: 13 }}>
            基于聆听偏好生成的 12 维向量暗号，用于寻找互补灵魂
          </p>

          {/* cipher + bar chart */}
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 28 }}>
            {/* cipher SVG with glow */}
            <div style={{
              width: 220, height: 220, borderRadius: 12, overflow: 'hidden',
              border: `1px solid ${C.border}`, background: C.bg,
              animation: 'sd-glow 3s ease-in-out infinite',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <div
                dangerouslySetInnerHTML={{ __html: data.cipherSvg }}
                style={{ width: 200, height: 200 }}
              />
            </div>

            {/* 12-dim bar chart */}
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ color: C.text, fontSize: 15, fontWeight: 600, marginBottom: 16 }}>12 维向量</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4 }}>
                {data.vector.map((val, i) => {
                  const h = Math.max(4, ((val + 1) / 2) * 120);
                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                      <div style={{ color: C.textMuted, fontSize: 9, marginBottom: 3 }}>{val.toFixed(1)}</div>
                      <div style={{
                        width: '100%', maxWidth: 16, height: h,
                        background: `linear-gradient(to top, ${C.primary}, ${C.accent})`,
                        borderRadius: '3px 3px 0 0',
                        transformOrigin: 'bottom',
                        animation: `sd-barGrow .6s ease-out ${i * .06}s both`,
                      }} />
                      <div style={{
                        color: C.textMuted, fontSize: 8, marginTop: 4,
                        writingMode: 'vertical-rl', textOrientation: 'upright',
                        letterSpacing: 1, whiteSpace: 'nowrap',
                      }}>{DNA_DIMENSIONS[i].name}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ color: C.textMuted, fontSize: 11, marginTop: 8, textAlign: 'center' }}>
                共 {data.vector.length} 维
              </div>
            </div>
          </div>

          {/* 12 维向量详细说明 */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ color: C.text, fontSize: 15, fontWeight: 600, marginBottom: 12 }}>12 维向量说明</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {DNA_DIMENSIONS.map((d, i) => (
                <div key={d.en} style={{
                  background: C.bg, borderRadius: 8, border: `1px solid ${C.border}`,
                  padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start',
                }}>
                  <div style={{
                    color: C.primary, fontWeight: 700, fontSize: 12, flexShrink: 0,
                    minWidth: 20, textAlign: 'center', marginTop: 1,
                  }}>{i + 1}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>
                      {d.name}
                      <span style={{ color: C.textMuted, fontWeight: 400, fontSize: 11, marginLeft: 6 }}>{d.en}</span>
                      <span style={{ color: C.accent, fontWeight: 400, fontSize: 11, marginLeft: 6 }}>{d.range}</span>
                    </div>
                    <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.5, marginTop: 2 }}>{d.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* match button */}
          <button
            onClick={onMatch}
            disabled={matching}
            style={btnBase}
            onMouseEnter={e => { if (!matching) { const t = e.currentTarget; t.style.background = '#14a89b'; t.style.transform = 'translateY(-1px)'; t.style.boxShadow = '0 4px 14px rgba(23,195,178,.35)'; } }}
            onMouseLeave={e => { if (!matching) { const t = e.currentTarget; t.style.background = C.primary; t.style.transform = 'translateY(0)'; t.style.boxShadow = 'none'; } }}
          >
            {matching && (
              <svg width="16" height="16" viewBox="0 0 24 24" style={{ animation: 'sd-spin 1s linear infinite' }}>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" />
              </svg>
            )}
            {matching ? '寻找中…' : '寻找互补灵魂'}
          </button>

          {/* match results */}
          {matches && (
            <div style={{ marginTop: 28 }}>
              <div style={{ color: C.text, fontSize: 15, fontWeight: 600, marginBottom: 14 }}>
                互补灵魂 Top{matches.length}
              </div>
              {matches.length === 0 ? (
                <div style={{
                  padding: 24, background: C.bg, borderRadius: 8,
                  border: `1px solid ${C.border}`, textAlign: 'center',
                  color: matchError ? '#ef4444' : C.textSec, fontSize: 13,
                }}>
                  {matchError ? '匹配失败，稍后再试' : '暂无其他用户'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {matches.map((m, idx) => {
                    const pct = (m.complement * 100).toFixed(0);
                    const isTop3 = idx < 3;
                    const barColor = m.complement > 0.7
                      ? `linear-gradient(90deg,${C.primary},#2dd4bf)`
                      : m.complement > 0.4
                        ? `linear-gradient(90deg,${C.accent},#f59e0b)`
                        : '#4a4a6a';
                    return (
                      <div
                        key={m.userId}
                        style={{
                          padding: '14px 18px', background: C.bg, borderRadius: 10,
                          border: `1px solid ${isTop3 ? (idx === 0 ? C.accent : idx === 1 ? '#c0c0c0' : '#cd7f32') : C.border}`,
                          display: 'flex', alignItems: 'center', gap: 14,
                          animation: `sd-fadeInUp .4s ease-out ${idx * .06}s both`,
                        }}
                      >
                        {/* rank badge */}
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                          background: isTop3 ? rankColors[idx] : C.border,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 14, fontWeight: 700,
                          color: isTop3 ? '#000' : C.textSec,
                        }}>
                          {idx + 1}
                        </div>
                        {/* info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: C.text, fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
                            用户 #{m.userId}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{
                                height: '100%', width: `${pct}%`, borderRadius: 3,
                                background: barColor, transition: 'width .8s ease-out',
                              }} />
                            </div>
                            <div style={{
                              color: m.complement > 0.6 ? C.primary : m.complement > 0.3 ? C.accent : C.textMuted,
                              fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                            }}>
                              {pct}%
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
