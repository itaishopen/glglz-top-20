import 'dotenv/config';
import { scrapeTop20 } from './scraper';
import { SpotifyClient } from './spotify';
import { YouTubeClient } from './youtube';
import { Song, SpotifyTrack, YouTubeVideo, YouTubeUpdateSummary, UpdateSummary } from './types';
import { log } from './logger';

const TAG = 'Main';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalEnvGroup(keys: string[]): Record<string, string> | null {
  const values: Record<string, string> = {};
  for (const key of keys) {
    const v = process.env[key];
    if (!v) return null;
    values[key] = v;
  }
  return values;
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
  const spotifyPlaylistId = requireEnv('SPOTIFY_PLAYLIST_ID');

  // YouTube is optional — only enabled when all four vars are present
  const ytEnv = optionalEnvGroup([
    'YOUTUBE_CLIENT_ID',
    'YOUTUBE_CLIENT_SECRET',
    'YOUTUBE_REFRESH_TOKEN',
    'YOUTUBE_PLAYLIST_ID',
  ]);

  const youtube = ytEnv
    ? new YouTubeClient(ytEnv.YOUTUBE_CLIENT_ID, ytEnv.YOUTUBE_CLIENT_SECRET, ytEnv.YOUTUBE_REFRESH_TOKEN)
    : null;
  const ytPlaylistId = ytEnv?.YOUTUBE_PLAYLIST_ID ?? null;

  if (youtube) {
    log.info(TAG, 'YouTube integration enabled.');
  } else {
    log.info(TAG, 'YouTube integration disabled (YOUTUBE_* env vars not set — skipping).');
  }

  // ── Step 1: Scrape top 20 ────────────────────────────────────────────────
  const songs = await scrapeTop20();

  log.info(TAG, 'Scraped songs:');
  for (const s of songs) {
    log.info(TAG, `  #${String(s.rank).padStart(2)}: ${s.title}${s.artist ? ` — ${s.artist}` : ''}`);
  }

  // ── Step 2: Search Spotify (and optionally YouTube) for each song ────────
  log.info(TAG, 'Searching Spotify...');
  const spotifyAdded: SpotifyTrack[] = [];
  const spotifySkipped: Song[] = [];
  const seenSpotifyUris = new Set<string>();

  const ytAdded: YouTubeVideo[] = [];
  const ytSkipped: Song[] = [];
  const seenVideoIds = new Set<string>();

  if (youtube) log.info(TAG, 'Searching YouTube...');

  for (const song of songs) {
    // Spotify
    const track = await spotify.searchTrack(song);

    if (!track) {
      log.warn(TAG, `  [SKIP Spotify] #${song.rank}: "${song.title}" — not found`);
      spotifySkipped.push(song);
    } else if (seenSpotifyUris.has(track.uri)) {
      log.warn(TAG, `  [SKIP Spotify] #${song.rank}: "${song.title}" — duplicate`);
      spotifySkipped.push(song);
    } else {
      seenSpotifyUris.add(track.uri);
      spotifyAdded.push(track);
      log.info(TAG, `  [ADD  Spotify] #${song.rank}: "${song.title}" → "${track.name}" by ${track.artists.join(', ')}`);
    }

    // YouTube (optional)
    if (youtube) {
      const video = await youtube.searchVideo(song);

      if (!video) {
        log.warn(TAG, `  [SKIP YouTube] #${song.rank}: "${song.title}" — not found`);
        ytSkipped.push(song);
      } else if (seenVideoIds.has(video.videoId)) {
        log.warn(TAG, `  [SKIP YouTube] #${song.rank}: "${song.title}" — duplicate`);
        ytSkipped.push(song);
      } else {
        seenVideoIds.add(video.videoId);
        ytAdded.push(video);
        log.info(TAG, `  [ADD  YouTube] #${song.rank}: "${song.title}" → "${video.title}" (${video.videoId})`);
      }
    }
  }

  // ── Step 3: Update Spotify playlist ─────────────────────────────────────
  await spotify.clearPlaylist(spotifyPlaylistId);
  await spotify.addTracksToPlaylist(spotifyPlaylistId, spotifyAdded.map((t) => t.uri));

  // ── Step 4: Update YouTube playlist (if enabled) ─────────────────────────
  if (youtube && ytPlaylistId) {
    await youtube.clearPlaylist(ytPlaylistId);
    await youtube.addVideosToPlaylist(ytPlaylistId, ytAdded.map((v) => v.videoId));
  }

  // ── Step 5: Summary ──────────────────────────────────────────────────────
  log.separator();
  log.info(TAG, `Spotify — added: ${spotifyAdded.length}, skipped: ${spotifySkipped.length}`);
  if (spotifySkipped.length > 0) {
    log.warn(TAG, 'Spotify skipped:');
    for (const s of spotifySkipped) {
      log.warn(TAG, `  #${s.rank}: "${s.title}"${s.artist ? ` — ${s.artist}` : ''}`);
    }
  }

  if (youtube) {
    log.info(TAG, `YouTube  — added: ${ytAdded.length}, skipped: ${ytSkipped.length}`);
    if (ytSkipped.length > 0) {
      log.warn(TAG, 'YouTube skipped:');
      for (const s of ytSkipped) {
        log.warn(TAG, `  #${s.rank}: "${s.title}"${s.artist ? ` — ${s.artist}` : ''}`);
      }
    }
  }

  log.separator();

  const ytSummary: YouTubeUpdateSummary | undefined = youtube
    ? { added: ytAdded, skipped: ytSkipped }
    : undefined;

  return { added: spotifyAdded, skipped: spotifySkipped, youtube: ytSummary };
}
