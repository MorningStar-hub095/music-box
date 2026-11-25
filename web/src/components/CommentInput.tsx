import { useState } from 'react';

interface CommentInputProps {
  onSubmit: (content: string) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
}

export default function CommentInput({ onSubmit, placeholder = '写下你的评论...', disabled }: CommentInputProps) {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!content.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(content.trim());
      setContent('');
    } catch (err: any) {
      setError(err.message || '发布失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="comment-input">
      <textarea
        value={content}
        onChange={(e) => { setContent(e.target.value); setError(null); }}
        placeholder={placeholder}
        maxLength={500}
        rows={3}
        disabled={disabled || submitting}
      />
      <div className="comment-input-footer">
        <span className="char-count">{content.length}/500</span>
        {error && <span className="error">{error}</span>}
        <button onClick={handleSubmit} disabled={!content.trim() || submitting || disabled}>
          {submitting ? '发布中...' : '发布'}
        </button>
      </div>
    </div>
  );
}
