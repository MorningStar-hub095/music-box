// 对照实验：同一 URL 重复请求 x5，对比 无UA / 带浏览器UA 的结果稳定性
const https = require('https');
const url = 'https://api.jamendo.com/v3.0/tracks/?client_id=b50cfeff&format=json&limit=3&offset=0&audioformat=mp32&audiodownload_allowed=true&include=musicinfo&groupby=artist_id&tags=piano';

function fetchOnce(ua) {
  return new Promise((resolve) => {
    const opts = { timeout: 30000 };
    if (ua) opts.headers = { 'User-Agent': ua };
    const req = https.get(url, opts, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve({ status: res.statusCode, n: (j.results || []).length, apiStatus: j.headers.status });
        } catch (e) { resolve({ status: res.statusCode, n: -1, apiStatus: 'parse_fail' }); }
      });
    });
    req.on('error', e => resolve({ status: 0, n: -1, apiStatus: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, n: -1, apiStatus: 'timeout' }); });
  });
}

(async () => {
  console.log('== 无 UA x5:');
  for (let i = 0; i < 5; i++) console.log(' ', JSON.stringify(await fetchOnce(null)));
  console.log('== 带浏览器 UA x5:');
  for (let i = 0; i < 5; i++) console.log(' ', JSON.stringify(await fetchOnce('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36')));
  process.exit(0);
})();
