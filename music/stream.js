import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { PassThrough } from "stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const YTDLP = path.resolve(__dirname, "../../bin/yt-dlp.exe");

export function streamYouTube(url) {
  // ⚡ Spawn yt-dlp with optimized settings
  const ytdlp = spawn(YTDLP, [
    url,
    "-f", "bestaudio[ext=webm]/bestaudio/best",  // ⚡ Prefer WebM (faster start)
    "-o", "-",
    "--quiet",
    "--no-warnings",
    "--no-playlist",
    "--buffer-size", "16K",  // ⚡ Smaller buffer = faster start
    "--extractor-retries", "3",
    "--no-check-certificates"
  ], {
    windowsHide: true
  });

  // ✅ Create PassThrough so we can properly destroy it
  const output = new PassThrough();

  // Pipe yt-dlp output to our PassThrough
  ytdlp.stdout.pipe(output);

  // ✅ Suppress pipe errors
  ytdlp.stdout.on("error", () => {});

  // ✅ Handle process errors
  ytdlp.on("error", (err) => {
    console.error("❌ Failed to start yt-dlp:", err.message);
    output.destroy();
  });

  // ✅ Handle stderr (only show real errors)
  ytdlp.stderr.on("data", (data) => {
    const msg = data.toString();
    if (msg.includes("ERROR")) {
      console.error("yt-dlp error:", msg);
    }
  });

  ytdlp.on("close", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`❌ yt-dlp exited with code ${code}`);
    }
  });

  let isCleanedUp = false;

  // ✅ Cleanup function
  function cleanup() {
    if (isCleanedUp) return;
    isCleanedUp = true;

    try {
      ytdlp.stdout.unpipe(output);
    } catch (e) {
      // Ignore unpipe errors
    }

    try {
      if (!ytdlp.killed) {
        ytdlp.kill("SIGKILL");
      }
    } catch (e) {
      // Process might already be dead
    }
  }

  // ✅ Cleanup on stream end
  output.on("close", cleanup);
  output.on("error", cleanup);

  // ✅ Override destroy for proper cleanup
  const originalDestroy = output.destroy.bind(output);
  output.destroy = function(error) {
    cleanup();
    return originalDestroy(error);
  };

  return output;
}