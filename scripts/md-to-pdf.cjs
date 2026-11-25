/**
 * Markdown to PDF 转换器
 * 流程：Markdown -> HTML -> Edge headless 打印 PDF
 * 用法：node scripts/md-to-pdf.cjs <input.md> <output.pdf>
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const inputPath = path.resolve(process.argv[2]);
const outputPdf = path.resolve(process.argv[3]);
const outputHtml = outputPdf.replace(/\.pdf$/i, '.html');

// ---------- 行内格式 ----------
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseInline(text) {
  let s = escapeHtml(text);
  // 行内代码（先处理，避免内部被粗体影响）
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 粗体
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s;
}

// ---------- 表格 ----------
function parseTableRow(line) {
  return line.split('|').map(c => c.trim()).filter(c => c !== '');
}

function renderTable(headers, rows) {
  let html = '<table>\n<thead>\n<tr>\n';
  for (const h of headers) {
    html += `<th>${parseInline(h)}</th>\n`;
  }
  html += '</tr>\n</thead>\n<tbody>\n';
  for (const row of rows) {
    html += '<tr>\n';
    for (let i = 0; i < headers.length; i++) {
      const cell = i < row.length ? row[i] : '';
      html += `<td>${parseInline(cell)}</td>\n`;
    }
    html += '</tr>\n';
  }
  html += '</tbody>\n</table>\n';
  return html;
}

// ---------- 主解析 ----------
function mdToHtml(md) {
  const lines = md.split('\n');
  let html = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (line.trim() === '') { i++; continue; }

    // 代码块
    if (line.trim().startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      html += `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>\n`;
      continue;
    }

    // 标题
    const hMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      const level = hMatch[1].length;
      html += `<h${level}>${parseInline(hMatch[2])}</h${level}>\n`;
      i++;
      continue;
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && /\|[\s-:]+\|/.test(lines[i + 1])) {
      const headers = parseTableRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      html += renderTable(headers, rows);
      continue;
    }

    // 无序列表
    if (/^(\s*)[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^(\s*)[-*+]\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)[-*+]\s+(.+)/);
        items.push(m[2]);
        i++;
      }
      html += '<ul>\n' + items.map(it => `<li>${parseInline(it)}</li>`).join('\n') + '\n</ul>\n';
      continue;
    }

    // 有序列表
    if (/^(\s*)\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^(\s*)\d+\.\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)\d+\.\s+(.+)/);
        items.push(m[2]);
        i++;
      }
      html += '<ol>\n' + items.map(it => `<li>${parseInline(it)}</li>`).join('\n') + '\n</ol>\n';
      continue;
    }

    // 段落
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^#{1,6}\s/.test(lines[i]) && !lines[i].trim().startsWith('```')) {
      para.push(lines[i]);
      i++;
    }
    html += `<p>${parseInline(para.join(' '))}</p>\n`;
  }

  return html;
}

// ---------- HTML 模板 ----------
function wrapHtml(body) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>音乐盒子推荐算法系统</title>
<style>
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
    max-width: 900px;
    margin: 40px auto;
    padding: 0 40px;
    color: #1F2937;
    line-height: 1.7;
    font-size: 15px;
  }
  h1 { font-size: 28px; color: #111827; border-bottom: 2px solid #2563EB; padding-bottom: 10px; margin-top: 30px; }
  h2 { font-size: 22px; color: #111827; margin-top: 28px; border-left: 4px solid #2563EB; padding-left: 10px; }
  h3 { font-size: 18px; color: #374151; margin-top: 22px; }
  code {
    background: #F3F4F6;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: "Consolas", "Courier New", monospace;
    font-size: 13px;
    color: #BE185D;
  }
  pre {
    background: #F9FAFB;
    border: 1px solid #E5E7EB;
    border-radius: 6px;
    padding: 16px;
    overflow-x: auto;
  }
  pre code {
    background: transparent;
    padding: 0;
    color: #1F2937;
    font-size: 13px;
    line-height: 1.5;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 16px 0;
    font-size: 14px;
  }
  th, td {
    border: 1px solid #D1D5DB;
    padding: 8px 12px;
    text-align: left;
  }
  th {
    background: #EFF6FF;
    font-weight: 600;
    color: #1E40AF;
  }
  tr:nth-child(even) td { background: #F9FAFB; }
  ul, ol { padding-left: 24px; }
  li { margin: 4px 0; }
  strong { color: #111827; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

// ---------- 主程序 ----------
function main() {
  console.log(`读取: ${inputPath}`);
  const md = fs.readFileSync(inputPath, 'utf8');
  const body = mdToHtml(md);
  const html = wrapHtml(body);
  fs.writeFileSync(outputHtml, html, 'utf8');
  console.log(`HTML 已生成: ${outputHtml}`);

  // 查找 Edge
  const edgeCandidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const edge = edgeCandidates.find(p => fs.existsSync(p));
  if (!edge) {
    console.error('未找到 Edge/Chrome 浏览器，无法生成 PDF');
    process.exit(1);
  }

  console.log(`使用浏览器: ${edge}`);
  const fileUrl = 'file:///' + outputHtml.replace(/\\/g, '/');
  // 使用独立的 user-data-dir，避免与已运行的 Edge 实例冲突导致打印任务被转发后直接退出
  const profileDir = path.join(require('os').tmpdir(), 'musicbox-md-to-pdf-profile');
  execFileSync(edge, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    '--user-data-dir=' + profileDir,
    '--print-to-pdf=' + outputPdf,
    fileUrl,
  ], { stdio: 'inherit', timeout: 60000 });

  const stats = fs.statSync(outputPdf);
  console.log(`✅ PDF 生成完成: ${outputPdf} (${(stats.size / 1024).toFixed(1)} KB)`);

  // 清理临时 HTML
  fs.unlinkSync(outputHtml);
  console.log(`已清理临时文件: ${outputHtml}`);
}

main();
