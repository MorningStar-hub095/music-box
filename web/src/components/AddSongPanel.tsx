/**
 * AddSongPanel - 手动添加歌曲面板
 * 支持：歌名+歌手自动搜 / 手动指定 URL，以及批量刷新、爬热榜入口。
 */
import { useState } from 'react';
import { songsAdminApi, AddManualSongResult } from '../services/api';
import './AddSongPanel.css';

interface AddSongPanelProps {
  onClose: () => void;
  onAdded?: (song: AddManualSongResult) => void;
}

export default function AddSongPanel({ onClose, onAdded }: AddSongPanelProps) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [manualUrl, setManualUrl] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [batchBusy, setBatchBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleAdd = async () => {
    if (!title.trim()) {
      setMsg({ type: 'error', text: '请填写歌名' });
      return;
    }
    setSubmitting(true);
    setMsg(null);
    try {
      const song = await songsAdminApi.addManualSong({
        title: title.trim(),
        artist: artist.trim() || undefined,
        audioUrl: manualUrl ? audioUrl.trim() || undefined : undefined,
      });
      setMsg({ type: 'success', text: `已添加：${song.title} - ${song.artist}` });
      setTitle('');
      setArtist('');
      setAudioUrl('');
      onAdded?.(song);
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message || '添加失败' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefreshBatch = async () => {
    setBatchBusy('refresh');
    setMsg(null);
    try {
      await songsAdminApi.refreshBatchUrls();
      setMsg({ type: 'success', text: '批量刷新任务已启动' });
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message || '操作失败' });
    } finally {
      setBatchBusy(null);
    }
  };

  const handleRefreshHot100 = async () => {
    setBatchBusy('hot100');
    setMsg(null);
    try {
      const result = await songsAdminApi.refreshHot100();
      setMsg({ type: 'success', text: `已添加 ${result.addedCount ?? 0} 首热榜歌曲` });
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message || '操作失败' });
    } finally {
      setBatchBusy(null);
    }
  };

  return (
    <div className="add-song-overlay" onClick={onClose}>
      <div className="add-song-panel" onClick={(e) => e.stopPropagation()}>
        <div className="add-song-header">
          <span>添加歌曲</span>
          <button className="add-song-close" onClick={onClose} title="关闭">✕</button>
        </div>

        <div className="add-song-body">
          <div className="add-song-field">
            <label>歌名（必填）</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：晴天" />
          </div>

          <div className="add-song-field">
            <label>歌手（选填）</label>
            <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="如：周杰伦" />
          </div>

          <label className="add-song-check">
            <input type="checkbox" checked={manualUrl} onChange={(e) => setManualUrl(e.target.checked)} />
            手动指定音频 URL（不勾选则自动搜索）
          </label>

          {manualUrl && (
            <div className="add-song-field">
              <label>音频 URL</label>
              <input type="text" value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} placeholder="https://..." />
            </div>
          )}

          {msg && <div className={`add-song-msg add-song-msg-${msg.type}`}>{msg.text}</div>}

          <button className="add-song-submit" onClick={handleAdd} disabled={submitting}>
            {submitting ? '添加中…' : '添加歌曲'}
          </button>

          <div className="add-song-divider" />

          <div className="add-song-batch">
            <button className="add-song-batch-btn" onClick={handleRefreshBatch} disabled={batchBusy !== null}>
              {batchBusy === 'refresh' ? '启动中…' : '刷新失效 URL'}
            </button>
            <button className="add-song-batch-btn" onClick={handleRefreshHot100} disabled={batchBusy !== null}>
              {batchBusy === 'hot100' ? '爬取中…' : '爬取热榜新歌'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
