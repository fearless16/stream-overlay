import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import path from 'node:path';

const wsUrl = process.env.MOCK_WS_URL || 'ws://localhost:8770';
const overlayUrl = `file:///${path.resolve('chat-overlay.html').replaceAll('\\', '/')}?ws=${encodeURIComponent(wsUrl)}`;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(overlayUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => {
    const names = [...document.querySelectorAll('#sc-content .sc-t-name')].map(el => el.textContent?.trim());
    return names.includes('India') && names.includes('Australia');
  }, null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('#chat-container .msg').length > 0, null, { timeout: 10000 });

  const result = await page.evaluate(() => ({
    scoreTeams: [...document.querySelectorAll('#sc-content .sc-t-name')].map(el => el.textContent.trim()),
    chatCount: document.querySelectorAll('#chat-container .msg').length
  }));
  assert.deepEqual(result.scoreTeams, ['India', 'Australia']);
  assert.ok(result.chatCount > 0, 'mock chat message should reach overlay');
  console.log(`PASS: local overlay received score + ${result.chatCount} chat message(s) via ${wsUrl}`);
} finally {
  await browser.close();
}
