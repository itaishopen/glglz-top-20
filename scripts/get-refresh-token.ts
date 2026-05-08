/**
 * One-time helper: runs a local OAuth callback server and prints
 * your Spotify refresh token. Run with: npm run get-token
 */
import 'dotenv/config';
import * as http from 'http';
import * as https from 'https';
import * as querystring from 'querystring';

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:8888/callback';
const PORT = 8888;

const SCOPES = [
  'playlist-modify-public',
  'playlist-modify-private',
  'playlist-read-private',
].join(' ');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

const authUrl =
  `https://accounts.spotify.com/authorize?` +
  querystring.stringify({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
  });

console.log('\n════════════════════════════════════════════════');
console.log('  Spotify Refresh Token Helper');
console.log('════════════════════════════════════════════════');
console.log('\n1. Open this URL in your browser:\n');
console.log(`   ${authUrl}`);
console.log('\n2. Log in and click "Agree".');
console.log('3. You will be redirected to localhost. The token will print here.\n');

const server = http.createServer((req, res) => {
  if (!req.url?.startsWith('/callback')) {
    res.end('Not found');
    return;
  }

  const params = new URLSearchParams(req.url.split('?')[1] ?? '');
  const code = params.get('code');
  const error = params.get('error');

  if (error || !code) {
    res.end(`Authorization failed: ${error ?? 'no code received'}`);
    server.close();
    return;
  }

  const body = querystring.stringify({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });

  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const tokenReq = https.request(
    {
      hostname: 'accounts.spotify.com',
      path: '/api/token',
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    (tokenRes) => {
      let data = '';
      tokenRes.on('data', (chunk) => (data += chunk));
      tokenRes.on('end', () => {
        try {
          const tokens = JSON.parse(data) as {
            access_token: string;
            refresh_token: string;
            scope: string;
          };

          if (!tokens.refresh_token) {
            console.error('\nError: no refresh_token in response:', data);
            res.end('Error — check your terminal.');
            server.close();
            return;
          }

          console.log('\n════════════════════════════════════════════════');
          console.log('  SUCCESS — add this to your .env file:');
          console.log('════════════════════════════════════════════════');
          console.log(`\nSPOTIFY_REFRESH_TOKEN=${tokens.refresh_token}\n`);
          console.log(`Granted scopes: ${tokens.scope}`);
          console.log('════════════════════════════════════════════════\n');

          res.end('Done! Check your terminal for the refresh token. You can close this tab.');
        } catch {
          res.end('Failed to parse token response.');
        } finally {
          server.close();
        }
      });
    },
  );

  tokenReq.on('error', (err) => {
    console.error('Request error:', err.message);
    res.end('Internal error — check terminal.');
    server.close();
  });

  tokenReq.write(body);
  tokenReq.end();
});

server.listen(PORT, () => {
  console.log(`Callback server listening on http://localhost:${PORT}`);
});
