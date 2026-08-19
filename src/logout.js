import { clearTokens } from "./spotify.js";

const AUTH_KEYS = ["spotify_auth_state", "spotify_code_verifier"];

clearTokens(localStorage);
for (const key of AUTH_KEYS) {
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
}

window.location.replace(new URL("../", window.location.href));
