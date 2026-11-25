import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { statsApi } from '../services/api';

interface StatsData {
  totalSongs: number;
  playableSongs: number;
  unplayableSongs: number;
  totalUsers: number;
  totalGenres: number;
  totalLanguages: number;
  totalScenes: number;
  totalMoods: number;
  totalDecades: number;
  totalTags: number;
  recentSongs: number;
  topPlatform: string;
  platformDistribution: { platform: string; count: number }[];
  dataSourceDistribution: { source: string; count: number }[];
}

const StatsPage: React.FC = () => {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await statsApi.getOverview();
      if (res.data.success) {
        setStats(res.data.data);
      } else {
        setError(res.data.error || '获取统计数据失败');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '无法连接到服务器';
      setError(`统计数据加载失败: ${errorMessage}`);
      console.error('[StatsPage] 获取统计数据失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="stats-page">
        <h2 className="page-title">数据统计</h2>
        <div className="page-loading">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stats-page">
        <h2 className="page-title">数据统计</h2>
        <div className="error-state">
          <div className="error-icon">⚠️</div>
          <div className="error-message">{error}</div>
          <button className="retry-btn" onClick={fetchStats}>
            重新加载
          </button>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="stats-page">
        <h2 className="page-title">数据统计</h2>
        <div className="empty-state">暂无统计数据</div>
      </div>
    );
  }

  const mainCards = [
    { label: '歌曲总数', value: stats.totalSongs, icon: '🎵', color: '#4CAF50', link: '/songs' },
    { label: '可播放歌曲', value: stats.playableSongs, icon: '▶️', color: '#2196F3', link: '/songs?playable=true' },
    { label: '不可用歌曲', value: stats.unplayableSongs, icon: '⏸️', color: '#FF5722', link: '/songs?playable=false' },
    { label: '注册用户', value: stats.totalUsers, icon: '👥', color: '#FF9800', link: '/users' },
    { label: '流派数量', value: stats.totalGenres, icon: '🏷️', color: '#9C27B0', link: '/genres' },
    { label: '语言数量', value: stats.totalLanguages, icon: '🌐', color: '#00BCD4', link: null },
    { label: '场景数量', value: stats.totalScenes, icon: '🎬', color: '#795548', link: null },
    { label: '情绪数量', value: stats.totalMoods, icon: '😊', color: '#E91E63', link: null },
    { label: '年代数量', value: stats.totalDecades, icon: '📅', color: '#607D8B', link: null },
    { label: '标签数量', value: stats.totalTags, icon: '🔖', color: '#3F51B5', link: null },
    { label: '近7天新增', value: stats.recentSongs, icon: '🆕', color: '#4CAF50', link: null },
    { label: '最热门平台', value: stats.topPlatform, icon: '🔥', color: '#FF5722', link: null },
  ];

  const getDataSourceLabel = (source: string) => {
    const labels: Record<string, string> = {
      crawler: '爬虫采集',
      manual: '手动添加',
      import: '批量导入',
      api: 'API接口',
    };
    return labels[source] || source;
  };

  const handleCardClick = (link: string | null) => {
    if (link) {
      navigate(link);
    }
  };

  return (
    <div className="stats-page">
      <h2 className="page-title">数据统计</h2>
      
      {/* 主要统计卡片 */}
      <div className="stats-grid">
        {mainCards.map((card) => (
          <div
            key={card.label}
            className={`stat-card ${card.link ? 'clickable' : ''}`}
            onClick={() => handleCardClick(card.link)}
          >
            <div className="stat-icon" style={{ background: card.color + '22', color: card.color }}>
              {card.icon}
            </div>
            <div className="stat-info">
              <span className="stat-value">{typeof card.value === 'number' ? card.value.toLocaleString() : card.value}</span>
              <span className="stat-label">{card.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 平台分布 */}
      {stats.platformDistribution && stats.platformDistribution.length > 0 && (
        <div className="stats-section">
          <h3 className="section-title">平台分布</h3>
          <div className="distribution-list">
            {stats.platformDistribution.map((item) => (
              <div key={item.platform} className="distribution-item">
                <span className="distribution-name">{item.platform}</span>
                <div className="distribution-bar">
                  <div 
                    className="distribution-fill" 
                    style={{ width: `${(item.count / stats.totalSongs) * 100}%` }}
                  />
                </div>
                <span className="distribution-count">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 数据来源分布 */}
      {stats.dataSourceDistribution && stats.dataSourceDistribution.length > 0 && (
        <div className="stats-section">
          <h3 className="section-title">数据来源分布</h3>
          <div className="distribution-list">
            {stats.dataSourceDistribution.map((item) => (
              <div key={item.source} className="distribution-item">
                <span className="distribution-name">{getDataSourceLabel(item.source)}</span>
                <div className="distribution-bar">
                  <div 
                    className="distribution-fill" 
                    style={{ width: `${(item.count / stats.totalSongs) * 100}%` }}
                  />
                </div>
                <span className="distribution-count">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default StatsPage;
