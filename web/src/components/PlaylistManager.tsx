import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Track } from '@/types';
import { usePlaylistManager } from '@/hooks/usePlaylistManager';
import {
  PlusIcon, EditIcon, TrashIcon, CheckIcon, XIcon,
  ChevronUpIcon, ChevronDownIcon, MusicIcon, ListIcon,
  SearchIcon, SortIcon
} from '@/components/Icons';
import './PlaylistManager.css';
import './PlaylistManager-extra.css';
import { resolveCoverUrl } from '../services/cover'; // 2026-11-20 封面代理修复

interface PlaylistManagerProps {
  currentTrack?: Track;
  isPlaying: boolean;
  onSelectTrack: (track: Track) => void;
  onPlayPlaylist: (tracks: Track[]) => void;
  extraTracks?: Track[];
  onAddToDefaultPlaylist?: (trackId: string) => void;
  highlightTrackId?: string | null;
}

type SortField = 'title' | 'artist' | 'duration' | 'addedAt';
type SortDirection = 'asc' | 'desc';

export const PlaylistManager: React.FC<PlaylistManagerProps> = ({
  currentTrack,
  isPlaying,
  onSelectTrack,
  onPlayPlaylist,
  extraTracks = [],
  highlightTrackId,
}) => {
  const {
    playlists,
    currentPlaylist,
    currentPlaylistId,
    currentPlaylistTracks,
    isEditing,
    editingPlaylist,
    deletePlaylist,
    renamePlaylist,
    removeTrackFromPlaylist,
    removeTracksFromPlaylist,
    moveTrackInPlaylist,
    switchPlaylist,
    startEditing,
    saveEditing,
    cancelEditing,
    setEditingPlaylist,
    getPlaylistTrackCount,
  } = usePlaylistManager(extraTracks);

  // 状态管理
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [sortField, setSortField] = useState<SortField>('title');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [showSortMenu, setShowSortMenu] = useState(false);

  // 过滤和排序后的歌曲列表
  const filteredAndSortedTracks = useMemo(() => {
    let tracks = [...currentPlaylistTracks];
    
    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      tracks = tracks.filter(track => 
        track.title.toLowerCase().includes(query) ||
        track.artist.toLowerCase().includes(query)
      );
    }
    
    // 排序
    tracks.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'artist':
          comparison = a.artist.localeCompare(b.artist);
          break;
        case 'duration':
          comparison = (a.duration || 0) - (b.duration || 0);
          break;
        default:
          comparison = 0;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    return tracks;
  }, [currentPlaylistTracks, searchQuery, sortField, sortDirection]);

  // 处理创建新播放列表
  const handleCreatePlaylist = useCallback(() => {
    startEditing(null);
  }, [startEditing]);

  // 处理删除播放列表
  const handleDeletePlaylist = useCallback((id: string) => {
    if (id === 'default' || id.startsWith('preset-')) return; // 默认与预设列表不可删除
    setShowDeleteConfirm(id);
  }, []);

  // 确认删除
  const confirmDelete = useCallback(() => {
    if (showDeleteConfirm) {
      deletePlaylist(showDeleteConfirm);
      setShowDeleteConfirm(null);
    }
  }, [showDeleteConfirm, deletePlaylist]);

  // 处理重命名
  const handleRename = useCallback((id: string, currentName: string) => {
    setEditingName(id);
    setNewName(currentName);
  }, []);

  // 保存重命名
  const saveRename = useCallback(() => {
    if (editingName && newName.trim()) {
      renamePlaylist(editingName, newName.trim());
      setEditingName(null);
      setNewName('');
    }
  }, [editingName, newName, renamePlaylist]);

  // 处理歌曲移除
  const handleRemoveTrack = useCallback((trackId: string) => {
    if (currentPlaylistId) {
      removeTrackFromPlaylist(currentPlaylistId, trackId);
      setSelectedTracks(prev => {
        const next = new Set(prev);
        next.delete(trackId);
        return next;
      });
    }
  }, [currentPlaylistId, removeTrackFromPlaylist]);

  // 处理歌曲上移
  const handleMoveUp = useCallback((trackId: string) => {
    if (currentPlaylistId) {
      moveTrackInPlaylist(currentPlaylistId, trackId, 'up');
    }
  }, [currentPlaylistId, moveTrackInPlaylist]);

  // 处理歌曲下移
  const handleMoveDown = useCallback((trackId: string) => {
    if (currentPlaylistId) {
      moveTrackInPlaylist(currentPlaylistId, trackId, 'down');
    }
  }, [currentPlaylistId, moveTrackInPlaylist]);

  // 处理播放整个播放列表
  const handlePlayAll = useCallback(() => {
    if (filteredAndSortedTracks.length > 0) {
      onPlayPlaylist(filteredAndSortedTracks);
    }
  }, [filteredAndSortedTracks, onPlayPlaylist]);

  // 切换选择状态
  const toggleTrackSelection = useCallback((trackId: string) => {
    setSelectedTracks(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  }, []);

  // 全选/取消全选
  const toggleSelectAll = useCallback(() => {
    if (selectedTracks.size === filteredAndSortedTracks.length) {
      setSelectedTracks(new Set());
    } else {
      setSelectedTracks(new Set(filteredAndSortedTracks.map(t => t.id)));
    }
  }, [selectedTracks, filteredAndSortedTracks]);

  // 批量删除选中的歌曲
  const handleBatchDelete = useCallback(() => {
    if (currentPlaylistId && selectedTracks.size > 0) {
      removeTracksFromPlaylist(currentPlaylistId, Array.from(selectedTracks));
      setSelectedTracks(new Set());
      setIsBatchMode(false);
    }
  }, [currentPlaylistId, selectedTracks, removeTracksFromPlaylist]);

  // 切换排序方向
  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setShowSortMenu(false);
  }, [sortField]);

  // 格式化时间
  const formatDuration = useCallback((ms: number) => {
    if (!ms || ms <= 0) return '--:--';
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, []);

  // ========== 动态预加载歌曲时长 ==========
  // 对于没有 duration 数据的歌曲，使用 Audio API 的 loadedmetadata 事件获取时长
  const [dynamicDurations, setDynamicDurations] = useState<Record<string, number>>({});
  const audioCacheRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  useEffect(() => {
    // 清理上一批 Audio 对象
    audioCacheRef.current.forEach(audio => {
      audio.src = '';
      audio.removeAttribute('src');
    });
    audioCacheRef.current.clear();

    // 找出需要预加载时长的歌曲（最多50首，覆盖大部分播放列表）
    const needLoad = filteredAndSortedTracks
      .filter(t => !t.duration || t.duration <= 0)
      .filter(t => !dynamicDurations[t.id])
      .slice(0, 50);

    if (needLoad.length === 0) return;

    console.log(`[DURATION] 开始预加载 ${needLoad.length} 首歌曲的时长`);

    needLoad.forEach(track => {
      if (!track.audioUrl) return;

      const audio = new Audio();
      audio.preload = 'metadata';
      audioCacheRef.current.set(track.id, audio);

      const onLoaded = () => {
        if (audio.duration && !isNaN(audio.duration) && audio.duration > 0) {
          const durationMs = Math.floor(audio.duration * 1000);
          // 每首歌加载完成后立即更新状态
          setDynamicDurations(prev => ({ ...prev, [track.id]: durationMs }));
          console.log(`[DURATION] ${track.title}: ${durationMs}ms = ${Math.floor(durationMs / 60000)}:${String(Math.floor((durationMs % 60000) / 1000)).padStart(2, '0')}`);
        }
        cleanup();
      };

      const onError = () => {
        console.warn(`[DURATION] 无法获取时长: ${track.title}`);
        cleanup();
      };

      const cleanup = () => {
        audio.removeEventListener('loadedmetadata', onLoaded);
        audio.removeEventListener('error', onError);
        audio.src = '';
        audio.removeAttribute('src');
        audioCacheRef.current.delete(track.id);
      };

      audio.addEventListener('loadedmetadata', onLoaded);
      audio.addEventListener('error', onError);
      audio.src = track.audioUrl;
    });

    return () => {
      audioCacheRef.current.forEach(audio => {
        audio.src = '';
        audio.removeAttribute('src');
      });
      audioCacheRef.current.clear();
    };
  }, [filteredAndSortedTracks]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="playlist-manager">
      {/* 侧边栏：播放列表列表 */}
      <div className="playlist-sidebar">
        <div className="sidebar-header">
          <h3 className="sidebar-title">播放列表</h3>
          <button 
            className="create-btn"
            onClick={handleCreatePlaylist}
            title="创建新播放列表"
          >
            <PlusIcon size={16} />
          </button>
        </div>
        
        <div className="playlist-list">
          {/* 系统预设分组 */}
          <div className="playlist-group-title">系统预设</div>
          {playlists.filter(p => p.id.startsWith('preset-')).map(playlist => (
            <div
              key={playlist.id}
              className={`playlist-item preset ${playlist.id === currentPlaylistId ? 'active' : ''}`}
              onClick={() => switchPlaylist(playlist.id)}
            >
              <div className="playlist-item-info">
                <span className="playlist-name">{playlist.name}</span>
                <span className="preset-badge">预设</span>
                <span className="playlist-count">
                  {getPlaylistTrackCount(playlist.id)} 首
                </span>
              </div>
            </div>
          ))}

          {/* 我的列表分组 */}
          <div className="playlist-group-title">我的列表</div>
          {playlists.filter(p => !p.id.startsWith('preset-')).map(playlist => (
            <div
              key={playlist.id}
              className={`playlist-item ${playlist.id === currentPlaylistId ? 'active' : ''}`}
              onClick={() => switchPlaylist(playlist.id)}
            >
              <div className="playlist-item-info">
                {editingName === playlist.id ? (
                  <div className="rename-input-wrap">
                    <input
                      type="text"
                      className="rename-input"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveRename()}
                      autoFocus
                    />
                    <button className="rename-save" onClick={saveRename}>
                      <CheckIcon size={12} />
                    </button>
                    <button className="rename-cancel" onClick={() => setEditingName(null)}>
                      <XIcon size={12} />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="playlist-name">{playlist.name}</span>
                    <span className="playlist-count">
                      {getPlaylistTrackCount(playlist.id)} 首
                    </span>
                  </>
                )}
              </div>

              {/* 预设列表不显示重命名/删除按钮；默认列表也不显示 */}
              {!playlist.id.startsWith('preset-') && playlist.id !== 'default' && (
                <div className="playlist-item-actions">
                  <button
                    className="action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRename(playlist.id, playlist.name);
                    }}
                    title="重命名"
                  >
                    <EditIcon size={12} />
                  </button>
                  <button
                    className="action-btn delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeletePlaylist(playlist.id);
                    }}
                    title="删除"
                  >
                    <TrashIcon size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 主内容区：当前播放列表的歌曲 */}
      <div className="playlist-content">
        <div className="content-header">
          <div className="header-info">
            <h2 className="content-title">{currentPlaylist?.name || '播放列表'}</h2>
            <span className="content-count">
              {filteredAndSortedTracks.length} 首歌曲
            </span>
          </div>
          <div className="header-actions">
            <button className="play-all-btn" onClick={handlePlayAll}>
              <MusicIcon size={14} />
              <span>播放全部</span>
            </button>
            <button 
              className={`batch-btn ${isBatchMode ? 'active' : ''}`}
              onClick={() => {
                setIsBatchMode(!isBatchMode);
                if (isBatchMode) setSelectedTracks(new Set());
              }}
            >
              {isBatchMode ? '取消批量' : '批量操作'}
            </button>
          </div>
        </div>

        {/* 搜索和排序工具栏 */}
        <div className="toolbar">
          <div className="search-wrap">
            <SearchIcon size={14} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="搜索歌曲..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="sort-wrap">
            <button 
              className="sort-btn"
              onClick={() => setShowSortMenu(!showSortMenu)}
            >
              <SortIcon size={14} />
              <span>排序</span>
            </button>
            {showSortMenu && (
              <div className="sort-menu">
                <button 
                  className={`sort-option ${sortField === 'title' ? 'active' : ''}`}
                  onClick={() => toggleSort('title')}
                >
                  歌曲名称 {sortField === 'title' && (sortDirection === 'asc' ? '↑' : '↓')}
                </button>
                <button 
                  className={`sort-option ${sortField === 'artist' ? 'active' : ''}`}
                  onClick={() => toggleSort('artist')}
                >
                  歌手 {sortField === 'artist' && (sortDirection === 'asc' ? '↑' : '↓')}
                </button>
                <button 
                  className={`sort-option ${sortField === 'duration' ? 'active' : ''}`}
                  onClick={() => toggleSort('duration')}
                >
                  时长 {sortField === 'duration' && (sortDirection === 'asc' ? '↑' : '↓')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 批量操作栏 */}
        {isBatchMode && (
          <div className="batch-bar">
            <label className="select-all">
              <input
                type="checkbox"
                checked={selectedTracks.size === filteredAndSortedTracks.length && filteredAndSortedTracks.length > 0}
                onChange={toggleSelectAll}
              />
              <span>全选 ({selectedTracks.size}/{filteredAndSortedTracks.length})</span>
            </label>
            {selectedTracks.size > 0 && (
              <button className="batch-delete-btn" onClick={handleBatchDelete}>
                <TrashIcon size={14} />
                <span>删除选中 ({selectedTracks.size})</span>
              </button>
            )}
          </div>
        )}

        <div className="track-list-container">
          {currentPlaylist?.id.startsWith('preset-') && currentPlaylistTracks.length === 0 ? (
            <div className="playlist-loading">
              <span className="loading-spinner"></span>
              <span>加载分类歌曲中...</span>
            </div>
          ) : filteredAndSortedTracks.length === 0 ? (
            <div className="empty-list">
              <ListIcon size={48} />
              <p className="empty-title">
                {searchQuery ? '没有找到匹配的歌曲' : '播放列表为空'}
              </p>
              <p className="empty-hint">
                {searchQuery ? '尝试其他搜索词' : '点击歌曲右侧的 + 按钮添加歌曲'}
              </p>
            </div>
          ) : (
            <div className="track-list">
              {filteredAndSortedTracks.map((track, index) => {
                const isCurrentTrack = currentTrack?.id === track.id;
                const isFirst = index === 0;
                const isLast = index === filteredAndSortedTracks.length - 1;
                const isSelected = selectedTracks.has(track.id);
                
                return (
                  <div
                    key={track.id}
                    className={`track-item ${isCurrentTrack ? 'active' : ''} ${isSelected ? 'selected' : ''} ${highlightTrackId === track.id ? 'highlighted' : ''}`}
                    onClick={() => {
                      if (isBatchMode) {
                        toggleTrackSelection(track.id);
                      } else {
                        onSelectTrack(track);
                      }
                    }}
                  >
                    {isBatchMode && (
                      <div className="track-checkbox">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleTrackSelection(track.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    )}
                    
                    <div className="track-index">
                      {isCurrentTrack && isPlaying ? (
                        <span className="playing-indicator">
                          <span className="bar"></span>
                          <span className="bar"></span>
                          <span className="bar"></span>
                        </span>
                      ) : (
                        <span>{index + 1}</span>
                      )}
                    </div>
                    
                    <div className="track-cover" style={{ 
                      background: `linear-gradient(135deg, ${track.coverColor} 0%, var(--color-bg-card) 100%)` 
                    }}>
                      {resolveCoverUrl(track.albumCover) ? (
                        /* [2026-11-20 封面代理修复] 旧实现（直连外链被网易云防盗链 403）：<img src={track.albumCover} ... /> */
                        <img src={resolveCoverUrl(track.albumCover)} alt={track.title} referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <MusicIcon size={16} fill="#fff" />
                      )}
                    </div>
                    
                    <div className="track-info">
                      <span className="track-title">
                        {track.title}
                        {track.playable === false && (
                          <span className="track-unplayable" title="音频URL不可播放">⚠</span>
                        )}
                      </span>
                      <span className="track-artist">{track.artist}</span>
                    </div>
                    
                    <span className="track-duration">
                      {formatDuration(track.duration || dynamicDurations[track.id])}
                    </span>
                    
                    {!isBatchMode && (
                      <div className="track-actions">
                        <button
                          className="move-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveUp(track.id);
                          }}
                          disabled={isFirst}
                          title="上移"
                        >
                          <ChevronUpIcon size={14} />
                        </button>
                        <button
                          className="move-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveDown(track.id);
                          }}
                          disabled={isLast}
                          title="下移"
                        >
                          <ChevronDownIcon size={14} />
                        </button>
                        <button
                          className="remove-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveTrack(track.id);
                          }}
                          title="移除"
                        >
                          <XIcon size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 创建/编辑播放列表弹窗 */}
      {isEditing && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>{editingPlaylist?.id ? '编辑播放列表' : '创建播放列表'}</h3>
              <button className="modal-close" onClick={cancelEditing}>
                <XIcon size={16} />
              </button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">播放列表名称</label>
                <input
                  type="text"
                  className="form-input"
                  value={editingPlaylist?.name || ''}
                  onChange={(e) => setEditingPlaylist(prev => ({
                    ...prev,
                    name: e.target.value
                  }))}
                  placeholder="请输入播放列表名称"
                  autoFocus
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">描述（可选）</label>
                <textarea
                  className="form-textarea"
                  value={editingPlaylist?.description || ''}
                  onChange={(e) => setEditingPlaylist(prev => ({
                    ...prev,
                    description: e.target.value
                  }))}
                  placeholder="请输入播放列表描述"
                  rows={3}
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button className="cancel-btn" onClick={cancelEditing}>
                取消
              </button>
              <button className="save-btn" onClick={saveEditing}>
                {editingPlaylist?.id ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {showDeleteConfirm && (
        <div className="modal-overlay">
          <div className="modal confirm-modal">
            <div className="modal-header">
              <h3>确认删除</h3>
              <button className="modal-close" onClick={() => setShowDeleteConfirm(null)}>
                <XIcon size={16} />
              </button>
            </div>
            
            <div className="modal-body">
              <p className="confirm-text">
                确定要删除播放列表 "{playlists.find(p => p.id === showDeleteConfirm)?.name}" 吗？
              </p>
              <p className="confirm-hint">此操作不可撤销。</p>
            </div>
            
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowDeleteConfirm(null)}>
                取消
              </button>
              <button className="delete-btn" onClick={confirmDelete}>
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlaylistManager;
