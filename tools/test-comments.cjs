const http = require('http');

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: 49200, path, method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
    };
    const req = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // 1. 获取访客token（带重试）
  console.log('=== Getting guest token ===');
  let token = null;
  for (let i = 0; i < 5; i++) {
    const g = await request('POST', '/api/auth/guest', {});
    if (g.body.data) { token = g.body.data.token; console.log('Guest token OK'); break; }
    console.log('Rate limited, waiting 5s...');
    await sleep(5000);
  }
  if (!token) { console.log('Cannot get token'); return; }

  // 2. 发布正常评论
  console.log('\n=== Test 1: Normal comment ===');
  const c1 = await request('POST', '/api/comments', { songId: 'netease:28059417', commentType: 'song', content: 'Great song love it!' }, token);
  console.log('Result:', c1.body.success ? 'PASS' : 'BLOCK', '- ID=' + (c1.body.data ? c1.body.data.id : c1.body.error));

  // 3. 敏感词测试
  console.log('\n=== Test 2: Sensitive words ===');
  const tests = [
    ['s3x music here', 'BLOCK', 'regex s3x'],
    ['f*ck this is good', 'BLOCK', 'regex f*ck'],
    ['nice s h i t song', 'BLOCK', 'regex shit'],
    ['b1tch please', 'BLOCK', 'regex b1tch'],
    ['hello world', 'PASS', 'clean text'],
  ];
  for (const [content, expect, label] of tests) {
    const r = await request('POST', '/api/comments', { songId: 'netease:28059417', commentType: 'song', content }, token);
    const result = r.body.success ? 'PASS' : 'BLOCK';
    console.log(`  ${label}: "${content}" -> ${result} [${result === expect ? 'OK' : 'FAIL'}]`);
  }

  // 4. 举报自动隐藏测试
  console.log('\n=== Test 3: Report auto-hide ===');
  const c3 = await request('POST', '/api/comments', { songId: 'netease:28059417', commentType: 'song', content: 'Report test comment' }, token);
  const testId = String(c3.body.data.id);
  console.log('Created comment ID=' + testId);

  for (let i = 1; i <= 5; i++) {
    await sleep(3000); // 等待避免限流
    let gt = null;
    for (let j = 0; j < 3; j++) {
      const g = await request('POST', '/api/auth/guest', {});
      if (g.body.data) { gt = g.body.data.token; break; }
      await sleep(5000);
    }
    if (!gt) { console.log('Report ' + i + ': skipped (no token)'); continue; }
    const r = await request('POST', '/api/comments/' + testId + '/report', { reason: 'spam ' + i }, gt);
    console.log('Report ' + i + ': status=' + r.status + ' success=' + r.body.success);
  }

  // 5. 验证最终状态
  console.log('\n=== Final verification ===');
  const list = await request('GET', '/api/comments/song/netease:28059417', null, token);
  console.log('Active comments: ' + list.body.data.comments.length);
  list.body.data.comments.forEach(c =>
    console.log('  ID=' + c.id + ' status=' + c.status + ' reportCount=' + c.reportCount)
  );

  // 检查被举报的评论是否还在列表中
  const hidden = list.body.data.comments.find(c => c.id === testId);
  if (hidden) {
    console.log('\nComment ' + testId + ' still visible: status=' + hidden.status + ' reportCount=' + hidden.reportCount);
  } else {
    console.log('\nComment ' + testId + ' NOT in active list -> AUTO-HIDE WORKING!');
  }
}

main().catch(console.error);
