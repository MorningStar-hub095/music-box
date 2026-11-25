import { useEffect, useMemo, useState, useCallback, memo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { genomeApi, GenomeStar, GenomeClusterItem } from '../services/api';

// 基因坐标缩放：将 genomeX/Y 映射到 3D 场景坐标
const SCALE = 150;

// 脉冲动画 keyframes（通过 style 标签注入）
const skeletonKeyframes = `
@keyframes gm-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.15; }
}
@keyframes gm-fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes gm-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
@keyframes daily-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;

// 设置 Points 射线拾取阈值，让小点更易点中
function PointsPickThreshold({ threshold }: { threshold: number }) {
  const raycaster = useThree((s) => s.raycaster);
  useEffect(() => {
    raycaster.params.Points = { threshold };
  }, [raycaster, threshold]);
  return null;
}

// 星点组件：使用 memo 避免父组件重渲染时不必要的更新
const StarPoints = memo(function StarPoints({ 
  geometry, 
  visible, 
  onClickStar 
}: { 
  geometry: THREE.BufferGeometry; 
  visible: (GenomeStar & { genomeX: number; genomeY: number })[];
  onClickStar: (id: string) => void;
}) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <points
        geometry={geometry}
        onClick={(e) => {
          e.stopPropagation();
          const i = e.index ?? 0;
          if (visible[i]) onClickStar(visible[i].songId);
        }}
      >
        <pointsMaterial size={6} color="#17C3B2" sizeAttenuation />
      </points>
    </>
  );
});

// 骨架屏组件
function SkeletonScreen() {
  return (
    <>
      <style>{skeletonKeyframes}</style>
      <div style={{
        display: 'flex',
        height: '100%',
        background: '#0d0d1a',
        padding: 20,
        gap: 16,
      }}>
        {/* Canvas 骨架 */}
        <div style={{
          flex: 1,
          borderRadius: 16,
          border: '1px solid #2a2a4a',
          background: '#1a1a2e',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* 标题栏骨架 */}
          <div style={{
            padding: '12px 20px',
            borderBottom: '1px solid #2a2a4a',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <div style={{
              width: 24, height: 24, borderRadius: 6,
              background: '#2a2a4a',
              animation: 'gm-pulse 1.8s ease-in-out infinite',
            }} />
            <div style={{
              width: 100, height: 16, borderRadius: 4,
              background: '#2a2a4a',
              animation: 'gm-pulse 1.8s ease-in-out infinite 0.1s',
            }} />
            <div style={{
              width: 60, height: 14, borderRadius: 4,
              background: '#2a2a4a',
              marginLeft: 'auto',
              animation: 'gm-pulse 1.8s ease-in-out infinite 0.2s',
            }} />
          </div>
          {/* 模拟星点 */}
          {[40, 65, 35, 55, 45, 70, 30, 60].map((left, i) => (
            <div key={i} style={{
              position: 'absolute',
              left: `${left}%`,
              top: `${25 + (i * 9)}%`,
              width: 6 + (i % 3) * 2,
              height: 6 + (i % 3) * 2,
              borderRadius: '50%',
              background: '#17C3B2',
              opacity: 0.15 + (i % 4) * 0.05,
              animation: `gm-pulse 1.8s ease-in-out infinite ${i * 0.15}s`,
            }} />
          ))}
        </div>
        {/* 侧边栏骨架 */}
        <div style={{
          width: 280,
          borderRadius: 16,
          border: '1px solid #2a2a4a',
          background: '#1a1a2e',
          padding: 16,
        }}>
          <div style={{
            width: 120, height: 18, borderRadius: 6,
            background: '#2a2a4a',
            marginBottom: 16,
            animation: 'gm-pulse 1.8s ease-in-out infinite',
          }} />
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{
              height: 48,
              borderRadius: 10,
              background: '#2a2a4a',
              marginBottom: 8,
              animation: `gm-pulse 1.8s ease-in-out infinite ${0.2 + i * 0.1}s`,
            }} />
          ))}
        </div>
      </div>
    </>
  );
}

// 空状态组件
function EmptyState({ error, onRetry }: { error?: string | null; onRetry?: () => void }) {
  return (
    <>
      <style>{skeletonKeyframes}</style>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        background: '#0d0d1a',
        gap: 16,
      }}>
        <div style={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: error ? 'rgba(239, 68, 68, 0.08)' : 'rgba(23, 195, 178, 0.08)',
          border: `1px solid ${error ? 'rgba(239, 68, 68, 0.2)' : 'rgba(23, 195, 178, 0.2)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 36,
          animation: error ? 'none' : 'gm-float 3s ease-in-out infinite',
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={error ? '#ef4444' : '#17C3B2'} strokeWidth="1.5">
            <circle cx="12" cy="12" r="3" />
            <circle cx="5" cy="6" r="1.5" fill={error ? '#ef4444' : '#17C3B2'} opacity="0.5" />
            <circle cx="19" cy="6" r="1.5" fill={error ? '#ef4444' : '#17C3B2'} opacity="0.5" />
            <circle cx="5" cy="18" r="1.5" fill={error ? '#ef4444' : '#17C3B2'} opacity="0.5" />
            <circle cx="19" cy="18" r="1.5" fill={error ? '#ef4444' : '#17C3B2'} opacity="0.5" />
            <line x1="7" y1="7" x2="10" y2="10" stroke={error ? '#ef4444' : '#17C3B2'} opacity="0.3" />
            <line x1="17" y1="7" x2="14" y2="10" stroke={error ? '#ef4444' : '#17C3B2'} opacity="0.3" />
            <line x1="7" y1="17" x2="10" y2="14" stroke={error ? '#ef4444' : '#17C3B2'} opacity="0.3" />
            <line x1="17" y1="17" x2="14" y2="14" stroke={error ? '#ef4444' : '#17C3B2'} opacity="0.3" />
          </svg>
        </div>
        <h3 style={{ margin: 0, color: '#eee', fontSize: 18, fontWeight: 600 }}>{error ? '加载失败' : '暂无基因数据'}</h3>
        <p style={{ margin: 0, color: '#888', fontSize: 14, textAlign: 'center', maxWidth: 280, lineHeight: 1.6 }}>
          {error || '播放更多歌曲后，桌面端会自动上传音乐特征，生成你的专属基因星图'}
        </p>
        {onRetry && (
          <button onClick={onRetry} style={{
            padding: '8px 24px', background: '#17C3B2', color: '#000', border: 'none',
            borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}>重试</button>
        )}
      </div>
    </>
  );
}

export default function GenomeMap() {
  const [stars, setStars] = useState<GenomeStar[]>([]);
  const [cluster, setCluster] = useState<GenomeClusterItem[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await genomeApi.map();
      setStars(d.songs || []);
    } catch (e) {
      console.error('[GenomeMap] 加载失败', e);
      setError(e instanceof Error ? e.message : '加载基因图谱失败');
      setStars([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadMap(); }, [loadMap]);

  const onClickStar = useCallback(async (id: string) => {
    setSel(id);
    setCluster(null);
    try {
      setCluster(await genomeApi.cluster(id));
    } catch {
      setCluster(null);
    }
  }, []);

  // 仅保留有基因坐标的歌
  const visible = useMemo(
    () => stars.filter(
      (s): s is GenomeStar & { genomeX: number; genomeY: number } =>
        s.genomeX != null && s.genomeY != null
    ),
    [stars]
  );

  // 单 BufferGeometry + 单 pointsMaterial：1 draw call（原为每首歌一个 mesh）
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(visible.length * 3);
    visible.forEach((s, i) => {
      arr[i * 3] = s.genomeX * SCALE;
      arr[i * 3 + 1] = s.genomeY * SCALE;
      arr[i * 3 + 2] = 0;
    });
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return geo;
  }, [visible]);

  // stars 更新时释放旧 geometry，避免 GPU 内存泄漏
  useEffect(() => () => { geometry.dispose(); }, [geometry]);

  // 选中星的位置（高亮 mesh 跟随，不 reconcile 全部点）
  const selStar = useMemo(
    () => (sel ? visible.find(s => s.songId === sel) : undefined),
    [sel, visible]
  );

  if (loading) return <SkeletonScreen />;
  if (error || stars.length === 0) return <EmptyState error={error} onRetry={error ? loadMap : undefined} />;

  return (
    <>
      <style>{skeletonKeyframes}</style>
      <div style={{
        display: 'flex',
        height: '100%',
        minHeight: '420px',
        color: '#eee',
        background: '#0d0d1a',
        gap: 16,
        padding: 20,
        boxSizing: 'border-box',
      }}>
        {/* Canvas 区域 */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 16,
          border: '1px solid #2a2a4a',
          background: '#1a1a2e',
          overflow: 'hidden',
          boxShadow: '0 0 40px rgba(23, 195, 178, 0.05), inset 0 0 60px rgba(23, 195, 178, 0.02)',
        }}>
          {/* 标题栏 */}
          <div style={{
            padding: '12px 20px',
            borderBottom: '1px solid #2a2a4a',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#17C3B2" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <circle cx="5" cy="6" r="1.5" fill="#17C3B2" />
              <circle cx="19" cy="6" r="1.5" fill="#17C3B2" />
              <circle cx="5" cy="18" r="1.5" fill="#17C3B2" />
              <circle cx="19" cy="18" r="1.5" fill="#17C3B2" />
              <line x1="7" y1="7" x2="10" y2="10" stroke="#17C3B2" opacity="0.5" />
              <line x1="17" y1="7" x2="14" y2="10" stroke="#17C3B2" opacity="0.5" />
              <line x1="7" y1="17" x2="10" y2="14" stroke="#17C3B2" opacity="0.5" />
              <line x1="17" y1="17" x2="14" y2="14" stroke="#17C3B2" opacity="0.5" />
            </svg>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#eee' }}>基因星图</span>
            <span style={{
              marginLeft: 'auto',
              fontSize: 12,
              color: '#888',
              background: 'rgba(23, 195, 178, 0.08)',
              padding: '2px 10px',
              borderRadius: 20,
              border: '1px solid rgba(23, 195, 178, 0.15)',
            }}>
              {visible.length} 颗星
            </span>
          </div>
          {/* Canvas 容器 */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <Canvas camera={{ position: [0, 0, 300] }} frameloop="demand" style={{ borderRadius: '0 0 16px 16px' }}>
              <PointsPickThreshold threshold={8} />
              <StarPoints geometry={geometry} visible={visible} onClickStar={onClickStar} />
              {selStar && (
                <mesh position={[selStar.genomeX * SCALE, selStar.genomeY * SCALE, 0]}>
                  <sphereGeometry args={[6, 12, 12]} />
                  <meshBasicMaterial color="#FBBF24" />
                </mesh>
              )}
            </Canvas>
          </div>
        </div>

        {/* 侧边栏 */}
        <div style={{
          width: 300,
          flexShrink: 0,
          borderRadius: 16,
          border: '1px solid #2a2a4a',
          background: '#1a1a2e',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* 侧边栏标题 */}
          <div style={{
            padding: '14px 18px',
            borderBottom: '1px solid #2a2a4a',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#17C3B2" strokeWidth="2">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#eee' }}>邻域歌单</span>
            {sel && cluster && cluster.length > 0 && (
              <span style={{
                marginLeft: 'auto',
                fontSize: 11,
                color: '#FBBF24',
                background: 'rgba(251, 191, 36, 0.1)',
                padding: '1px 8px',
                borderRadius: 20,
                border: '1px solid rgba(251, 191, 36, 0.2)',
              }}>
                {cluster.length} 首
              </span>
            )}
          </div>

          {/* 侧边栏内容 */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: 12,
            /* 自定义滚动条 */
            scrollbarWidth: 'thin',
            scrollbarColor: '#2a2a4a transparent',
          }}>
            {sel
              ? (cluster
                ? cluster.length > 0
                  ? cluster.map((c, i) => (
                    <div
                      key={c.songId}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 12,
                        background: c.songId === sel
                          ? 'rgba(251, 191, 36, 0.1)'
                          : 'rgba(255, 255, 255, 0.03)',
                        border: c.songId === sel
                          ? '1px solid rgba(251, 191, 36, 0.3)'
                          : '1px solid transparent',
                        marginBottom: 6,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        animation: `gm-fadeIn 0.35s ease-out ${i * 0.06}s both`,
                      }}
                      onClick={() => onClickStar(c.songId)}
                      onMouseEnter={(e) => {
                        if (c.songId !== sel) {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                          e.currentTarget.style.borderColor = '#2a2a4a';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (c.songId !== sel) {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                          e.currentTarget.style.borderColor = 'transparent';
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{
                          fontSize: 11,
                          color: i < 3 ? '#FBBF24' : '#666',
                          fontWeight: i < 3 ? 700 : 400,
                          width: 18,
                          textAlign: 'center',
                          flexShrink: 0,
                        }}>
                          {i + 1}
                        </span>
                        <span style={{
                          flex: 1,
                          fontSize: 13,
                          color: c.songId === sel ? '#FBBF24' : '#ddd',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          fontWeight: c.songId === sel ? 600 : 400,
                        }}>
                          {c.title}
                        </span>
                        <span style={{
                          fontSize: 11,
                          color: '#666',
                          flexShrink: 0,
                          background: 'rgba(255, 255, 255, 0.04)',
                          padding: '1px 6px',
                          borderRadius: 6,
                        }}>
                          {c.dist.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))
                  : <div style={{
                      textAlign: 'center',
                      padding: '30px 10px',
                      color: '#666',
                      fontSize: 13,
                    }}>
                    无邻域结果
                  </div>
                : <div style={{
                    textAlign: 'center',
                    padding: '30px 10px',
                    color: '#666',
                    fontSize: 13,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    border: '2px solid #2a2a4a',
                    borderTopColor: '#17C3B2',
                    animation: 'daily-spin 0.8s linear infinite',
                  }} />
                  <span>加载中…</span>
                </div>)
              : <div style={{
                  textAlign: 'center',
                  padding: '40px 10px',
                  color: '#555',
                  fontSize: 13,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5" opacity="0.6">
                  <path d="M15 15l-2 5L9 9l11 4-5 2z" />
                  <circle cx="12" cy="12" r="1" fill="#555" />
                </svg>
                <span>点击一颗星查看邻域</span>
              </div>}
          </div>
        </div>
      </div>
      {/* 响应式滚动条样式 */}
      <style>{`
        div::-webkit-scrollbar { width: 6px; }
        div::-webkit-scrollbar-track { background: transparent; }
        div::-webkit-scrollbar-thumb { background: #2a2a4a; border-radius: 3px; }
        div::-webkit-scrollbar-thumb:hover { background: #3a3a5a; }
      `}</style>
    </>
  );
}
