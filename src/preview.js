export const PREVIEW_PLAYBACK = {
  is_playing: true,
  progress_ms: 142_000,
  item: {
    type: "track",
    name: "Midnight City Lights",
    duration_ms: 238_000,
    artists: [{ name: "The Local Sessions" }],
    album: {
      name: "Layout Preview",
      images: [{ url: "assets/preview-cover.svg" }],
    },
    external_urls: { spotify: "https://open.spotify.com" },
  },
};

export function isPreviewMode(search) {
  return new URLSearchParams(search).get("preview") === "1";
}
