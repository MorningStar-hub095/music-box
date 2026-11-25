/**
 * RadioPlaylist - 全自动 AI 电台推荐歌单面板
 * 展示推荐歌单，点击歌曲播放，支持「换一批」、LLM API 配置与关闭
 */

import { useState, useEffect } from 'react';
import { Track } from '@/types';
import { radioAPI } from '../services/api';
import LlmConfigPanel from './LlmConfigPanel';
import './RadioPlaylist.css';

interface RadioPlaylistProps {
  visible: boolean;
  songs: Track[];
  loading: boolean;
  refreshing: boolean;
  currentTrackId?: string;
  onClose: () => void;
  onPlaySong: (song: Track) => void;
  onRefresh: () => void;
  notice?: string | null;
}

export default function RadioPlaylist({
  visible,
  songs,
  loading,
  refreshing,
  currentTrackId,
  onClose,
  onPlaySong,
  onRefresh,
  notice,
}: RadioPlaylistProps) {
  const [showLlmConfig, setShowLlmConfig] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState(true);

  // 打开面板时检查 LLM 配置状态
  useEffect(() => {
    if (!visible) return;
    radioAPI.status()
      .then(res => setLlmConfigured(res.configured))
      .catch(() => setLlmConfigured(true));
  }, [visible]);

  // 实时定位到正在播放的歌曲（切歌、打开面板、歌单更新时滚动到高亮项）
  useEffect(() => {
    if (!visible || !currentTrackId) return;
    const el = document.querySelector('.radio-playlist-item.active');
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [visible, currentTrackId, songs.length]);

  if (!visible) return null;

  return (
    <>
      <div className="radio-playlist-overlay" onClick={onClose} />
      <div className="radio-playlist">
        <div className="radio-playlist-header">
          <span>
            AI 电台 · 推荐歌单
            <span
              className={`radio-llm-badge${llmConfigured ? ' configured' : ''}`}
              title="LLM API 状态"
            >
              {llmConfigured ? 'LLM' : 'LLM 未配置'}
            </span>
          </span>
          <div className="radio-playlist-header-actions">
            <button
              className={showLlmConfig ? 'active' : ''}
              onClick={() => setShowLlmConfig(v => !v)}
              title="LLM API 配置"
            >
              ⚙️
            </button>
            <button onClick={onRefresh} title="换一批" disabled={refreshing}>
              {refreshing ? '生成中…' : '↻ 换一批'}
            </button>
            <button onClick={onClose} title="关闭">✕</button>
          </div>
        </div>

        <LlmConfigPanel visible={showLlmConfig} onClose={() => setShowLlmConfig(false)} />

        {notice && <div className="radio-playlist-notice">{notice}</div>}

        <div className="radio-playlist-body">
          {loading && songs.length === 0 && (
            <div className="radio-playlist-loading">正在生成推荐歌单…</div>
          )}
          {!loading && songs.length === 0 && (
            <div className="radio-playlist-empty">暂无推荐歌曲，点击「↻ 换一批」试试</div>
          )}
          {songs.map((song, idx) => (
            <div
              key={song.id}
              className={`radio-playlist-item${currentTrackId === song.id ? ' active' : ''}`}
              onClick={() => onPlaySong(song)}
            >
              <span className="radio-playlist-index">{idx + 1}</span>
              <span className="radio-playlist-title">{song.title}</span>
              <span className="radio-playlist-artist">{song.artist}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
