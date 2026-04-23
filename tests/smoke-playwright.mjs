import { pathToFileURL } from 'url';
import path from 'path';

async function run() {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch (_) {
    console.log('Playwright not installed; skipping smoke test.');
    return;
  }

  const { chromium } = playwright;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const root = process.cwd();
  const fileUrl = pathToFileURL(path.join(root, 'index.html')).href;
  await page.goto(fileUrl);

  await page.waitForSelector('#btn-connect');
  await page.click('.tab-btn[data-tab="settings"]');
  await page.click('#btn-connect');
  await page.waitForSelector('#conn-badge[data-state=\"connecting\"], #conn-badge[data-state=\"error\"], #conn-badge[data-state=\"connected\"]');

  await page.click('.tab-btn[data-tab="relays"]');
  await page.waitForSelector('#tab-relays.active');

  await browser.close();
  console.log('Smoke test completed.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
