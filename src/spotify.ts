import axios, { AxiosInstance } from 'axios';
import { Song, SpotifyTrack, SpotifyTokenResponse, PlaylistItem } from './types';
import { log } from './logger';

const TAG = 'Spotify';
const ACCOUNTS_URL = 'https://accounts.spotify.com';
const API_BASE = 'https://api.spotify.com/v1';

export class SpotifyClient {
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private readonly http: AxiosInstance;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly refreshToken: string,
  ) {
    this.http = axios.create({ baseURL: API_BASE });
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  private async ensureToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    log.info(TAG, 'Refreshing Spotify access token...');
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const { data } = await axios.post<SpotifyTokenResponse>(
      `${ACCOUNTS_URL}/api/token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
      }),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    this.accessToken = data.access_token;
    // Expire 60 s early to avoid edge-case races
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    log.info(TAG, 'Access token refreshed.');
    return this.accessToken;
  }

  private async headers(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.ensureToken()}` };
  }

  // ─── Playlist helpers ──────────────────────────────────────────────────────

  async getPlaylistItems(playlistId: string): Promise<SpotifyTrack[]> {
    log.info(TAG, `Fetching items for playlist ${playlistId}...`);
    const h = await this.headers();
    const tracks: SpotifyTrack[] = [];

    // Paginate through all items using the new /items endpoint
    let nextPath: string = `/playlists/${playlistId}/items?limit=100&fields=next,items(track(uri,id,name,artists))`;
    let hasNext = true;

    while (hasNext) {
      type PageResponse = { next: string | null; items: PlaylistItem[] };
      const response = await this.http.get<PageResponse>(nextPath, { headers: h });
      const page = response.data;

      for (const item of page.items) {
        if (item.track?.uri) {
          tracks.push({
            uri: item.track.uri,
            id: item.track.id,
            name: item.track.name,
            artists: item.track.artists.map((a: { name: string }) => a.name),
          });
        }
      }

      // page.next is an absolute URL like https://api.spotify.com/v1/...
      if (page.next) {
        nextPath = page.next.replace(API_BASE, '');
      } else {
        hasNext = false;
      }
    }

    log.info(TAG, `Found ${tracks.length} existing track(s) in playlist.`);
    return tracks;
  }

  async clearPlaylist(playlistId: string): Promise<void> {
    const existing = await this.getPlaylistItems(playlistId);

    if (existing.length === 0) {
      log.info(TAG, 'Playlist is already empty — nothing to remove.');
      return;
    }

    log.info(TAG, `Removing ${existing.length} track(s) from playlist...`);
    const h = await this.headers();

    // DELETE /playlists/{id}/items accepts max 100 URIs per request
    for (let i = 0; i < existing.length; i += 100) {
      const batch = existing.slice(i, i + 100).map((t) => ({ uri: t.uri }));
      await this.http.delete(`/playlists/${playlistId}/items`, {
        headers: h,
        data: { tracks: batch },
      });
    }

    log.info(TAG, 'All existing tracks removed.');
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  async searchTrack(song: Song): Promise<SpotifyTrack | null> {
    const h = await this.headers();

    for (const query of buildSearchQueries(song)) {
      try {
        const { data } = await this.http.get<{
          tracks: { items: Array<{ uri: string; id: string; name: string; artists: { name: string }[] }> };
        }>('/search', {
          headers: h,
          params: { q: query, type: 'track', limit: 5, market: 'IL' },
        });

        const items = data.tracks?.items ?? [];
        if (items.length > 0) {
          const t = items[0];
          log.info(TAG, `  Query "${query}" → "${t.name}" by ${t.artists.map((a) => a.name).join(', ')}`);
          return { uri: t.uri, id: t.id, name: t.name, artists: t.artists.map((a) => a.name) };
        }
      } catch (err: any) {
        log.warn(TAG, `Search error for query "${query}": ${err.message}`);
      }
    }

    return null;
  }

  // ─── Add tracks ────────────────────────────────────────────────────────────

  async addTracksToPlaylist(playlistId: string, uris: string[]): Promise<void> {
    if (uris.length === 0) {
      log.warn(TAG, 'No tracks to add.');
      return;
    }

    log.info(TAG, `Adding ${uris.length} track(s) to playlist ${playlistId}...`);
    const h = await this.headers();

    // POST /playlists/{id}/items accepts max 100 URIs per request
    for (let i = 0; i < uris.length; i += 100) {
      const batch = uris.slice(i, i + 100);
      await this.http.post(
        `/playlists/${playlistId}/items`,
        { uris: batch },
        { headers: h },
      );
    }

    log.info(TAG, 'Tracks added successfully.');
  }
}

// ─── Search query builder ────────────────────────────────────────────────────
// Hebrew titles may be stored in multiple forms on Spotify. We try progressively
// looser queries so we always give the best chance of a match.

function buildSearchQueries(song: Song): string[] {
  const title = song.title.trim();
  const artist = song.artist?.trim();
  const queries: string[] = [];

  if (artist) {
    // Most specific: both title and artist quoted
    queries.push(`"${title}" "${artist}"`);
    // Unquoted with field filters
    queries.push(`track:${title} artist:${artist}`);
    // Unquoted free-text
    queries.push(`${title} ${artist}`);
  }

  // Title only, quoted
  queries.push(`"${title}"`);
  // Title only, unquoted (fuzzy)
  queries.push(title);

  // Truncated to first 3 words — helps when a trailing year / remix tag differs
  const shortTitle = title.split(/\s+/).slice(0, 3).join(' ');
  if (shortTitle !== title) {
    queries.push(shortTitle);
    if (artist) queries.push(`${shortTitle} ${artist}`);
  }

  // Deduplicate while preserving order
  return [...new Set(queries)];
}
