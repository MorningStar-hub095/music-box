describe('urlManagerConfig', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    // 每个用例前重置模块缓存并隔离环境变量，确保 config 按当前 env 重新求值
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('使用默认值', () => {
    delete process.env.URL_CACHE_TTL;
    delete process.env.URL_REFRESH_MAX_RETRIES;
    delete process.env.ALERT_VALIDITY_THRESHOLD;

    const { urlManagerConfig } = require('../src/modules/url-manager/url-manager.config');
    expect(urlManagerConfig.cacheTtl).toBe(30 * 60 * 1000);
    expect(urlManagerConfig.retry.maxRetries).toBe(2);
    expect(urlManagerConfig.alert.validityRateThreshold).toBe(0.8);
  });

  it('环境变量覆盖默认值', () => {
    process.env.URL_CACHE_TTL = '60000';
    process.env.URL_REFRESH_MAX_RETRIES = '5';
    process.env.ALERT_VALIDITY_THRESHOLD = '0.6';

    const { urlManagerConfig } = require('../src/modules/url-manager/url-manager.config');
    expect(urlManagerConfig.cacheTtl).toBe(60000);
    expect(urlManagerConfig.retry.maxRetries).toBe(5);
    expect(urlManagerConfig.alert.validityRateThreshold).toBe(0.6);
  });

  it('非法数字回退默认值', () => {
    process.env.URL_CACHE_TTL = 'not-a-number';

    const { urlManagerConfig } = require('../src/modules/url-manager/url-manager.config');
    expect(urlManagerConfig.cacheTtl).toBe(30 * 60 * 1000);
  });
});
