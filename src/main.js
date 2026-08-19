import { SPOTIFY_CLIENT_ID } from "./config.js";
import { isPreviewMode, PREVIEW_PLAYBACK } from "./preview.js";
import {
  createAuthorizeUrl,
  createCodeChallenge,
  createRandomString,
  exchangeCode,
  getAccessToken,
  getNowPlaying,
  normalizeNowPlaying,
} from "./spotify.js";

const POLL_INTERVAL = 5_000;
const REDIRECT_URI = `${window.location.origin}${window.location.pathname}`;
const AUTH_STATE_KEY = "spotify_auth_state";
const VERIFIER_KEY = "spotify_code_verifier";
const SECTION_NAMES = ["setup", "login", "viewer", "message"];
const previewMode = isPreviewMode(window.location.search);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let playbackClock = null;
let progressAnimationFrame = null;

const elements = {
  setup: document.querySelector("#setup"),
  login: document.querySelector("#login"),
  viewer: document.querySelector("#viewer"),
  message: document.querySelector("#message"),
  messageTitle: document.querySelector("#message-title"),
  messageText: document.querySelector("#message-text"),
  cover: document.querySelector("#cover"),
  trackLink: document.querySelector("#track-link"),
  status: document.querySelector("#status"),
  title: document.querySelector("#title"),
  artist: document.querySelector("#artist"),
  album: document.querySelector("#album"),
  progress: document.querySelector("#progress"),
};

function show(name) {
  SECTION_NAMES.forEach((key) => {
    elements[key].hidden = key !== name;
  });
}

function setMessage(title, text) {
  elements.messageTitle.textContent = title;
  elements.messageText.textContent = text;
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_STATE_KEY);
  localStorage.removeItem(VERIFIER_KEY);
}

function setProgress(progress) {
  const boundedProgress = Math.min(100, Math.max(0, progress));
  const roundedProgress = String(Math.round(boundedProgress));

  if (elements.progress.getAttribute("aria-valuenow") !== roundedProgress) {
    elements.progress.setAttribute("aria-valuenow", roundedProgress);
  }
  elements.progress.style.setProperty("--progress", `${boundedProgress}%`);
  elements.progress.style.setProperty("--record-offset", `${-boundedProgress}%`);
}

function estimatedPosition(clock, now) {
  if (!clock.isPlaying) return clock.positionMs;

  const elapsed = Math.min(now - clock.syncedAt, POLL_INTERVAL);
  const correctionProgress = Math.min(1, elapsed / POLL_INTERVAL);
  return clock.positionMs + elapsed + (clock.correctionMs * correctionProgress);
}

function animateProgress(now) {
  if (!playbackClock) return;

  const positionMs = Math.min(playbackClock.durationMs, estimatedPosition(playbackClock, now));
  setProgress(playbackClock.durationMs ? (positionMs / playbackClock.durationMs) * 100 : 0);

  const withinPollInterval = now - playbackClock.syncedAt < POLL_INTERVAL;
  if (playbackClock.isPlaying && positionMs < playbackClock.durationMs && withinPollInterval) {
    progressAnimationFrame = window.requestAnimationFrame(animateProgress);
  } else {
    progressAnimationFrame = null;
  }
}

function syncProgress(playback, track) {
  const now = performance.now();
  const durationMs = Number(playback.item?.duration_ms) || 0;
  const serverPositionMs = Math.min(durationMs, Number(playback.progress_ms) || 0);
  const trackKey = track.spotifyUrl || `${track.title}:${track.artist}`;
  let positionMs = serverPositionMs;
  let correctionMs = 0;

  if (playbackClock?.trackKey === trackKey && playbackClock.isPlaying && track.isPlaying) {
    const currentPositionMs = estimatedPosition(playbackClock, now);
    const differenceMs = serverPositionMs - currentPositionMs;

    // Small polling discrepancies are blended in; larger differences are deliberate seeks.
    if (Math.abs(differenceMs) < 2_000) {
      positionMs = currentPositionMs;
      correctionMs = differenceMs;
    }
  }

  playbackClock = {
    trackKey,
    positionMs,
    correctionMs,
    durationMs,
    isPlaying: track.isPlaying,
    syncedAt: now,
  };

  setProgress(durationMs ? (positionMs / durationMs) * 100 : track.progress);

  if (reduceMotion || !track.isPlaying || !durationMs) return;
  if (progressAnimationFrame === null) {
    progressAnimationFrame = window.requestAnimationFrame(animateProgress);
  }
}

async function signIn() {
  const state = createRandomString(32);
  const verifier = createRandomString();
  localStorage.setItem(AUTH_STATE_KEY, state);
  localStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = await createCodeChallenge(verifier);
  window.location.assign(
    createAuthorizeUrl({ clientId: SPOTIFY_CLIENT_ID, redirectUri: REDIRECT_URI, state, challenge }),
  );
}

async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return;

  const expectedState = localStorage.getItem(AUTH_STATE_KEY);
  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!expectedState || params.get("state") !== expectedState || !verifier) {
    throw new Error("Spotify login state did not match. Please sign in again.");
  }

  await exchangeCode({
    code,
    verifier,
    clientId: SPOTIFY_CLIENT_ID,
    redirectUri: REDIRECT_URI,
    storage: localStorage,
  });
  clearAuthSession();
  window.history.replaceState({}, "", REDIRECT_URI);
}

function render(playback) {
  const track = normalizeNowPlaying(playback);
  if (!track) {
    playbackClock = null;
    if (progressAnimationFrame !== null) {
      window.cancelAnimationFrame(progressAnimationFrame);
      progressAnimationFrame = null;
    }
    setMessage("Nothing playing", "Start playing something in Spotify.");
    show("message");
    return;
  }

  elements.title.textContent = track.title;
  elements.artist.textContent = track.artist;
  elements.album.textContent = track.album;
  elements.status.textContent = track.isPlaying ? "Now playing" : "Paused";
  syncProgress(playback, track);
  elements.progress.classList.toggle("is-playing", track.isPlaying);
  elements.cover.src = track.imageUrl || "";
  elements.cover.alt = track.album ? `${track.album} cover` : "Cover art";
  elements.trackLink.href = track.spotifyUrl || "https://open.spotify.com";
  show("viewer");
}

async function poll() {
  let nextPoll = POLL_INTERVAL;
  try {
    const accessToken = await getAccessToken({ clientId: SPOTIFY_CLIENT_ID, storage: localStorage });
    if (!accessToken) {
      show("login");
      return;
    }
    render(await getNowPlaying(accessToken));
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem("spotify_access_token_expires_at");
      nextPoll = 0;
    } else if (error.status === 429) {
      nextPoll = (error.retryAfter || 10) * 1000;
    } else {
      setMessage("Could not load Spotify", error.message);
      show("message");
    }
  }
  window.setTimeout(poll, nextPoll);
}

document.querySelector("#login-button").addEventListener("click", signIn);

async function start() {
  if (previewMode) {
    render(PREVIEW_PLAYBACK);
    return;
  }

  if (!SPOTIFY_CLIENT_ID || SPOTIFY_CLIENT_ID === "YOUR_SPOTIFY_CLIENT_ID") {
    show("setup");
    return;
  }

  try {
    await handleCallback();
    await poll();
  } catch (error) {
    setMessage("Spotify login failed", error.message);
    show("message");
  }
}

start();
