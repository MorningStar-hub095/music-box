import { useState, useEffect, useCallback } from 'react';
import { commentsApi, type CommentListResult, type LyricCommentsResult } from '../services/api';
import CommentItem from './CommentItem';
import CommentInput from './CommentInput';
import './CommentPanel.css';

interface CommentPanelProps {
  songId: string | null;
  show: boolean;
  onClose: () => void;
  currentUserId?: number;
  isAdmin?: boolean;
  currentTimeSec?: number;
}

export default function CommentPanel({ songId, show, onClose, currentUserId, isAdmin, currentTimeSec }: CommentPanelProps) {
  const [tab, setTab] = useState<'song' | 'lyric'>('song');
  const [sort, setSort] = useState<'hot' | 'time'>('hot');
  const [songComments, setSongComments] = useState<CommentListResult | null>(null);
  const [lyricComments, setLyricComments] = useState<LyricCommentsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    if (!songId) return;
    setLoading(true);
    setError(null);
    try {
      if (tab === 'song') {
        const data = await commentsApi.getSongComments(songId, sort, page);
        setSongComments(data);
      } else {
        const data = await commentsApi.getLyricComments(songId);
        setLyricComments(data);
      }
    } catch (e: any) {
      setError(e?.message || '评论加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [songId, tab, sort, page]);

  useEffect(() => { fetchComments(); }, [fetchComments]);

  const handleCreate = async (content: string) => {
    if (!songId) return;
    await commentsApi.create(songId, tab, content, tab === 'lyric' ? currentTimeSec : undefined);
    await fetchComments();
  };

  const handleDelete = (id: string) => {
    if (tab === 'song' && songComments) {
      setSongComments({
        ...songComments,
        comments: songComments.comments.filter(c => String(c.id) !== id),
        total: Math.max(0, songComments.total - 1),
      });
    } else if (tab === 'lyric' && lyricComments) {
      setLyricComments({
        ...lyricComments,
        comments: lyricComments.comments.filter(c => String(c.id) !== id),
      });
    }
  };

  if (!show) return null;

  if (!songId) {
    return (
      <div className="comment-panel-overlay" onClick={onClose}>
        <div className="comment-panel" onClick={(e) => e.stopPropagation()}>
          <div className="comment-panel-header">
            <h3>评论</h3>
            <button className="close-btn" onClick={onClose}>&times;</button>
          </div>
          <div className="empty">请先播放一首歌曲，再查看评论</div>
        </div>
      </div>
    );
  }

  return (
    <div className="comment-panel-overlay" onClick={onClose}>
      <div className="comment-panel" onClick={(e) => e.stopPropagation()}>
        <div className="comment-panel-header">
          <h3>评论</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="comment-tabs">
          <button className={tab === 'song' ? 'active' : ''} onClick={() => { setTab('song'); setPage(1); }}>
            歌曲评论
          </button>
          <button className={tab === 'lyric' ? 'active' : ''} onClick={() => { setTab('lyric'); setPage(1); }}>
            歌词评论
          </button>
        </div>

        {tab === 'song' && (
          <div className="sort-selector">
            <button className={sort === 'hot' ? 'active' : ''} onClick={() => setSort('hot')}>最热</button>
            <button className={sort === 'time' ? 'active' : ''} onClick={() => setSort('time')}>最新</button>
          </div>
        )}

        {currentUserId && (
          <CommentInput
            onSubmit={handleCreate}
            placeholder={tab === 'lyric' && currentTimeSec != null
              ? `在 ${Math.floor(currentTimeSec / 60)}:${String(Math.floor(currentTimeSec % 60)).padStart(2, '0')} 发表评论...`
              : '写下你的评论...'}
          />
        )}

        <div className="comment-list">
          {loading && <div className="loading">加载中...</div>}
          {error && !loading && <div className="error-hint">{error}</div>}

          {tab === 'song' && songComments && (
            <>
              {songComments.comments.length === 0 ? (
                <div className="empty">暂无评论，快来抢沙发吧！</div>
              ) : (
                <>
                  {songComments.comments.map((c) => (
                    <CommentItem
                      key={String(c.id)}
                      comment={c}
                      currentUserId={currentUserId}
                      isAdmin={isAdmin}
                      onDelete={handleDelete}
                    />
                  ))}
                  {songComments.total > songComments.pageSize && (
                    <div className="pagination">
                      <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
                      <span>{page} / {Math.ceil(songComments.total / songComments.pageSize)}</span>
                      <button disabled={page >= Math.ceil(songComments.total / songComments.pageSize)} onClick={() => setPage(p => p + 1)}>下一页</button>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {tab === 'lyric' && lyricComments && (
            <>
              {lyricComments.comments.length === 0 ? (
                <div className="empty">暂无歌词评论</div>
              ) : (
                lyricComments.comments.map((c) => (
                  <CommentItem
                    key={String(c.id)}
                    comment={c}
                    currentUserId={currentUserId}
                    isAdmin={isAdmin}
                    onDelete={handleDelete}
                    showTimestamp
                  />
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
