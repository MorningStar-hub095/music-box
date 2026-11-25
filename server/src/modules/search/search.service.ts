import { BaseSearchService } from './search.base.service';

// ==================== 基础搜索服务 ====================

/**
 * 2026-10-26 清理：原 SearchService.searchSongs 与 EnhancedSearchService.searchSongs
 * 重复实现，且生产代码只调用 enhanced 版（见 search.controller.ts），
 * 故删除本类的死方法。本类现仅承载 BaseSearchService 的共享实现
 * （suggestions / hotSearches / categoryStats / clearSearchCache）。
 */
export class SearchService extends BaseSearchService {}

// 导出单例
export const searchService = new SearchService();

export default searchService;
