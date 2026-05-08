import { chromium, Browser } from 'playwright';
import { Song } from './types';
import { log } from './logger';

const TAG = 'Scraper';
const GALGALATZ_URL = 'https://glz.co.il/%D7%92%D7%9C%D7%92%D7%9C%D7%A6';
const MAX_SONGS = 20;
const NAV_TIMEOUT_MS = 30_000;
const SELECTOR_TIMEOUT_MS = 15_000;

export async function scrapeTop20(): Promise<Song[]> {
  let browser: Browser | null = null;

  try {
    log.info(TAG, 'Launching headless Chromium...');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    log.info(TAG, `Navigating to ${GALGALATZ_URL}`);
    await page.goto(GALGALATZ_URL, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });

    // Dismiss cookie banner if present
    try {
      const cookieBtn = page.locator('button:has-text("אישור"), button:has-text("קבל"), button[id*="cookie"], button[class*="cookie"]').first();
      await cookieBtn.click({ timeout: 3_000 });
      log.info(TAG, 'Dismissed cookie banner.');
    } catch {
      // No banner — continue
    }

    log.info(TAG, 'Waiting for song list to render...');
    await page.waitForSelector('div.infoWrapper', { timeout: SELECTOR_TIMEOUT_MS });

    const songs = await page.evaluate(
      ({ maxSongs }: { maxSongs: number }): Song[] => {
        const wrappers = Array.from(document.querySelectorAll('div.infoWrapper'));
        const result: Song[] = [];

        for (let i = 0; i < wrappers.length && result.length < maxSongs; i++) {
          const wrapper = wrappers[i];

          const titleEl = wrapper.querySelector<HTMLElement>('div.textWrapper > div.title');
          // Try several common class names for artist; falls back to undefined
          const artistEl =
            wrapper.querySelector<HTMLElement>('div.textWrapper > div.artist') ??
            wrapper.querySelector<HTMLElement>('div.textWrapper > div.subtitle') ??
            wrapper.querySelector<HTMLElement>('div.textWrapper > span.artist') ??
            wrapper.querySelector<HTMLElement>('div.textWrapper > p.artist');

          const title = titleEl?.textContent?.trim();
          if (!title) continue;

          result.push({
            rank: result.length + 1,
            title,
            artist: artistEl?.textContent?.trim() || undefined,
          });
        }

        return result;
      },
      { maxSongs: MAX_SONGS },
    );

    if (songs.length === 0) {
      // Dump a snapshot to help debug selector changes
      const html = await page.content();
      log.warn(TAG, 'No songs found. Page HTML snippet (first 2000 chars):');
      console.warn(html.slice(0, 2000));
      throw new Error(
        'Scraper found 0 songs. The page structure may have changed — see HTML snippet above.',
      );
    }

    log.info(TAG, `Scraped ${songs.length} song(s) from Galgalatz.`);
    return songs;
  } finally {
    await browser?.close();
  }
}
