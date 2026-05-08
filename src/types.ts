export interface Song {
  rank: number;
  title: string;
  artist?: string;
}

export interface SpotifyTrack {
  uri: string;
  id: string;
  name: string;
  artists: string[];
}

export interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface PlaylistItem {
  track: {
    uri: string;
    id: string;
    name: string;
    artists: { name: string }[];
  } | null;
}

export interface UpdateSummary {
  added: SpotifyTrack[];
  skipped: Song[];
}
