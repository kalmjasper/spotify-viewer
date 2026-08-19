const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const NOW_PLAYING_URL = "https://api.spotify.com/v1/me/player/currently-playing?additional_types=track,episode";

const TOKEN_KEYS = {
  access: "spotify_access_token",
  refresh: "spotify_refresh_token",
  expires: "spotify_access_token_expires_at",
};
const TOKEN_STORAGE_KEYS = [TOKEN_KEYS.access, TOKEN_KEYS.refresh, TOKEN_KEYS.expires];

export function createRandomString(length = 64) {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (value) => characters[value % characters.length]).join("");
}

export async function createCodeChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function createAuthorizeUrl({ clientId, redirectUri, state, challenge }) {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "user-read-currently-playing",
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  return url.toString();
}

async function requestToken(body, fetcher = fetch) {
  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Spotify authentication failed");
  }

  return response.json();
}

function saveToken(token, storage, now = Date.now()) {
  storage.setItem(TOKEN_KEYS.access, token.access_token);
  storage.setItem(TOKEN_KEYS.expires, String(now + token.expires_in * 1000));
  if (token.refresh_token) {
    storage.setItem(TOKEN_KEYS.refresh, token.refresh_token);
  }
}

export async function exchangeCode({ code, verifier, clientId, redirectUri, storage, fetcher }) {
  const token = await requestToken(
    {
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    },
    fetcher,
  );
  saveToken(token, storage);
}

export async function getAccessToken({ clientId, storage, fetcher, now = Date.now() }) {
  const accessToken = storage.getItem(TOKEN_KEYS.access);
  const expiresAt = Number(storage.getItem(TOKEN_KEYS.expires));
  if (accessToken && expiresAt > now + 60_000) return accessToken;

  const refreshToken = storage.getItem(TOKEN_KEYS.refresh);
  if (!refreshToken) return null;

  try {
    const token = await requestToken(
      {
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      },
      fetcher,
    );
    saveToken(token, storage, now);
    return token.access_token;
  } catch (error) {
    clearTokens(storage);
    throw error;
  }
}

export async function getNowPlaying(accessToken, fetcher = fetch) {
  const response = await fetcher(NOW_PLAYING_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 204) return null;
  if (!response.ok) {
    const error = new Error(`Spotify request failed (${response.status})`);
    error.status = response.status;
    error.retryAfter = Number(response.headers.get("Retry-After")) || null;
    throw error;
  }
  return response.json();
}

export function normalizeNowPlaying(playback) {
  const item = playback?.item;
  if (!item) {
    return null;
  }

  const progress = item.duration_ms ? (playback.progress_ms / item.duration_ms) * 100 : 0;

  if (item.type === "episode") {
    return {
      title: item.name,
      artist: item.show?.name || "Podcast",
      album: "Podcast episode",
      imageUrl: item.images?.[0]?.url,
      spotifyUrl: item.external_urls?.spotify,
      progress,
      isPlaying: playback.is_playing,
    };
  }

  return {
    title: item.name,
    artist: item.artists?.map(({ name }) => name).join(", ") || "Unknown artist",
    album: item.album?.name || "Unknown album",
    imageUrl: item.album?.images?.[0]?.url,
    spotifyUrl: item.external_urls?.spotify,
    progress,
    isPlaying: playback.is_playing,
  };
}

export function clearTokens(storage) {
  for (const key of TOKEN_STORAGE_KEYS) {
    storage.removeItem(key);
  }
}
