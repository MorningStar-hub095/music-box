import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { songsApi, auditApi } from '../services/api';

interface SongDetail {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumCover?: string;
  audioUrl: string;
  audioUrlMp3?: string;
  lyricContent?: string;
  coverColor?: string;
  platform?: string;
  playable: boolean;
  playCount: number;
  commentCount: number;
  likeCount: number;
  favoriteCount: number;
  hotScore: number;
  createdAt: string;
  updatedAt: string;
  urlCheckedAt?: string;
  dataSource?: string;
  sourceUrl?: string;
  importedBy?: number;
  importedAt?: string;
  lastEditedBy?: number;
  genres: { genre: { id: number; name: string } }[];
  languages: { language: { id: number; name: string; code: string } }[];
  scenes: { scene: { id: number; name: string; icon?: string } }[];
  moods: { mood: { id: number; name: string; icon?: string } }[];
  decades: { decade: { id: number; name: string; startYear?: number; endYear?: number } }[];
  tags: { tag: { id: number; name: string } }[];
}

interface AuditLog {
  id: number;
  action: string;
  userId?: number;
  user?: { id: number; username: string };
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  changedFields?: string[];
  ipAddress?: string;
  createdAt: string;
}

interface UrlStatus {
  playable: boolean;
  audioUrl: string;
  audioUrlMp3?: string;
  urlCheckedAt: string;
}

const SongDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [song, setSong] = useState<SongDetail | null>(null);
  const [auditHistory, setAuditHistory] = useState<AuditLog[]>([]);
  const [urlStatus, setUrlStatus] = useState<UrlStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'info' | 'audio' | 'history'>('info');

  useEffect(() => {
    if (!id) return;
    
    const fetchData = async () => {
      setLoading(true);
      try {
        const [songRes, historyRes] = await Promise.all([
          songsApi.getSongDetail(id),
          auditApi.getHistory('song', id),
        ]);
        
        setSong(songRes.data.data);
        setAuditHistory(historyRes.data.data || []);
      } catch (error) {
        console.error('获取歌曲详情失败:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  const handleCheckUrl = async () => {
    if (!id) return;
    try {
      const res = await songsApi.getUrlStatus(id);
      setUrlStatus(res.data.data);
    } catch (error) {
      console.error('检查URL状态失败:', error);
    }
  };

  const handleRefreshUrl = async () => {
    if (!id) return;
    try {
      const res = await songsApi.refreshUrl(id);
      setUrlStatus(res.data.data);
      const songRes = await songsApi.getSongDetail(id);
      setSong(songRes.data.data);
    } catch (error) {
      console.error('刷新URL失败:', error);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  const getDataSourceLabel = (source?: string) => {
    const labels: Record<string, string> = {
      crawler: '爬虫采集',
      manual: '手动添加',
      import: '批量导入',
      api: 'API接口',
    };
    return labels[source || ''] || source || '--';
  };

  if (loading) {
    return <div className="page-loading">加载中...</div>;
  }

  if (!song) {
    return <div className="empty-state">歌曲不存在</div>;
  }

  return (
    <div className="song-detail-page">
      <div className="detail-header">
        <button className="back-btn" onClick={() => navigate('/songs')}>
          ← 返回列表
        </button>
        <h2 className="page-title">歌曲详情</h2>
      </div>

      {/* 基本信息卡片 */}
      <div className="detail-card">
        <div className="detail-cover-section">
          {song.albumCover ? (
            <img src={song.albumCover} alt={song.title} className="detail-cover" />
          ) : (
            <div className="detail-cover-placeholder" style={{ backgroundColor: song.coverColor || '#6366f1' }}>
              <span>♪</span>
            </div>
          )}
          <div className="detail-basic-info">
            <h3 className="detail-title">{song.title}</h3>
            <p className="detail-artist">{song.artist}</p>
            {song.album && <p className="detail-album">专辑: {song.album}</p>}
            <div className="detail-tags">
              {song.genres.map(({ genre }) => (
                <span key={genre.id} className="tag genre-tag">{genre.name}</span>
              ))}
              {song.languages.map(({ language }) => (
                <span key={language.id} className="tag language-tag">{language.name}</span>
              ))}
              {song.scenes.map(({ scene }) => (
                <span key={scene.id} className="tag scene-tag">
                  {scene.icon && <span className="tag-icon">{scene.icon}</span>}
                  {scene.name}
                </span>
              ))}
              {song.moods.map(({ mood }) => (
                <span key={mood.id} className="tag mood-tag">
                  {mood.icon && <span className="tag-icon">{mood.icon}</span>}
                  {mood.name}
                </span>
              ))}
              {song.decades.map(({ decade }) => (
                <span key={decade.id} className="tag decade-tag">{decade.name}</span>
              ))}
              {song.tags.map(({ tag }) => (
                <span key={tag.id} className="tag custom-tag">{tag.name}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="detail-stats">
          <div className="stat-item">
            <span className="stat-label">播放次数</span>
            <span className="stat-value">{song.playCount.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">评论数</span>
            <span className="stat-value">{song.commentCount.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">点赞数</span>
            <span className="stat-value">{song.likeCount.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">收藏数</span>
            <span className="stat-value">{song.favoriteCount.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">热度分数</span>
            <span className="stat-value">{song.hotScore.toFixed(2)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">播放状态</span>
            <span className={`stat-value status ${song.playable ? 'playable' : 'unplayable'}`}>
              {song.playable ? '可播放' : '不可用'}
            </span>
          </div>
        </div>
      </div>

      {/* 标签页切换 */}
      <div className="detail-tabs">
        <button
          className={`tab-btn ${activeTab === 'info' ? 'active' : ''}`}
          onClick={() => setActiveTab('info')}
        >
          详细信息
        </button>
        <button
          className={`tab-btn ${activeTab === 'audio' ? 'active' : ''}`}
          onClick={() => setActiveTab('audio')}
        >
          音频信息
        </button>
        <button
          className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          操作历史
        </button>
      </div>

      {/* 详细信息标签页 */}
      {activeTab === 'info' && (
        <div className="detail-card">
          <h4 className="card-title">数据来源</h4>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">数据来源</span>
              <span className="info-value">{getDataSourceLabel(song.dataSource)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">来源URL</span>
              <span className="info-value">
                {song.sourceUrl ? (
                  <a href={song.sourceUrl} target="_blank" rel="noopener noreferrer">
                    {song.sourceUrl.length > 50 ? song.sourceUrl.substring(0, 50) + '...' : song.sourceUrl}
                  </a>
                ) : '--'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">平台</span>
              <span className="info-value">{song.platform || '--'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">歌曲ID</span>
              <span className="info-value">{song.id}</span>
            </div>
          </div>

          <h4 className="card-title">时间信息</h4>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">创建时间</span>
              <span className="info-value">{formatDate(song.createdAt)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">最后更新</span>
              <span className="info-value">{formatDate(song.updatedAt)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">导入时间</span>
              <span className="info-value">{formatDate(song.importedAt)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">URL检查时间</span>
              <span className="info-value">{formatDate(song.urlCheckedAt)}</span>
            </div>
          </div>

          {song.lyricContent && (
            <>
              <h4 className="card-title">歌词内容</h4>
              <div className="lyrics-preview">
                <pre>{song.lyricContent.substring(0, 500)}{song.lyricContent.length > 500 ? '...' : ''}</pre>
              </div>
            </>
          )}
        </div>
      )}

      {/* 音频信息标签页 */}
      {activeTab === 'audio' && (
        <div className="detail-card">
          <h4 className="card-title">音频URL</h4>
          <div className="url-info">
            <div className="url-item">
              <span className="url-label">主音频URL:</span>
              <code className="url-value">{song.audioUrl}</code>
            </div>
            {song.audioUrlMp3 && (
              <div className="url-item">
                <span className="url-label">MP3音频URL:</span>
                <code className="url-value">{song.audioUrlMp3}</code>
              </div>
            )}
          </div>

          <div className="url-actions">
            <button className="action-btn" onClick={handleCheckUrl}>
              检查URL状态
            </button>
            <button className="action-btn primary" onClick={handleRefreshUrl}>
              刷新URL
            </button>
          </div>

          {urlStatus && (
            <div className="url-status-result">
              <h4>URL状态检查结果</h4>
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">可播放</span>
                  <span className={`info-value status ${urlStatus.playable ? 'playable' : 'unplayable'}`}>
                    {urlStatus.playable ? '是' : '否'}
                  </span>
                </div>
                <div className="info-item">
                  <span className="info-label">检查时间</span>
                  <span className="info-value">{formatDate(urlStatus.urlCheckedAt)}</span>
                </div>
              </div>
            </div>
          )}

          {song.coverColor && (
            <>
              <h4 className="card-title">封面颜色</h4>
              <div className="color-preview">
                <div className="color-swatch" style={{ backgroundColor: song.coverColor }} />
                <span className="color-value">{song.coverColor}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* 操作历史标签页 */}
      {activeTab === 'history' && (
        <div className="detail-card">
          <h4 className="card-title">操作历史记录</h4>
          {auditHistory.length === 0 ? (
            <div className="empty-history">暂无操作记录</div>
          ) : (
            <div className="history-list">
              {auditHistory.map((log) => (
                <div key={log.id} className="history-item">
                  <div className="history-header">
                    <span className="history-action">
                      {log.action === 'create' ? '创建' : 
                       log.action === 'update' ? '更新' : 
                       log.action === 'delete' ? '删除' : log.action}
                    </span>
                    <span className="history-user">
                      {log.user?.username || '系统'}
                    </span>
                    <span className="history-time">
                      {formatDate(log.createdAt)}
                    </span>
                    {log.ipAddress && (
                      <span className="history-ip">IP: {log.ipAddress}</span>
                    )}
                  </div>
                  {log.changedFields && log.changedFields.length > 0 && (
                    <div className="history-changes">
                      <span className="changes-label">变更字段:</span>
                      <span className="changes-fields">
                        {log.changedFields.join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SongDetailPage;
