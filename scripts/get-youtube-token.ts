/**
 * One-time helper: runs a local OAuth callback server and prints
 * your YouTube refresh token. Run with: npm run get-youtube-token
 *
 * Requires YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env.
 * Set these up at https://console.cloud.google.com/
 */
import 'dotenv/config';
import * as http from 'http';
import * as https from 'https';
import * as querystring from 'querystring';

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:8889/callback';
const PORT = 8889;

// youtube.force-ssl covers playlistItems read + write/delete
const SCOPES = 'https://www.googleapis.com/auth/youtube.force-ssl';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?` +
  querystring.stringify({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent', // force Google to return a refresh_token every time
  });

console.log('\n════════════════════════════════════════════════');
console.log('  YouTube Refresh Token Helper');
console.log('════════════════════════════════════════════════');
console.log('\n1. Open this URL in your browser:\n');
console.log(`   ${authUrl}`);
console.log('\n2. Sign in with your Google/YouTube account and click "Allow".');
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
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  const tokenReq = https.request(
    {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
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
            refresh_token?: string;
            scope: string;
          };

          if (!tokens.refresh_token) {
            console.error('\nError: no refresh_token in response:', data);
            console.error(
              'Tip: revoke app access at https://myaccount.google.com/permissions then re-run.',
            );
            res.end('Error — check your terminal.');
            server.close();
            return;
          }

          console.log('\n════════════════════════════════════════════════');
          console.log('  SUCCESS — add this to your .env file:');
          console.log('════════════════════════════════════════════════');
          console.log(`\nYOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
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
