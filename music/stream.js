import play from "play-dl";
import { PassThrough } from "stream";

/**
 * Streams YouTube audio in a Discord-compatible way
 * - No external binaries
 * - Works on Railway / Linux
 * - Stable for long playback
 */
export async function streamYouTube(url) {
  try {
    // Refresh token if needed (required occasionally)
    if (play.is_expired()) {
      await play.refreshToken();
    }

    const streamInfo = await play.stream(url, {
      quality: 2, // highest available audio
      discordPlayerCompatibility: true
    });

    const output = new PassThrough();

    streamInfo.stream.pipe(output);

    streamInfo.stream.on("error", (err) => {
      console.error("❌ play-dl stream error:", err);
      output.destroy(err);
    });

    output.on("close", () => {
      try {
        streamInfo.stream.destroy();
      } catch {}
    });

    return output;
  } catch (err) {
    console.error("❌ Failed to stream YouTube:", err);
    throw err;
  }
}
