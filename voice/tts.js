import { createAudioResource, StreamType } from "@discordjs/voice";
import { getAudioUrl } from "google-tts-api";

// ⚡ Cache TTS URLs (they expire after ~24h anyway)
const ttsCache = new Map();
const CACHE_SIZE_LIMIT = 50;

export function speak(text) {
  // ⚡ Check cache first
  if (ttsCache.has(text)) {
    const cachedUrl = ttsCache.get(text);
    return createAudioResource(cachedUrl, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true
    });
  }

  const url = getAudioUrl(text, {
    lang: "en",
    slow: false,
    host: "https://translate.google.com"
  });

  // ⚡ Store in cache (with size limit)
  if (ttsCache.size >= CACHE_SIZE_LIMIT) {
    // Remove oldest entry
    const firstKey = ttsCache.keys().next().value;
    ttsCache.delete(firstKey);
  }
  ttsCache.set(text, url);

  return createAudioResource(url, {
    inputType: StreamType.Arbitrary,
    inlineVolume: true
  });
}

// ⚡ Preload common phrases on startup
export function preloadCommonPhrases() {
  const common = [
    "Playing",
    "Stopping",
    "Disconnecting",
    "I couldn't find that song"
  ];

  common.forEach(phrase => speak(phrase));
  console.log("⚡ TTS cache preloaded");
}