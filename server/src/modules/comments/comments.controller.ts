import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as commentService from './comments.service';

export class CommentsController {
  async create(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const { songId, commentType, content, timestampSec } = req.body;

      if (!songId || !commentType || !content) {
        return res.status(400).json({ success: false, error: '缺少必填字段' });
      }
      if (!['song', 'lyric'].includes(commentType)) {
        return res.status(400).json({ success: false, error: 'commentType 必须是 song 或 lyric' });
      }

      const result = await commentService.createComment(userId, songId, commentType, content, timestampSec);
      if (result.error) return res.status(400).json({ success: false, error: result.error });
      res.json({ success: true, data: result.comment });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getSongComments(req: AuthRequest, res: Response) {
    try {
      const { songId } = req.params;
      const sort = (req.query.sort as string) || 'hot';
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 50);

      const result = await commentService.getSongComments(songId, sort as 'hot' | 'time', page, pageSize);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getLyricComments(req: AuthRequest, res: Response) {
    try {
      const { songId } = req.params;
      const result = await commentService.getLyricComments(songId);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async deleteComment(req: AuthRequest, res: Response) {
    try {
      const commentId = BigInt(req.params.id);
      const userId = req.user!.id;
      const isAdmin = ['admin', 'super_admin'].includes(req.user!.role);

      const result = await commentService.deleteComment(commentId, userId, isAdmin);
      if (result.error) return res.status(400).json({ success: false, error: result.error });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async toggleLike(req: AuthRequest, res: Response) {
    try {
      const commentId = BigInt(req.params.id);
      const userId = req.user!.id;
      const result = await commentService.toggleLike(commentId, userId);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async isLiked(req: AuthRequest, res: Response) {
    try {
      const commentId = BigInt(req.params.id);
      const userId = req.user!.id;
      const result = await commentService.isLiked(commentId, userId);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async report(req: AuthRequest, res: Response) {
    try {
      const commentId = BigInt(req.params.id);
      const userId = req.user!.id;
      const { reason } = req.body;

      if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        return res.status(400).json({ success: false, error: '请提供举报原因' });
      }

      const result = await commentService.reportComment(commentId, userId, reason.trim());
      if (result.error) return res.status(400).json({ success: false, error: result.error });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getReports(req: AuthRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 50);
      const result = await commentService.getReports(page, pageSize);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async updateStatus(req: AuthRequest, res: Response) {
    try {
      const commentId = BigInt(req.params.id);
      const { status } = req.body;
      if (!['active', 'hidden'].includes(status)) {
        return res.status(400).json({ success: false, error: 'status 必须是 active 或 hidden' });
      }
      const result = await commentService.updateCommentStatus(commentId, status);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}
