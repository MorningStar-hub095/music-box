/**
 * 搜索查询规范化与分词工具（2026-11-20 搜索全面升级）
 *
 * 职责：为本地（SQL where）与线上（Jamendo）搜索提供统一的查询预处理，
 * 保证"线上/线下搜索流程统一、同一关键词行为一致"。
 *
 * 解决的存量问题：
 *  1. 全角/半角不一致（如 "ＡＢ" vs "AB"、"　"(全角空格) vs " "）导致同一关键词
 *     命中结果不同；
 *  2. 零宽字符（复制粘贴来源网页时混入 \u200b 等）导致 contains 永远不命中；
 *  3. "歌手 歌名" 组合词整串 contains 匹配不到任何单字段 → 需分词后逐词匹配。
 */

/**
 * 查询规范化：NFKC 归一（全角→半角等）→ 去零宽字符 → 连续空白压缩为单空格 → trim
 * 旧实现（保留备查）：调用方各自 trim，未做任何归一。
 *   const q = raw.trim();
 */
export function normalizeQuery(raw: string): string {
  if (!raw) return '';
  let q = raw.normalize('NFKC');
  // 去除零宽字符（零宽空格/方向控制符/BOM）
  q = q.replace(/[\u200b-\u200f\u202a-\u202e\uFEFF]/g, '');
  // 连续空白（含全角空格 U+3000，NFKC 已将其转为普通空格）压缩为单个空格
  q = q.replace(/\s+/g, ' ').trim();
  return q;
}

/**
 * 分词：按空格拆分（规范化后），空 token 过滤
 */
export function tokenizeQuery(raw: string): string[] {
  const q = normalizeQuery(raw);
  if (!q) return [];
  return q.split(' ').filter(Boolean);
}

/**
 * 构建关键词匹配条件（用于 Prisma where）：
 *  - 单词：OR(title/artist/album contains, 大小写不敏感)
 *  - 多词：每个词命中任一字段即可（词内 OR），词与词之间 AND
 *
 * 旧实现（保留备查，2026-11-20 之前）：
 *   where.OR = [
 *     { title:  { contains: filters.q } },
 *     { artist: { contains: filters.q } },
 *     { album:  { contains: filters.q } },
 *   ];
 *  存量缺陷：①PostgreSQL contains 默认区分大小写 → 英文歌手名 "coldplay" 搜不到
 *  库里的 "Coldplay"；②整串 contains → 组合词永不命中；③全角/零宽字符不归一。
 */
export function buildKeywordConditions(q: string): { or?: any[]; and?: any[] } {
  const tokens = tokenizeQuery(q);
  if (tokens.length === 0) return {};
  if (tokens.length === 1) {
    const t = tokens[0];
    return {
      or: [
        { title: { contains: t, mode: 'insensitive' } },
        { artist: { contains: t, mode: 'insensitive' } },
        { album: { contains: t, mode: 'insensitive' } },
      ],
    };
  }
  return {
    and: tokens.map(t => ({
      OR: [
        { title: { contains: t, mode: 'insensitive' } },
        { artist: { contains: t, mode: 'insensitive' } },
        { album: { contains: t, mode: 'insensitive' } },
      ],
    })),
  };
}
