# Galgalatz Top 20 → Spotify Playlist Updater

Runs every **Thursday at 22:00 Europe/Amsterdam** time, scrapes the Galgalatz Top 20
from [glz.co.il](https://glz.co.il/%D7%92%D7%9C%D7%92%D7%9C%D7%A6), then replaces a
Spotify playlist with the found tracks.

---

## Project structure

```
glglz-top-20/
├── src/
│   ├── types.ts        # Shared TypeScript interfaces
│   ├── logger.ts       # Timestamped console helpers
│   ├── scraper.ts      # Playwright-based Galgalatz scraper
│   ├── spotify.ts      # Spotify API client (token refresh, search, playlist ops)
│   ├── run.ts          # Orchestration — scrape → search → clear → add
│   ├── index.ts        # CLI entry point (npm run update-playlist)
│   └── scheduler.ts    # node-cron entry point (npm run scheduler)
├── scripts/
│   └── get-refresh-token.ts   # One-time OAuth helper
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 18 |
| npm | ≥ 9 |

---

## 1 — Create a Spotify Developer App

1. Go to <https://developer.spotify.com/dashboard> and **Create app**.
2. Fill in any name/description.
3. Set **Redirect URI** to `http://localhost:8888/callback`.
4. Under **APIs used**, select *Web API*.
5. Save. Note your **Client ID** and **Client Secret**.

> **Development Mode restrictions (2026)**
> - You can only modify playlists **you own** (created with your own account).
> - The account linked to the app must have an active **Spotify Premium** subscription.
> - All API calls use the `/v1/playlists/{id}/items` endpoint — *not* the deprecated `/tracks`.

---

## 2 — Get your Refresh Token

```bash
cp .env.example .env
# Fill in SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env

npm install
npm run get-token
```

The script starts a local HTTP server on port 8888, prints an authorization URL,
and waits for you to log in. After you click **Agree** in the browser it prints:

```
SPOTIFY_REFRESH_TOKEN=AQD...
```

Add that value to your `.env` file.

---

## 3 — Create the Spotify playlist

1. Open Spotify, create a new empty playlist, and make sure you are the owner.
2. Copy the playlist ID from the URL:
   `https://open.spotify.com/playlist/`**`3RCL6s6xJasw4SydPI1j09`**
3. Set `SPOTIFY_PLAYLIST_ID` in `.env`.

---

## 4 — Install dependencies & browsers

```bash
npm install
npm run install-browsers   # installs headless Chromium for Playwright
```

---

## 5 — Configure `.env`

```dotenv
SPOTIFY_CLIENT_ID=abc123
SPOTIFY_CLIENT_SECRET=def456
SPOTIFY_REFRESH_TOKEN=AQD...long...token
SPOTIFY_PLAYLIST_ID=3RCL6s6xJasw4SydPI1j09
```

---

## 5b — YouTube setup (optional)

YouTube integration is **disabled by default**. All four `YOUTUBE_*` variables must
be present for it to activate. If any are missing the run silently skips YouTube.

### Create a Google Cloud OAuth 2.0 credential

1. Go to <https://console.cloud.google.com/> → **APIs & Services → Credentials**.
2. Click **Create credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Add `http://localhost:8889/callback` to **Authorized redirect URIs**.
5. Download / note the **Client ID** and **Client Secret**.
6. Enable the **YouTube Data API v3** under *APIs & Services → Library*.

### Get your YouTube refresh token

```bash
# Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET to .env first
npm run get-youtube-token
```

The helper opens a Google sign-in page. After you click **Allow**, your
`YOUTUBE_REFRESH_TOKEN` is printed in the terminal.

> **Tip:** If Google returns no `refresh_token`, revoke the app access at
> <https://myaccount.google.com/permissions> and re-run the helper —
> the `prompt=consent` flag will force a fresh grant.

### Create the YouTube playlist

1. Open YouTube, create a new empty playlist, and set its visibility to *Public* or *Unlisted*.
2. The playlist ID is the `list=` parameter in its URL:
   `https://www.youtube.com/playlist?list=`**`PLxxxxxx`**
3. Set `YOUTUBE_PLAYLIST_ID` in `.env`.

### Final `.env` with YouTube enabled

```dotenv
SPOTIFY_CLIENT_ID=abc123
SPOTIFY_CLIENT_SECRET=def456
SPOTIFY_REFRESH_TOKEN=AQD...
SPOTIFY_PLAYLIST_ID=3RCL6s6xJasw4SydPI1j09

YOUTUBE_CLIENT_ID=123456.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=GOCSPX-...
YOUTUBE_REFRESH_TOKEN=1//0e...
YOUTUBE_PLAYLIST_ID=PLxxxxxx
```

---

## 6 — Run manually

```bash
npm run update-playlist
```

Sample output:

```
────────────────────────────────────────────────────────────
[Main] 2026-05-08T22:00:01.000Z INFO  Starting Galgalatz → Spotify playlist update
────────────────────────────────────────────────────────────
[Scraper] ... INFO  Scraped 20 song(s) from Galgalatz.
[Main]    ... INFO    #1: ירדן גבאי — תחנה אחת
[Spotify] ... INFO    Query "ירדן גבאי" "תחנה אחת" → "תחנה אחת" by ירדן גבאי
...
[Main]    ... INFO  Update complete — added: 18, skipped: 2
```

---

## 7 — Run the built-in scheduler (node-cron)

This keeps a Node.js process alive and fires every Thursday at 22:00 Amsterdam:

```bash
npm run scheduler
```

Keep it running in the background with **PM2**:

```bash
npm install -g pm2
pm2 start "npm run scheduler" --name glglz-top-20
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot
```

---

## 8 — System cron (Raspberry Pi / Linux)

If you prefer the OS cron instead of the in-process scheduler:

### Ensure the correct timezone

```bash
# Check current system timezone
timedatectl

# Set to Amsterdam if needed
sudo timedatectl set-timezone Europe/Amsterdam
timedatectl   # verify: Time zone: Europe/Amsterdam (CET, +0100)
```

### Add the cron job

```bash
crontab -e
```

Add this line (adjust paths to match your installation):

```cron
# Every Thursday at 22:00 Europe/Amsterdam (set via TZ variable)
0 22 * * 4 TZ="Europe/Amsterdam" cd /home/pi/glglz-top-20 && /usr/bin/npm run update-playlist >> /home/pi/glglz-top-20/cron.log 2>&1
```

Verify the next scheduled run:

```bash
# List your crontab
crontab -l
```

---

## 9 — Spotify API endpoints used

| Operation | Method | Endpoint |
|---|---|---|
| Refresh token | `POST` | `https://accounts.spotify.com/api/token` |
| List playlist items | `GET` | `/v1/playlists/{id}/items` |
| Remove tracks | `DELETE` | `/v1/playlists/{id}/items` |
| Search | `GET` | `/v1/search?q=...&type=track` |
| Add tracks | `POST` | `/v1/playlists/{id}/items` |

All requests use the **Authorization Code** flow with a long-lived refresh token.

---

## 10 — Debugging if the Galgalatz page changes

The scraper targets:

```
div.infoWrapper > div.textWrapper > div.title
```

If the scraper returns 0 songs it automatically dumps the first 2000 characters of
the page HTML to the console. Use that to find the new class names.

**Manual inspection:**

```bash
# Dump full page HTML to a file for inspection
node -e "
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('https://glz.co.il/%D7%92%D7%9C%D7%92%D7%9C%D7%A6', { waitUntil: 'networkidle' });
  require('fs').writeFileSync('page.html', await p.content());
  await b.close();
  console.log('Saved to page.html');
})();
"
grep -i 'infoWrapper\|textWrapper\|title\|artist' page.html | head -40
```

Then update the selectors in `src/scraper.ts` accordingly.

---

## Environment variables reference

| Variable | Description |
|---|---|
| `SPOTIFY_CLIENT_ID` | From Spotify Developer Dashboard |
| `SPOTIFY_CLIENT_SECRET` | From Spotify Developer Dashboard |
| `SPOTIFY_REFRESH_TOKEN` | Obtained via `npm run get-token` |
| `SPOTIFY_PLAYLIST_ID` | ID of the playlist you own |
