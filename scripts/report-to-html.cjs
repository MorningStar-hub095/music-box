#!/usr/bin/env node
/**
 * 将 Markdown 报告转换为带有专业排版样式的 HTML，
 * 并提供使用浏览器打印为 PDF 的指引
 */
'use strict';

const fs = require('fs');
const path = require('path');

const mdPath = path.join(__dirname, '..', 'docs', 'project-full-summary.md');
const htmlPath = path.join(__dirname, '..', 'docs', 'project-full-summary.html');

const md = fs.readFileSync(mdPath, 'utf8');

// 简易 Markdown → HTML 转换（覆盖报告中的所有语法）
function mdToHtml(text) {
  let html = text;

  // 转义 HTML 特殊字符（保留 markdown 语法）
  // 不做全局转义，因为代码块中包含 < > 等符号

  // 代码块（先处理，避免内部被转换）
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code class="language-${lang || 'text'}">${escHtml(code.trim())}</code></pre>`);
    return `%%CODEBLOCK_${idx}%%`;
  });

  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 标题
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // 分隔线
  html = html.replace(/^---$/gm, '<hr>');

  // 引用块
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  // 合并连续的 blockquote
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '<br>');

  // 粗体和斜体
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 表格
  html = html.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)*)/gm, (match, headerRow, sepRow, bodyRows) => {
    const headers = headerRow.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
    const rows = bodyRows.trim().split('\n').map(row => {
      const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // 无序列表
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // 段落（将非标签开头的行包裹为 <p>）
  html = html.replace(/^(?!<[hupblo]|<hr|<table|<pre|<ul|<li|<strong|<em|<code|<blockquote|%%CODEBLOCK)(.+)$/gm, '<p>$1</p>');

  // 还原代码块
  html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (_, idx) => codeBlocks[parseInt(idx)]);

  // 清理多余空行
  html = html.replace(/\n{3,}/g, '\n\n');

  return html;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const body = mdToHtml(md);

const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>音乐盒子项目全面总结报告</title>
<style>
  @page {
    size: A4;
    margin: 25mm 20mm 25mm 20mm;
  }
  @media print {
    body { font-size: 11pt; }
    h1 { page-break-before: always; }
    h1:first-of-type { page-break-before: avoid; }
    table { page-break-inside: avoid; }
    pre { page-break-inside: avoid; }
    blockquote { page-break-inside: avoid; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
    font-size: 12pt;
    line-height: 1.8;
    color: #1a1a2e;
    background: #fff;
    max-width: 210mm;
    margin: 0 auto;
    padding: 30mm 20mm;
  }
  h1 {
    font-size: 22pt;
    color: #0f3460;
    border-bottom: 3px solid #0f3460;
    padding-bottom: 10px;
    margin: 40px 0 20px 0;
    letter-spacing: 1px;
  }
  h2 {
    font-size: 16pt;
    color: #16213e;
    border-left: 5px solid #e94560;
    padding-left: 12px;
    margin: 35px 0 18px 0;
  }
  h3 {
    font-size: 13pt;
    color: #0f3460;
    margin: 25px 0 12px 0;
    padding-bottom: 5px;
    border-bottom: 1px solid #e0e0e0;
  }
  h4 {
    font-size: 12pt;
    color: #16213e;
    margin: 18px 0 8px 0;
  }
  p {
    margin: 8px 0;
    text-align: justify;
  }
  strong {
    color: #0f3460;
    font-weight: 600;
  }
  em {
    color: #533483;
  }
  code {
    background: #f0f0f5;
    color: #e94560;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: "Cascadia Code", "Fira Code", Consolas, monospace;
    font-size: 10pt;
  }
  pre {
    background: #1a1a2e;
    color: #e0e0e0;
    padding: 16px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 12px 0;
    font-size: 9pt;
    line-height: 1.5;
    border: 1px solid #2a2a4a;
  }
  pre code {
    background: none;
    color: inherit;
    padding: 0;
    font-size: 9pt;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 10pt;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    border-radius: 6px;
    overflow: hidden;
  }
  th {
    background: linear-gradient(135deg, #0f3460, #16213e);
    color: #fff;
    padding: 10px 12px;
    text-align: left;
    font-weight: 600;
    letter-spacing: 0.5px;
  }
  td {
    padding: 8px 12px;
    border-bottom: 1px solid #eee;
  }
  tr:nth-child(even) {
    background: #f8f9fc;
  }
  tr:hover {
    background: #e8eaf6;
  }
  hr {
    border: none;
    height: 2px;
    background: linear-gradient(90deg, #0f3460, #e94560, #0f3460);
    margin: 30px 0;
  }
  blockquote {
    border-left: 4px solid #533483;
    background: #f5f0ff;
    padding: 12px 16px;
    margin: 12px 0;
    border-radius: 0 6px 6px 0;
    font-style: italic;
    color: #3a3a5a;
  }
  ul {
    margin: 8px 0 8px 24px;
  }
  li {
    margin: 4px 0;
  }
  a {
    color: #0f3460;
    text-decoration: none;
    border-bottom: 1px dashed #e94560;
  }
  a:hover {
    color: #e94560;
  }
  /* 封面样式 */
  .cover {
    text-align: center;
    padding: 80px 0 40px 0;
    border-bottom: 3px solid #0f3460;
    margin-bottom: 40px;
  }
  .cover h1 {
    font-size: 28pt;
    border: none;
    color: #0f3460;
    margin-bottom: 15px;
  }
  .cover .version-badge {
    display: inline-block;
    background: linear-gradient(135deg, #e94560, #533483);
    color: #fff;
    padding: 4px 14px;
    border-radius: 12px;
    font-size: 10pt;
    margin-bottom: 20px;
    letter-spacing: 1px;
  }
  .cover .subtitle {
    font-size: 14pt;
    color: #533483;
    margin-bottom: 30px;
  }
  .cover .meta {
    font-size: 11pt;
    color: #666;
    line-height: 2;
  }
  /* 目录样式 */
  .toc {
    background: #f8f9fc;
    padding: 20px 30px;
    border-radius: 8px;
    margin: 20px 0 30px 0;
    border: 1px solid #e0e0e0;
  }
  .toc a {
    color: #0f3460;
    border-bottom: none;
  }
  /* 提示框 */
  .note {
    background: #fff3e0;
    border-left: 4px solid #ff9800;
    padding: 10px 14px;
    border-radius: 0 6px 6px 0;
    margin: 10px 0;
  }
  /* 指标卡片 */
  .metric {
    display: inline-block;
    text-align: center;
    padding: 10px 20px;
    margin: 5px;
    background: linear-gradient(135deg, #0f3460, #16213e);
    color: #fff;
    border-radius: 8px;
    min-width: 120px;
  }
  .metric .value {
    font-size: 18pt;
    font-weight: 700;
  }
  .metric .label {
    font-size: 9pt;
    opacity: 0.85;
  }
  /* 图表占位 */
  .chart-placeholder {
    background: #f0f0f5;
    border: 2px dashed #ccc;
    padding: 20px;
    text-align: center;
    border-radius: 8px;
    margin: 12px 0;
    color: #666;
  }
  /* 页脚 */
  .footer {
    margin-top: 60px;
    padding-top: 20px;
    border-top: 2px solid #0f3460;
    font-size: 9pt;
    color: #999;
    text-align: center;
  }
  /* 打印指引 */
  .print-hint {
    position: fixed;
    top: 10px;
    right: 10px;
    background: #e94560;
    color: #fff;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 10pt;
    cursor: pointer;
    z-index: 9999;
  }
  @media print {
    .print-hint { display: none; }
  }
</style>
</head>
<body>

<button class="print-hint" onclick="window.print()">🖨️ 打印/导出PDF</button>

${body}

<div class="footer">
  <p>文档编号：MB-SUM-2026-001 | 版本：v3.0 | 日期：2026-08-09</p>
  <p>© 2026 MusicBox 技术团队 | 内部公开</p>
</div>

</body>
</html>`;

fs.writeFileSync(htmlPath, fullHtml, 'utf8');
console.log(`HTML报告已生成: ${htmlPath}`);
console.log(`\n导出PDF方法：`);
console.log(`  1. 在浏览器中打开上述HTML文件`);
console.log(`  2. 点击右上角"打印/导出PDF"按钮，或按 Ctrl+P`);
console.log(`  3. 目标打印机选择"另存为PDF"`);
console.log(`  4. 纸张大小选A4，边距选"默认"`);
console.log(`  5. 勾选"背景图形"选项`);
console.log(`  6. 点击保存即可生成PDF`);
