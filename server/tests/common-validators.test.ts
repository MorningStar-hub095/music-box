import { paginationSchema, sortSchema, idParamSchema, batchIdsSchema } from '../src/validators/common.validator';

describe('Common Validators', () => {
  describe('paginationSchema', () => {
    it('should use default values', () => {
      const result = paginationSchema.parse({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should accept valid pagination', () => {
      const result = paginationSchema.parse({ page: '2', limit: '50' });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(50);
    });

    it('should reject page less than 1', () => {
      const result = paginationSchema.safeParse({ page: '0' });
      expect(result.success).toBe(false);
    });

    it('should reject limit greater than 100', () => {
      const result = paginationSchema.safeParse({ limit: '200' });
      expect(result.success).toBe(false);
    });
  });

  describe('sortSchema', () => {
    it('should use default values', () => {
      const result = sortSchema.parse({});
      expect(result.sort).toBe('hot_score');
      expect(result.order).toBe('desc');
    });

    it('should accept valid sort fields', () => {
      const result = sortSchema.parse({ sort: 'title', order: 'asc' });
      expect(result.sort).toBe('title');
      expect(result.order).toBe('asc');
    });

    it('should reject invalid sort field', () => {
      const result = sortSchema.safeParse({ sort: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  describe('idParamSchema', () => {
    it('should accept valid id', () => {
      const result = idParamSchema.parse({ id: 'test-123' });
      expect(result.id).toBe('test-123');
    });

    it('should reject empty id', () => {
      const result = idParamSchema.safeParse({ id: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('batchIdsSchema', () => {
    it('should accept valid batch ids', () => {
      const result = batchIdsSchema.parse({ songIds: ['id1', 'id2'] });
      expect(result.songIds).toEqual(['id1', 'id2']);
    });

    it('should reject empty array', () => {
      const result = batchIdsSchema.safeParse({ songIds: [] });
      expect(result.success).toBe(false);
    });

    it('should reject array with empty strings', () => {
      const result = batchIdsSchema.safeParse({ songIds: ['id1', ''] });
      expect(result.success).toBe(false);
    });
  });
});
