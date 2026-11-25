import {
  parseTrackId,
  cleanExpiredCache,
  getRequestStats,
} from '../src/modules/url-manager/music-api.service';

describe('parseTrackId', () => {
  it('解析 netease 前缀', () => {
    expect(parseTrackId('netease:12345')).toEqual({ songId: '12345', source: 'netease' });
  });
  it('解析 qq 前缀', () => {
    expect(parseTrackId('qq:000BH3xa3Wvqad')).toEqual({ songId: '000BH3xa3Wvqad', source: 'qq' });
  });
  it('解析 kugou 前缀', () => {
    expect(parseTrackId('kugou:ABC123')).toEqual({ songId: 'ABC123', source: 'kugou' });
  });
  it('无前缀时默认 netease 且剥离冒号前内容', () => {
    expect(parseTrackId('x:987')).toEqual({ songId: '987', source: 'netease' });
    expect(parseTrackId('987')).toEqual({ songId: '987', source: 'netease' });
  });
});

describe('缓存与统计', () => {
  it('初始缓存清理数与请求统计为零', () => {
    expect(cleanExpiredCache()).toBe(0);
    expect(getRequestStats()).toEqual({
      netease: { success: 0, fail: 0 },
      qq: { success: 0, fail: 0 },
      kugou: { success: 0, fail: 0 },
    });
  });
});
