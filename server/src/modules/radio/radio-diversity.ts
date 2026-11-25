// server/src/modules/radio/radio-diversity.ts
// 电台多样性工具：加权随机采样 + 洗牌，让推荐每次略有不同（对标网易云「心动模式」的探索性）
// 权重越高的歌曲越可能被选中，同时保留随机性，避免每次重启/刷新都返回相同热门歌单。

/** Fisher-Yates 洗牌（不修改原数组） */
export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 加权随机采样（不重复）；k 超过长度时返回全部洗牌结果 */
export function weightedSample<T>(
  items: T[],
  k: number,
  rand: () => number = Math.random,
  weightFn: (item: T) => number = () => 1,
): T[] {
  if (k <= 0 || items.length === 0) return [];
  if (k >= items.length) return shuffle(items, rand);

  const remaining = [...items];
  const picked: T[] = [];

  while (picked.length < k && remaining.length > 0) {
    let totalWeight = 0;
    for (const it of remaining) totalWeight += Math.max(0, weightFn(it));

    // 权重全为 0 时退化为均匀随机，避免除零
    if (totalWeight <= 0) {
      const idx = Math.floor(rand() * remaining.length);
      picked.push(remaining.splice(idx, 1)[0]);
      continue;
    }

    let r = rand() * totalWeight;
    let idx = 0;
    for (let i = 0; i < remaining.length; i++) {
      r -= Math.max(0, weightFn(remaining[i]));
      if (r <= 0) { idx = i; break; }
    }
    picked.push(remaining.splice(idx, 1)[0]);
  }

  return picked;
}
