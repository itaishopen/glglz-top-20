import 'dotenv/config';
import { scrapeTop20 } from './scraper';
import { SpotifyClient } from './spotify';
import { Song, SpotifyTrack, UpdateSummary } from './types';
import { log } from './logger';

const TAG = 'Main';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function run(): Promise<UpdateSummary> {
  log.separator();
  log.info(TAG, 'Starting Galgalatz → Spotify playlist update');
  log.separator();

  const spotify = new SpotifyClient(
    requireEnv('SPOTIFY_CLIENT_ID'),
    requireEnv('SPOTIFY_CLIENT_SECRET'),
    requireEnv('SPOTIFY_REFRESH_TOKEN'),
  );
  const playlistId = requireEnv('SPOTIFY_PLAYLIST_ID');

  // ── Step 1: Scrape top 20 ────────────────────────────────────────────────
  const songs = await scrapeTop20();

  log.info(TAG, 'Scraped songs:');
  for (const s of songs) {
    log.info(TAG, `  #${String(s.rank).padStart(2)}: ${s.title}${s.artist ? ` — ${s.artist}` : ''}`);
  }

  // ── Step 2: Search Spotify for each song ────────────────────────────────
  log.info(TAG, 'Searching Spotify...');
  const added: SpotifyTrack[] = [];
  const skipped: Song[] = [];
  const seenUris = new Set<string>();

  for (const song of songs) {
    const track = await spotify.searchTrack(song);

    if (!track) {
      log.warn(TAG, `  [SKIP] #${song.rank}: "${song.title}" — not found on Spotify`);
      skipped.push(song);
      continue;
    }

    if (seenUris.has(track.uri)) {
      log.warn(TAG, `  [SKIP] #${song.rank}: "${song.title}" — duplicate (${track.uri})`);
      skipped.push(song);
      continue;
    }

    seenUris.add(track.uri);
    added.push(track);
    log.info(TAG, `  [ADD]  #${song.rank}: "${song.title}" → "${track.name}" by ${track.artists.join(', ')}`);
  }

  // ── Step 3: Clear playlist ───────────────────────────────────────────────
  await spotify.clearPlaylist(playlistId);

  // ── Step 4: Add new tracks ───────────────────────────────────────────────
  await spotify.addTracksToPlaylist(playlistId, added.map((t) => t.uri));

  // ── Step 5: Summary ──────────────────────────────────────────────────────
  log.separator();
  log.info(TAG, `Update complete — added: ${added.length}, skipped: ${skipped.length}`);

  if (skipped.length > 0) {
    log.warn(TAG, 'Songs not found on Spotify:');
    for (const s of skipped) {
      log.warn(TAG, `  #${s.rank}: "${s.title}"${s.artist ? ` — ${s.artist}` : ''}`);
    }
  }

  log.separator();
  return { added, skipped };
}
