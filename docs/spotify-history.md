# Spotify history sharing

Each Discord user can connect their own Spotify account. `/spotify history`
publishes that user's recent tracks to the current server channel. The connect,
status, and disconnect responses are private.

## Configuration

Create an app in the Spotify Developer Dashboard and register the exact
redirect URI below. Then set these values in `.env`:

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8787/spotify/callback
SPOTIFY_CALLBACK_HOST=127.0.0.1
SPOTIFY_CALLBACK_PORT=8787
```

The bot must be running on the same machine as the browser used for the
connection when using the localhost redirect URI. A deployed bot needs a
public HTTPS redirect URI routed to its callback server.

## Commands

- `/spotify connect` - privately receive the Spotify connection link
- `/spotify history` - publish the invoking user's recent tracks
- `/spotify history count:20` - publish up to 20 tracks
- `/spotify status` - privately inspect the connection
- `/spotify disconnect` - privately remove the stored connection

Refresh tokens are stored in `spotify-tokens.json`, which is ignored by Git.
