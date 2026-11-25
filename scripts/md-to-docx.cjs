/**
 * Markdown to DOCX 转换器（纯 JavaScript 实现，无外部依赖）
 * 使用 XML 模板直接生成 .docx 文件（docx 本质上是 ZIP 包含 XML 文件）
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ============================================================
// 1. Markdown 解析器
// ============================================================

function parseMarkdown(md) {
  const lines = md.split('\n');
  const tokens = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 分隔线
    if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim())) {
      tokens.push({ type: 'hr' });
      i++;
      continue;
    }

    // 代码块
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      tokens.push({ type: 'code', lang, content: codeLines.join('\n') });
      continue;
    }

    // 标题
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      tokens.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && /\|[\s-:]+\|/.test(lines[i + 1])) {
      const headerCells = parseTableRow(line);
      const rows = [];
      i += 2; // skip header and separator
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      tokens.push({ type: 'table', headers: headerCells, rows });
      continue;
    }

    // 无序列表
    if (/^(\s*)([-*+])\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^(\s*)([-*+])\s+/.test(lines[i])) {
        const itemMatch = lines[i].match(/^(\s*)([-*+])\s+(.+)/);
        if (itemMatch) {
          const indent = itemMatch[1].length;
          items.push({ indent, text: itemMatch[3] });
        }
        i++;
      }
      tokens.push({ type: 'ul', items });
      continue;
    }

    // 有序列表
    if (/^(\s*)\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^(\s*)\d+\.\s+/.test(lines[i])) {
        const itemMatch = lines[i].match(/^(\s*)\d+\.\s+(.+)/);
        if (itemMatch) {
          const indent = itemMatch[1].length;
          items.push({ indent, text: itemMatch[2] });
        }
        i++;
      }
      tokens.push({ type: 'ol', items });
      continue;
    }

    // 引用块
    if (line.trim().startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      tokens.push({ type: 'blockquote', text: quoteLines.join(' ') });
      continue;
    }

    // 普通段落（可能跨多行）
    const paraLines = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].match(/^#{1,6}\s/) && !lines[i].startsWith('```') && !(/^-{3,}$/.test(lines[i].trim())) && !(lines[i].includes('|') && i + 1 < lines.length && lines[i + 1] && /\|[\s-:]+\|/.test(lines[i + 1]))) {
      paraLines.push(lines[i]);
      i++;
    }
    tokens.push({ type: 'paragraph', text: paraLines.join(' ') });
  }

  return tokens;
}

function parseTableRow(line) {
  return line.split('|').map(c => c.trim()).filter(c => c !== '');
}

// ============================================================
// 2. 内联 Markdown 解析（粗体、斜体、链接、行内代码）
// ============================================================

function parseInline(text) {
  const runs = [];
  // Pattern: **bold**, *italic*, `code`, [text](url), ~~strike~~
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[([^\]]+)\]\(([^)]+)\))|(~~(.+?)~~)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // 前面的纯文本
    if (match.index > lastIndex) {
      runs.push({ text: text.slice(lastIndex, match.index), bold: false, italic: false, code: false, link: null });
    }

    if (match[1]) { // **bold**
      runs.push({ text: match[2], bold: true, italic: false, code: false, link: null });
    } else if (match[3]) { // *italic*
      runs.push({ text: match[4], bold: false, italic: true, code: false, link: null });
    } else if (match[5]) { // `code`
      runs.push({ text: match[6], bold: false, italic: false, code: true, link: null });
    } else if (match[7]) { // [text](url)
      runs.push({ text: match[8], bold: false, italic: false, code: false, link: match[9] });
    } else if (match[10]) { // ~~strike~~
      runs.push({ text: match[11], bold: false, italic: false, code: false, link: null, strike: true });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    runs.push({ text: text.slice(lastIndex), bold: false, italic: false, code: false, link: null });
  }

  if (runs.length === 0 && text) {
    runs.push({ text, bold: false, italic: false, code: false, link: null });
  }

  return runs;
}

// ============================================================
// 3. XML 生成器
// ============================================================

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function makeRunProps(options) {
  let props = '';
  if (options.bold) props += '<w:b/><w:bCs/>';
  if (options.italic) props += '<w:i/><w:iCs/>';
  if (options.code) {
    props += '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>';
    props += '<w:sz w:val="18"/>';
    props += '<w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/>';
  }
  if (options.strike) props += '<w:strike/>';
  if (options.link) {
    // link color and underline handled at run level
    props += '<w:color w:val="0563C1"/><w:u w:val="single"/>';
  }
  return props ? `<w:rPr>${props}</w:rPr>` : '';
}

function makeTextRun(text, options = {}) {
  const runs = parseInline(text);
  return runs.map(r => {
    let extraProps = '';
    if (r.bold) extraProps += '<w:b/><w:bCs/>';
    if (r.italic) extraProps += '<w:i/><w:iCs/>';
    if (r.code) {
      extraProps += '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>';
      extraProps += '<w:sz w:val="18"/>';
      extraProps += '<w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/>';
    }
    if (r.strike) extraProps += '<w:strike/>';

    let rPr = '';
    if (extraProps || options.fontSize) {
      rPr = '<w:rPr>';
      if (options.fontSize) rPr += `<w:sz w:val="${options.fontSize}"/><w:szCs w:val="${options.fontSize}"/>`;
      rPr += extraProps;
      rPr += '</w:rPr>';
    }

    const attr = r.code ? ' xml:space="preserve"' : '';
    return `<w:r>${rPr}<w:t${attr}>${escapeXml(r.text)}</w:t></w:r>`;
  }).join('');
}

function tokensToXml(tokens) {
  let body = '';

  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const sizes = { 1: 36, 2: 30, 3: 26, 4: 24, 5: 22, 6: 20 };
        const fontSize = sizes[token.level] || 24;
        const color = token.level <= 2 ? '1F2937' : '374151';
        body += `<w:p>
  <w:pPr>
    <w:pStyle w:val="Heading${token.level}"/>
    <w:spacing w:before="240" w:after="120"/>
  </w:pPr>
  <w:r>
    <w:rPr>
      <w:b/><w:bCs/>
      <w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/>
      <w:color w:val="${color}"/>
    </w:rPr>
    <w:t>${escapeXml(token.text)}</w:t>
  </w:r>
</w:p>`;
        break;
      }

      case 'paragraph': {
        body += `<w:p>
  <w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr>
  ${makeTextRun(token.text, { fontSize: 21 })}
</w:p>`;
        break;
      }

      case 'blockquote': {
        body += `<w:p>
  <w:pPr>
    <w:pStyle w:val="Quote"/>
    <w:ind w:left="720"/>
    <w:spacing w:after="120"/>
  </w:pPr>
  ${makeTextRun(token.text, { fontSize: 20 })}
</w:p>`;
        break;
      }

      case 'code': {
        const codeLines = token.content.split('\n');
        for (const cl of codeLines) {
          body += `<w:p>
  <w:pPr>
    <w:pStyle w:val="Code"/>
    <w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/>
    <w:ind w:left="360"/>
    <w:spacing w:after="0" w:line="240" w:lineRule="exact"/>
  </w:pPr>
  <w:r>
    <w:rPr>
      <w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>
      <w:sz w:val="16"/><w:szCs w:val="16"/>
      <w:color w:val="333333"/>
    </w:rPr>
    <w:t xml:space="preserve">${escapeXml(cl)}</w:t>
  </w:r>
</w:p>`;
        }
        break;
      }

      case 'hr': {
        body += `<w:p>
  <w:pPr>
    <w:pBdr>
      <w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/>
    </w:pBdr>
    <w:spacing w:after="120"/>
  </w:pPr>
</w:p>`;
        break;
      }

      case 'ul': {
        for (const item of token.items) {
          const bullet = item.indent > 0 ? '  ○' : '●';
          body += `<w:p>
  <w:pPr>
    <w:ind w:left="${360 + item.indent * 240}" w:hanging="240"/>
    <w:spacing w:after="60" w:line="276" w:lineRule="auto"/>
  </w:pPr>
  <w:r><w:t xml:space="preserve">${bullet} </w:t></w:r>
  ${makeTextRun(item.text, { fontSize: 21 })}
</w:p>`;
        }
        break;
      }

      case 'ol': {
        let num = 1;
        for (const item of token.items) {
          body += `<w:p>
  <w:pPr>
    <w:ind w:left="${360 + item.indent * 240}" w:hanging="240"/>
    <w:spacing w:after="60" w:line="276" w:lineRule="auto"/>
  </w:pPr>
  <w:r><w:t xml:space="preserve">${num}. </w:t></w:r>
  ${makeTextRun(item.text, { fontSize: 21 })}
</w:p>`;
          num++;
        }
        break;
      }

      case 'table': {
        const colCount = token.headers.length;
        const tableWidth = 9000;
        const colWidth = Math.floor(tableWidth / colCount);

        body += `<w:tbl>
  <w:tblPr>
    <w:tblStyle w:val="TableGrid"/>
    <w:tblW w:w="${tableWidth}" w:type="dxa"/>
    <w:tblBorders>
      <w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>
      <w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>
      <w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>
      <w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>
      <w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>
      <w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>
    </w:tblBorders>
    <w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>
  </w:tblPr>
  <w:tblGrid>
    ${token.headers.map(() => `<w:gridCol w:w="${colWidth}"/>`).join('')}
  </w:tblGrid>`;

        // 表头
        body += `<w:tr>`;
        for (const h of token.headers) {
          body += `<w:tc>
  <w:tcPr>
    <w:shd w:val="clear" w:color="auto" w:fill="E8EDF2"/>
    <w:tcW w:w="${colWidth}" w:type="dxa"/>
  </w:tcPr>
  <w:p>
    <w:pPr><w:spacing w:after="0"/></w:pPr>
    ${makeTextRun(h, { fontSize: 20, bold: true })}
  </w:p>
</w:tc>`;
        }
        body += `</w:tr>`;

        // 数据行
        for (const row of token.rows) {
          body += `<w:tr>`;
          for (let ci = 0; ci < colCount; ci++) {
            const cellText = (ci < row.length) ? row[ci] : '';
            body += `<w:tc>
  <w:tcPr>
    <w:tcW w:w="${colWidth}" w:type="dxa"/>
  </w:tcPr>
  <w:p>
    <w:pPr><w:spacing w:after="0"/></w:pPr>
    ${makeTextRun(cellText, { fontSize: 20 })}
  </w:p>
</w:tc>`;
          }
          body += `</w:tr>`;
        }

        body += `</w:tbl>`;
        // 表后加间距
        body += `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>`;
        break;
      }
    }
  }

  return body;
}

// ============================================================
// 4. DOCX XML 模板
// ============================================================

function getContentTypes() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>`;
}

function getRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function getDocumentRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>`;
}

function getSettings() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:defaultTabStop w:val="720"/>
  <w:characterSpacingControl w:val="doNotCompress"/>
</w:settings>`;
}

function getStyles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:cs="Microsoft YaHei"/>
        <w:sz w:val="21"/>
        <w:szCs w:val="21"/>
        <w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="120" w:line="276" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="360" w:after="120"/>
    </w:pPr>
    <w:rPr>
      <w:b/><w:bCs/>
      <w:sz w:val="36"/><w:szCs w:val="36"/>
      <w:color w:val="1F2937"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="240" w:after="100"/>
    </w:pPr>
    <w:rPr>
      <w:b/><w:bCs/>
      <w:sz w:val="30"/><w:szCs w:val="30"/>
      <w:color w:val="1F2937"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="200" w:after="80"/>
    </w:pPr>
    <w:rPr>
      <w:b/><w:bCs/>
      <w:sz w:val="26"/><w:szCs w:val="26"/>
      <w:color w:val="374151"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading4">
    <w:name w:val="heading 4"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr><w:keepNext/><w:spacing w:before="160" w:after="60"/></w:pPr>
    <w:rPr>
      <w:b/><w:bCs/>
      <w:sz w:val="24"/><w:szCs w:val="24"/>
      <w:color w:val="374151"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading5">
    <w:name w:val="heading 5"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:spacing w:before="120" w:after="40"/></w:pPr>
    <w:rPr>
      <w:b/><w:bCs/>
      <w:sz w:val="22"/><w:szCs w:val="22"/>
      <w:color w:val="374151"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading6">
    <w:name w:val="heading 6"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:spacing w:before="120" w:after="40"/></w:pPr>
    <w:rPr>
      <w:b/><w:bCs/>
      <w:sz w:val="20"/><w:szCs w:val="20"/>
      <w:color w:val="374151"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:left="720"/>
      <w:pBdr>
        <w:left w:val="single" w:sz="18" w:space="4" w:color="4B5563"/>
      </w:pBdr>
    </w:pPr>
    <w:rPr>
      <w:i/><w:iCs/>
      <w:color w:val="6B7280"/>
    </w:rPr>
  </w:style>
  <w:style w:type="table" w:styleId="TableGrid">
    <w:name w:val="Table Grid"/>
    <w:tblPr>
      <w:tblBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>
        <w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>
        <w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>
      </w:tblBorders>
    </w:tblPr>
  </w:style>
</w:styles>`;
}

function getDocumentXml(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
            mc:Ignorable="w14 w15"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
            xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">
  <w:body>
    ${body}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
      <w:cols w:space="708"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

// ============================================================
// 5. ZIP 文件生成器（纯 JavaScript）
// ============================================================

// CRC32 表
const crcTable = (function () {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZip(files) {
  // files: [{ name: string, data: Buffer }]
  const localHeaders = [];
  const centralEntries = [];
  const parts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf8');
    const compressed = zlib.deflateRawSync(file.data);
    const crc = crc32(file.data);

    // Local file header
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034B50, 0);  // signature
    localHeader.writeUInt16LE(20, 4);            // version needed
    localHeader.writeUInt16LE(0, 6);             // flags
    localHeader.writeUInt16LE(8, 8);             // compression method (deflate)
    localHeader.writeUInt16LE(0, 10);            // mod time
    localHeader.writeUInt16LE(0, 12);            // mod date
    localHeader.writeUInt32LE(crc, 14);          // crc32
    localHeader.writeUInt32LE(compressed.length, 18);   // compressed size
    localHeader.writeUInt32LE(file.data.length, 22);    // uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26);   // filename length
    localHeader.writeUInt16LE(0, 28);                    // extra field length
    nameBuffer.copy(localHeader, 30);

    parts.push(localHeader, compressed);
    const localOffset = offset;
    offset += localHeader.length + compressed.length;

    // Central directory entry
    const centralEntry = Buffer.alloc(46 + nameBuffer.length);
    centralEntry.writeUInt32LE(0x02014B50, 0);  // signature
    centralEntry.writeUInt16LE(20, 4);            // version made by
    centralEntry.writeUInt16LE(20, 6);            // version needed
    centralEntry.writeUInt16LE(0, 8);             // flags
    centralEntry.writeUInt16LE(8, 10);            // compression method
    centralEntry.writeUInt16LE(0, 12);            // mod time
    centralEntry.writeUInt16LE(0, 14);            // mod date
    centralEntry.writeUInt32LE(crc, 16);          // crc32
    centralEntry.writeUInt32LE(compressed.length, 20);   // compressed size
    centralEntry.writeUInt32LE(file.data.length, 24);    // uncompressed size
    centralEntry.writeUInt16LE(nameBuffer.length, 28);   // filename length
    centralEntry.writeUInt16LE(0, 30);                    // extra field length
    centralEntry.writeUInt16LE(0, 32);                    // file comment length
    centralEntry.writeUInt16LE(0, 34);                    // disk number start
    centralEntry.writeUInt16LE(0, 36);                    // internal file attributes
    centralEntry.writeUInt32LE(0, 38);                    // external file attributes
    centralEntry.writeUInt32LE(localOffset, 42);          // relative offset of local header
    nameBuffer.copy(centralEntry, 46);

    centralEntries.push(centralEntry);
  }

  const centralDirOffset = offset;
  const centralDirSize = centralEntries.reduce((sum, e) => sum + e.length, 0);

  // End of central directory
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054B50, 0);  // signature
  endRecord.writeUInt16LE(0, 4);             // disk number
  endRecord.writeUInt16LE(0, 6);             // disk with central dir
  endRecord.writeUInt16LE(files.length, 8);  // entries on this disk
  endRecord.writeUInt16LE(files.length, 10); // total entries
  endRecord.writeUInt32LE(centralDirSize, 12);
  endRecord.writeUInt32LE(centralDirOffset, 16);
  endRecord.writeUInt16LE(0, 20);            // comment length

  return Buffer.concat([...parts, ...centralEntries, endRecord]);
}

// ============================================================
// 6. 主程序
// ============================================================

function main() {
  const inputPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '..', 'docs', 'project-full-summary.md');
  const outputPath = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.resolve(__dirname, '..', 'docs', 'project-full-summary.docx');

  console.log(`读取 Markdown 文件: ${inputPath}`);
  const md = fs.readFileSync(inputPath, 'utf8');

  console.log('解析 Markdown...');
  const tokens = parseMarkdown(md);
  console.log(`  解析到 ${tokens.length} 个段落/块`);

  console.log('生成 DOCX XML...');
  const body = tokensToXml(tokens);

  const documentXml = getDocumentXml(body);

  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(getContentTypes(), 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(getRels(), 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(getStyles(), 'utf8') },
    { name: 'word/settings.xml', data: Buffer.from(getSettings(), 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(getDocumentRels(), 'utf8') },
  ];

  console.log('打包 ZIP...');
  const zipBuffer = createZip(files);

  console.log(`写入 DOCX 文件: ${outputPath}`);
  fs.writeFileSync(outputPath, zipBuffer);

  const stats = fs.statSync(outputPath);
  console.log(`✅ 转换完成！文件大小: ${(stats.size / 1024).toFixed(1)} KB`);
  console.log(`   输出路径: ${outputPath}`);
}

main();
