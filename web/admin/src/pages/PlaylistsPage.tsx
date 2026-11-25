import React, { useEffect, useState } from 'react';
import { playlistsApi } from '../services/api';

interface Playlist {
  id: number;
  name: string;
  songCount: number;
  createdAt: string;
}

const PlaylistsPage: React.FC = () => {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [editName, setEditName] = useState('');

  const fetchPlaylists = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await playlistsApi.getPlaylists();
      setPlaylists(res.data.data || res.data || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '获取播放列表失败';
      setError(errorMessage);
      console.error('[PlaylistsPage] 获取播放列表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlaylists();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await playlistsApi.createPlaylist({ name: newName.trim() });
      setNewName('');
      fetchPlaylists();
    } catch (err) {
      alert('创建播放列表失败');
      console.error('[PlaylistsPage] 创建播放列表失败:', err);
    }
  };

  const handleEdit = (playlist: Playlist) => {
    setEditingPlaylist(playlist);
    setEditName(playlist.name);
  };

  const handleCancelEdit = () => {
    setEditingPlaylist(null);
    setEditName('');
  };

  const handleSaveEdit = async () => {
    if (!editingPlaylist || !editName.trim()) return;
    try {
      await playlistsApi.updatePlaylist(editingPlaylist.id, { name: editName.trim() });
      setEditingPlaylist(null);
      fetchPlaylists();
    } catch (err) {
      alert('更新播放列表失败');
      console.error('[PlaylistsPage] 更新播放列表失败:', err);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此播放列表吗？')) return;
    try {
      await playlistsApi.deletePlaylist(id);
      fetchPlaylists();
    } catch (err) {
      alert('删除播放列表失败');
      console.error('[PlaylistsPage] 删除播放列表失败:', err);
    }
  };

  if (loading) {
    return <div className="page-loading">加载中...</div>;
  }

  if (error) {
    return (
      <div className="playlists-page">
        <h2 className="page-title">播放列表</h2>
        <div className="error-state">
          <div className="error-icon">⚠️</div>
          <div className="error-message">{error}</div>
          <button className="retry-btn" onClick={fetchPlaylists}>
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="playlists-page">
      <h2 className="page-title">播放列表</h2>
      
      {/* 添加播放列表表单 */}
      <form onSubmit={handleAdd} className="playlist-form">
        <input
          type="text"
          placeholder="新播放列表名称"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="playlist-input"
          required
        />
        <button type="submit" className="add-btn">添加</button>
      </form>
      
      {/* 编辑播放列表弹窗 */}
      {editingPlaylist && (
        <div className="modal-overlay">
          <div className="modal">
            <h3 className="modal-title">编辑播放列表</h3>
            <div className="modal-form">
              <div className="form-group">
                <label>名称:</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="playlist-input"
                  required
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={handleCancelEdit}>取消</button>
              <button className="save-btn" onClick={handleSaveEdit}>保存</button>
            </div>
          </div>
        </div>
      )}
      
      {playlists.length === 0 ? (
        <div className="empty-state">暂无播放列表</div>
      ) : (
        <div className="playlists-grid">
          {playlists.map((playlist) => (
            <div key={playlist.id} className="playlist-card">
              <div className="playlist-icon">📋</div>
              <div className="playlist-info">
                <h3 className="playlist-name">{playlist.name}</h3>
                <p className="playlist-count">{playlist.songCount} 首歌曲</p>
                <p className="playlist-date">{playlist.createdAt}</p>
              </div>
              <div className="playlist-actions">
                <button className="action-btn" onClick={() => handleEdit(playlist)}>编辑</button>
                <button className="delete-btn" onClick={() => handleDelete(playlist.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PlaylistsPage;
