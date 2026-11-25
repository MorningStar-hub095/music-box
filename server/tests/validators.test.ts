import { createSongSchema, updateSongSchema } from '../src/validators/song.validator';

describe('Song Validator', () => {
  describe('createSongSchema', () => {
    it('should validate valid song data', () => {
      const validData = {
        id: 'test-123',
        title: 'Test Song',
        artist: 'Test Artist',
        audioUrl: 'https://example.com/audio.mp3',
      };

      const result = createSongSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject empty title', () => {
      const invalidData = {
        id: 'test-123',
        title: '',
        artist: 'Test Artist',
        audioUrl: 'https://example.com/audio.mp3',
      };

      const result = createSongSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('歌曲标题不能为空');
      }
    });

    it('should reject invalid URL', () => {
      const invalidData = {
        id: 'test-123',
        title: 'Test Song',
        artist: 'Test Artist',
        audioUrl: 'not-a-url',
      };

      const result = createSongSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('音频URL格式无效');
      }
    });

    it('should reject invalid cover color format', () => {
      const invalidData = {
        id: 'test-123',
        title: 'Test Song',
        artist: 'Test Artist',
        audioUrl: 'https://example.com/audio.mp3',
        coverColor: 'invalid-color',
      };

      const result = createSongSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('封面颜色格式无效');
      }
    });

    it('should accept valid cover color', () => {
      const validData = {
        id: 'test-123',
        title: 'Test Song',
        artist: 'Test Artist',
        audioUrl: 'https://example.com/audio.mp3',
        coverColor: '#FF5733',
      };

      const result = createSongSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject invalid platform', () => {
      const invalidData = {
        id: 'test-123',
        title: 'Test Song',
        artist: 'Test Artist',
        audioUrl: 'https://example.com/audio.mp3',
        platform: 'invalid-platform',
      };

      const result = createSongSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should accept valid platform', () => {
      const validData = {
        id: 'test-123',
        title: 'Test Song',
        artist: 'Test Artist',
        audioUrl: 'https://example.com/audio.mp3',
        platform: 'netease',
      };

      const result = createSongSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject invalid id format', () => {
      const invalidData = {
        id: 'test@123!',
        title: 'Test Song',
        artist: 'Test Artist',
        audioUrl: 'https://example.com/audio.mp3',
      };

      const result = createSongSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('歌曲ID只能包含字母、数字、下划线和连字符');
      }
    });
  });

  describe('updateSongSchema', () => {
    it('should allow partial updates', () => {
      const partialData = {
        title: 'Updated Title',
      };

      const result = updateSongSchema.safeParse(partialData);
      expect(result.success).toBe(true);
    });

    it('should validate fields when provided', () => {
      const invalidData = {
        title: '',
      };

      const result = updateSongSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should allow empty update', () => {
      const emptyData = {};

      const result = updateSongSchema.safeParse(emptyData);
      expect(result.success).toBe(true);
    });
  });
});
