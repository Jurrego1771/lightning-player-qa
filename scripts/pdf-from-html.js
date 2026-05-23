const { chromium } = require('@playwright/test');
const { readFileSync, existsSync } = require('fs');
const { resolve } = require('path');

const HTML_PATH = resolve(__dirname, '../playwright-report/qa-report.html');
const PDF_PATH  = resolve(__dirname, '../playwright-report/qa-report.pdf');

if (!existsSync(HTML_PATH)) {
  console.error('playwright-report/qa-report.html not found. Run /generate-informe first.');
  process.exit(1);
}

(async () => {
  const html = readFileSync(HTML_PATH, 'utf-8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.pdf({
    path:            PDF_PATH,
    format:          'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
  });
  await browser.close();
  console.log(`PDF generado: ${PDF_PATH}`);
})();
