import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { PassThrough } from "stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const YTDLP = path.resolve(__dirname, "../../bin/yt-dlp.exe");

export function streamYouTube(url) {
  const ytdlp = spawn(
    YTDLP,
    [
      "-f", "bestaudio[ext=webm]/bestaudio",  // ⚡ Prefer WebM (faster start)
      "-o", "-",
      "--no-playlist",
      "--user-agent", "Mozilla/5.0",
      "--buffer-size", "16K",  // ⚡ Smaller buffer = faster start
      url
    ],
    { windowsHide: true }
  );

  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-i", "pipe:0",
      "-analyzeduration", "0",  // ⚡ Don't analyze, start immediately
      "-probesize", "32",       // ⚡ Minimal probing
      "-ar", "48000",
      "-ac", "2",
      "-f", "s16le",
      "-bufsize", "64k",        // ⚡ Small buffer
      "pipe:1"
    ],
    { windowsHide: true }
  );

  // ✅ Create a passthrough stream we can destroy
  const output = new PassThrough();

  ytdlp.stdout.pipe(ffmpeg.stdin);
  ffmpeg.stdout.pipe(output);

  // ✅ Suppress EPIPE errors on pipes
  ytdlp.stdout.on("error", () => {});
  ffmpeg.stdin.on("error", () => {});
  ffmpeg.stdout.on("error", () => {});

  // ✅ Handle process errors
  ytdlp.on("error", err => {
    console.error("❌ yt-dlp error:", err.message);
  });

  ffmpeg.on("error", err => {
    console.error("❌ ffmpeg error:", err.message);
  });

  // ✅ Suppress stderr noise (only log real errors)
  ytdlp.stderr.on("data", data => {
    const msg = data.toString();
    if (msg.includes("ERROR")) {
      console.error("yt-dlp:", msg);
    }
  });

  ffmpeg.stderr.on("data", data => {
    const msg = data.toString();
    if (msg.includes("Error") && !msg.includes("time=")) {
      console.error("ffmpeg:", msg);
    }
  });

  let isCleanedUp = false;

  // ✅ Cleanup function with proper pipe handling
  function cleanup() {
    if (isCleanedUp) return;
    isCleanedUp = true;

    // 1️⃣ First unpipe everything to prevent EPIPE
    try {
      ytdlp.stdout.unpipe(ffmpeg.stdin);
      ffmpeg.stdout.unpipe(output);
    } catch (e) {
      // Ignore unpipe errors
    }

    // 2️⃣ Then kill the processes
    try {
      if (!ytdlp.killed) ytdlp.kill("SIGKILL");
    } catch (e) {
      // Process might already be dead
    }

    try {
      if (!ffmpeg.killed) ffmpeg.kill("SIGKILL");
    } catch (e) {
      // Process might already be dead
    }
  }

  // ✅ When output stream ends/closes, cleanup everything
  output.on("close", cleanup);
  output.on("error", cleanup);

  // ✅ Override destroy to cleanup properly
  const originalDestroy = output.destroy.bind(output);
  output.destroy = function(error) {
    cleanup();
    return originalDestroy(error);
  };

  return output;
}