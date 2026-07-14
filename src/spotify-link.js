const SPOTIFY_OEMBED_URL = "https://open.spotify.com/oembed";
const SPOTIFY_TRACK_URL_PATTERN = /https?:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]+)/gi;

class SpotifyLinkError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "SpotifyLinkError";
  }
}

function extractSpotifyTrackUrl(content) {
  if (typeof content !== "string" || content.length === 0) return null;

  const match = SPOTIFY_TRACK_URL_PATTERN.exec(content);
  SPOTIFY_TRACK_URL_PATTERN.lastIndex = 0;
  if (!match) return null;

  return `https://open.spotify.com/track/${match[1]}`;
}

function isSpotifyImageUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "i.scdn.co" ||
        url.hostname === "spotifycdn.com" ||
        url.hostname.endsWith(".spotifycdn.com"));
  } catch {
    return false;
  }
}

function cleanMetadataText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

async function fetchSpotifyTrackMetadata(
  trackUrl,
  fetchImpl = globalThis.fetch,
) {
  const normalizedUrl = extractSpotifyTrackUrl(trackUrl);
  if (!normalizedUrl) {
    throw new SpotifyLinkError("A valid Spotify track URL is required.");
  }
  if (typeof fetchImpl !== "function") {
    throw new SpotifyLinkError("Fetch is not available in this runtime.");
  }

  const endpoint = new URL(SPOTIFY_OEMBED_URL);
  endpoint.searchParams.set("url", normalizedUrl);

  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: {
        accept: "application/json",
        "user-agent": "miq-discord-bot/1.0",
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    throw new SpotifyLinkError("Spotify track information could not be fetched.", {
      cause: error,
    });
  }

  if (!response?.ok) {
    throw new SpotifyLinkError(
      `Spotify track information request failed with status ${response?.status ?? "unknown"}.`,
    );
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new SpotifyLinkError("Spotify returned invalid track information.", { cause: error });
  }

  const title = cleanMetadataText(data?.title, 256);
  if (!title) {
    throw new SpotifyLinkError("Spotify did not return a track title.");
  }

  return {
    title,
    authorName: cleanMetadataText(data?.author_name, 1024),
    thumbnailUrl: isSpotifyImageUrl(data?.thumbnail_url) ? data.thumbnail_url : null,
    providerUrl: normalizedUrl,
  };
}

export {
  SPOTIFY_OEMBED_URL,
  SPOTIFY_TRACK_URL_PATTERN,
  SpotifyLinkError,
  extractSpotifyTrackUrl,
  fetchSpotifyTrackMetadata,
  isSpotifyImageUrl,
};
