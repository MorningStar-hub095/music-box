#!/usr/bin/env node
/**
 * 使用 Puppeteer 将 HTML 报告转换为高质量 PDF
 */
'use strict';

const path = require('path');
const puppeteer = require('puppeteer');

const htmlPath = path.resolve(__dirname, '..', 'docs', 'project-full-summary.html');
const pdfPath = path.resolve(__dirname, '..', 'docs', 'project-full-summary.pdf');

(async () => {
  console.log('正在启动浏览器...');
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Users\\Lenovo\\.cache\\puppeteer\\chrome\\win64-150.0.7871.24\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  
  console.log('正在加载报告页面...');
  await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, {
    waitUntil: 'networkidle0',
    timeout: 60000,
  });

  console.log('正在生成 PDF...');
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    margin: {
      top: '20mm',
      right: '15mm',
      bottom: '20mm',
      left: '15mm',
    },
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `
      <div style="font-size: 8px; width: 100%; text-align: center; color: #999; padding: 5px 0;">
        音乐盒子项目全面总结报告 | MB-SUM-2026-001
      </div>
    `,
    footerTemplate: `
      <div style="font-size: 8px; width: 100%; text-align: center; color: #999; padding: 5px 0;">
        第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页
      </div>
    `,
  });

  await browser.close();
  console.log(`PDF 报告已生成: ${pdfPath}`);
})().catch((err) => {
  console.error('PDF 生成失败:', err.message || err);
  process.exit(1);
});
