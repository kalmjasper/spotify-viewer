# Spotify Viewer

A small static website that displays the track currently playing on your Spotify account. Playback stays in the regular Spotify app or on your Spotify Connect device.

## Local setup

1. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Add the deployed site URL as a redirect URI. It must match exactly and use HTTPS, for example `https://example.com/spotify-viewer/`.
3. Replace `YOUR_SPOTIFY_CLIENT_ID` in `src/config.js` with the app's Client ID.
4. Deploy this directory to any static website host.

For local development, serve the directory over HTTP and register the exact loopback URL, for example `http://127.0.0.1:8080/`. Spotify does not allow `localhost` redirect URIs.

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/`.

## Verification

```sh
npm test
npm run check
```

The app uses Authorization Code with PKCE. It stores Spotify access and refresh tokens in the browser's local storage and never uses a Client Secret.

## Deploy to GitHub Pages

The included GitHub Actions workflow tests and deploys the site whenever `main` is pushed.

1. Push this repository to GitHub.
2. Open **Settings → Secrets and variables → Actions → Variables** and create a repository variable named `SPOTIFY_CLIENT_ID` containing the Client ID from the Spotify Developer Dashboard.
3. Open **Settings → Pages** and select **GitHub Actions** as the source.
4. Add the final Pages URL to the Spotify app's redirect URIs. For a project repository it will normally be `https://YOUR_NAME.github.io/REPOSITORY_NAME/`. The trailing slash matters.
5. Re-run the **Deploy to GitHub Pages** workflow if the first run happened before the variable or redirect URI was configured.

The deployment inserts the public Client ID into the published copy of `src/config.js`. The committed placeholder remains unchanged.
