import test from "node:test";
import assert from "node:assert/strict";

import {
  clearTokens,
  createAuthorizeUrl,
  getAccessToken,
  normalizeNowPlaying,
} from "../src/spotify.js";

function createStorage(values = {}) {
  const data = new Map(Object.entries(values));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    data,
  };
}

test("authorization URL uses PKCE and the minimum scope", () => {
  const url = new URL(
    createAuthorizeUrl({
      clientId: "client-id",
      redirectUri: "https://example.com/",
      state: "state",
      challenge: "challenge",
    }),
  );

  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://example.com/");
  assert.equal(url.searchParams.get("scope"), "user-read-currently-playing");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

test("a valid stored access token is reused", async () => {
  const storage = createStorage({
    spotify_access_token: "access",
    spotify_access_token_expires_at: "200000",
  });

  const token = await getAccessToken({ clientId: "client", storage, now: 100000 });
  assert.equal(token, "access");
});

test("an expired access token is refreshed and saved", async () => {
  const storage = createStorage({ spotify_refresh_token: "refresh" });
  const fetcher = async () => ({
    ok: true,
    json: async () => ({ access_token: "new-access", expires_in: 3600 }),
  });

  const token = await getAccessToken({ clientId: "client", storage, fetcher, now: 100000 });
  assert.equal(token, "new-access");
  assert.equal(storage.getItem("spotify_access_token"), "new-access");
  assert.equal(storage.getItem("spotify_refresh_token"), "refresh");
});

test("a failed refresh clears stale Spotify tokens", async () => {
  const storage = createStorage({
    spotify_access_token: "expired",
    spotify_refresh_token: "invalid",
    spotify_access_token_expires_at: "1",
  });
  const fetcher = async () => ({
    ok: false,
    json: async () => ({ error: "invalid_grant" }),
  });

  await assert.rejects(
    getAccessToken({ clientId: "client", storage, fetcher, now: 100000 }),
    /invalid_grant/,
  );
  assert.equal(storage.getItem("spotify_access_token"), null);
  assert.equal(storage.getItem("spotify_refresh_token"), null);
});

test("track playback is reduced to view data", () => {
  const track = normalizeNowPlaying({
    is_playing: true,
    progress_ms: 50,
    item: {
      type: "track",
      name: "Song",
      duration_ms: 200,
      artists: [{ name: "Artist One" }, { name: "Artist Two" }],
      album: { name: "Album", images: [{ url: "cover.jpg" }] },
      external_urls: { spotify: "https://open.spotify.com/track/1" },
    },
  });

  assert.deepEqual(track, {
    title: "Song",
    artist: "Artist One, Artist Two",
    album: "Album",
    imageUrl: "cover.jpg",
    spotifyUrl: "https://open.spotify.com/track/1",
    progress: 25,
    isPlaying: true,
  });
});

test("clearing tokens leaves unrelated local storage intact", () => {
  const storage = createStorage({
    spotify_access_token: "access",
    spotify_refresh_token: "refresh",
    spotify_access_token_expires_at: "100",
    preference: "keep",
  });

  clearTokens(storage);
  assert.equal(storage.getItem("spotify_access_token"), null);
  assert.equal(storage.getItem("spotify_refresh_token"), null);
  assert.equal(storage.getItem("preference"), "keep");
});
