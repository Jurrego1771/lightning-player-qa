import { test } from '@playwright/test';

test('inspect youbora requests', async ({ page }) => {
  page.on('request', request => {
    const url = request.url();
    if (url.includes('youbora') || url.includes('npaw')) {
      console.log('Youbora Request:', url);
    } else if (url.includes('127.0.0.1')) {
       // log local requests too just in case
       console.log('Local Request:', url);
    }
  });

  try {
    await page.goto('http://127.0.0.1:5501/youbora.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000); // Wait a bit for analytics to fire
  } catch (e) {
    console.error('Failed to load page:', e.message);
  }
});
