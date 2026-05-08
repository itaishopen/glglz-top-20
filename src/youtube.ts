import axios, { AxiosInstance } from 'axios';
import { Song, YouTubeVideo, YouTubeTokenResponse } from './types';
import { log } from './logger';

const TAG = 'YouTube';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';

export class YouTubeClient {
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private readonly http: AxiosInstance;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly refreshToken: string,
  ) {
    this.http = axios.create({ baseURL: YT_API_BASE });
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  private async ensureToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    log.info(TAG, 'Refreshing YouTube access token...');
    const { data } = await axios.post<YouTubeTokenResponse>(
      GOOGLE_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    log.info(TAG, 'YouTube access token refreshed.');
    return this.accessToken;
  }

  private async headers(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.ensureToken()}` };
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  async searchVideo(song: Song): Promise<YouTubeVideo | null> {
    const h = await this.headers();

    for (const q of buildSearchQueries(song)) {
      try {
        type SearchResponse = {
          items: Array<{ id: { videoId: string }; snippet: { title: string } }>;
        };
        const { data } = await this.http.get<SearchResponse>('/search', {
          headers: h,
          params: {
            part: 'snippet',
            q,
            type: 'video',
            maxResults: 5,
            relevanceLanguage: 'iw',
          },
        });

        const items = data.items ?? [];
        if (items.length > 0) {
          const { videoId } = items[0].id;
          const title = items[0].snippet.title;
          log.info(TAG, `  Query "${q}" → "${title}" (${videoId})`);
          return { videoId, title };
        }
      } catch (err: any) {
        log.warn(TAG, `Search error for query "${q}": ${err.message}`);
      }
    }

    return null;
  }

  // ─── Playlist helpers ──────────────────────────────────────────────────────

  async getPlaylistItems(playlistId: string): Promise<YouTubeVideo[]> {
    log.info(TAG, `Fetching items for YouTube playlist ${playlistId}...`);
    const h = await this.headers();
    const videos: YouTubeVideo[] = [];
    let pageToken: string | undefined;

    do {
      type ListResponse = {
        nextPageToken?: string;
        items: Array<{
          id: string;
          snippet: { title: string; resourceId: { videoId: string } };
        }>;
      };
      const { data } = await this.http.get<ListResponse>('/playlistItems', {
        headers: h,
        params: { part: 'snippet', playlistId, maxResults: 50, pageToken },
      });

      for (const item of data.items ?? []) {
        videos.push({
          videoId: item.snippet.resourceId.videoId,
          title: item.snippet.title,
          playlistItemId: item.id,
        });
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    log.info(TAG, `Found ${videos.length} existing video(s) in YouTube playlist.`);
    return videos;
  }

  async clearPlaylist(playlistId: string): Promise<void> {
    const items = await this.getPlaylistItems(playlistId);

    if (items.length === 0) {
      log.info(TAG, 'YouTube playlist is already empty.');
      return;
    }

    log.info(TAG, `Removing ${items.length} video(s) from YouTube playlist...`);
    const h = await this.headers();

    for (const item of items) {
      await this.http.delete('/playlistItems', {
        headers: h,
        params: { id: item.playlistItemId },
      });
    }

    log.info(TAG, 'YouTube playlist cleared.');
  }

  async addVideosToPlaylist(playlistId: string, videoIds: string[]): Promise<void> {
    if (videoIds.length === 0) {
      log.warn(TAG, 'No videos to add to YouTube playlist.');
      return;
    }

    log.info(TAG, `Adding ${videoIds.length} video(s) to YouTube playlist...`);
    const h = await this.headers();

    for (const videoId of videoIds) {
      await this.http.post(
        '/playlistItems',
        {
          snippet: {
            playlistId,
            resourceId: { kind: 'youtube#video', videoId },
          },
        },
        { headers: h, params: { part: 'snippet' } },
      );
    }

    log.info(TAG, 'Videos added to YouTube playlist.');
  }
}

// ─── Search query builder ────────────────────────────────────────────────────

function buildSearchQueries(song: Song): string[] {
  const title = song.title.trim();
  const artist = song.artist?.trim();
  const queries: string[] = [];

  if (artist) {
    queries.push(`${title} ${artist}`);
    queries.push(`${artist} ${title}`);
  }

  queries.push(title);

  if (artist) {
    // "official" can surface the music video when the plain query finds a cover
    queries.push(`${title} ${artist} official`);
  }

  return [...new Set(queries)];
}
