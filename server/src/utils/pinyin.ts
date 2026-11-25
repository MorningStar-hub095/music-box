import { pinyin } from 'pinyin-pro';

/**
 * 获取汉字的拼音
 * @param text 输入文本
 * @returns 拼音字符串（小写，无空格）
 */
export function getPinyin(text: string): string {
  if (!text) return '';
  return pinyin(text, { toneType: 'none', type: 'array' }).join('').toLowerCase();
}

/**
 * 获取汉字的拼音首字母
 * @param text 输入文本
 * @returns 首字母字符串（小写）
 */
export function getFirstLetter(text: string): string {
  if (!text) return '';
  return pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase();
}

/**
 * 检查文本是否匹配拼音查询
 * @param text 原始文本
 * @param query 查询文本（可能是拼音）
 * @returns 是否匹配
 */
export function matchPinyin(text: string, query: string): boolean {
  if (!text || !query) return false;

  const lowerQuery = query.toLowerCase();
  const fullPinyin = getPinyin(text);
  const firstLetter = getFirstLetter(text);

  // 匹配全拼或首字母
  return fullPinyin.includes(lowerQuery) || firstLetter.includes(lowerQuery);
}

/**
 * 生成搜索关键词的拼音变体
 * @param text 输入文本
 * @returns 拼音变体数组
 */
export function generatePinyinVariants(text: string): string[] {
  if (!text) return [];

  const variants = new Set<string>();
  variants.add(getPinyin(text));
  variants.add(getFirstLetter(text));

  return Array.from(variants).filter(Boolean);
}
