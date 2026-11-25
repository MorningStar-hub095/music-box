import { BaseSearchService } from '../../src/modules/search/search.base.service';

/**
 * 测试辅助：BaseSearchService.buildOrderBy 是 protected，
 * 通过子类暴露成公共方法供断言。
 */
export function buildOrderByHarness(cls: new () => BaseSearchService) {
  const instance = new (class extends cls {
    public order(sort?: string, order?: string) {
      return (this as any).buildOrderBy(sort, order);
    }
  })();
  return (sort?: string, order?: string) => instance.order(sort, order);
}
