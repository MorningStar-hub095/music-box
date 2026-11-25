import { useState } from 'react';
import type { CommentData } from '../services/api';
import { commentsApi } from '../services/api';

interface CommentItemProps {
  comment: CommentData;
  currentUserId?: number;
  isAdmin?: boolean;
  onDelete?: (id: string) => void;
  showTimestamp?: boolean;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return new Date(dateStr).toLocaleDateString();
}

export default function CommentItem({ comment, currentUserId, isAdmin, onDelete, showTimestamp }: CommentItemProps) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(comment.likeCount);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState('');

  const isOwner = currentUserId === comment.userId;
  const canDelete = isOwner || isAdmin;

  const handleLike = async () => {
    try {
      const result = await commentsApi.toggleLike(String(comment.id));
      setLiked(result.liked);
      setLikeCount(prev => result.liked ? prev + 1 : prev - 1);
    } catch {}
  };

  const handleReport = async () => {
    if (!reportReason.trim()) return;
    try {
      await commentsApi.report(String(comment.id), reportReason.trim());
      setShowReport(false);
      setReportReason('');
      alert('举报已提交');
    } catch (err: any) {
      alert(err.message || '举报失败');
    }
  };

  const handleDelete = async () => {
    if (!confirm('确定要删除这条评论吗？')) return;
    try {
      await commentsApi.delete(String(comment.id));
      onDelete?.(String(comment.id));
    } catch (err: any) {
      alert(err.message || '删除失败');
    }
  };

  return (
    <div className="comment-item">
      <div className="comment-header">
        <span className="username">{comment.user.username}</span>
        {showTimestamp && comment.timestampSec != null && (
          <span className="timestamp-badge">{formatTime(comment.timestampSec)}</span>
        )}
        <span className="time">{relativeTime(comment.createdAt)}</span>
      </div>
      <div className="comment-content">{comment.content}</div>
      <div className="comment-actions">
        <button className={`like-btn ${liked ? 'liked' : ''}`} onClick={handleLike}>
          👍 {likeCount > 0 ? likeCount : ''}
        </button>
        <button className="report-btn" onClick={() => setShowReport(!showReport)}>举报</button>
        {canDelete && <button className="delete-btn" onClick={handleDelete}>删除</button>}
      </div>
      {showReport && (
        <div className="report-form">
          <input
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            placeholder="请输入举报原因"
            maxLength={200}
          />
          <button onClick={handleReport}>提交</button>
          <button onClick={() => setShowReport(false)}>取消</button>
        </div>
      )}
    </div>
  );
}
