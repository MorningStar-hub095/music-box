import React, { useEffect, useState } from 'react';

/**
 * 演示模式横幅（2026-11-03）
 * 公网 Demo 部署（DEMO_MODE=true）时展示版权合规提示；
 * 非 Demo 环境该接口返回 banner 为空，本组件不渲染任何内容。
 */
export const DemoBanner: React.FC = () => {
  const [banner, setBanner] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.banner) setBanner(d.banner);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!banner) return null;
  return (
    <div
      role="status"
      style={{
        position: 'relative',
        zIndex: 50,
        padding: '8px 16px',
        textAlign: 'center',
        fontSize: 13,
        lineHeight: 1.6,
        color: '#e8d48b',
        background: 'rgba(52, 40, 8, 0.85)',
        borderBottom: '1px solid rgba(232, 212, 139, 0.25)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {banner}
    </div>
  );
};
