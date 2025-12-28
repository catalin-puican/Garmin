import { execFile } from "child_process";
import util from "util";
import path from "path";
import { fileURLToPath } from "url";

const execFileAsync = util.promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const YTDLP = path.resolve(__dirname, "../../bin/yt-dlp.exe");

// ⚡ YouTube Data API v3 (if available)
//const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
//const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";

// ⚡ Cache search results (cleared every hour)
const searchCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/*async function searchWithAPI(query) {
  if (!YOUTUBE_API_KEY) {
    console.log("⚠️ No YouTube API key found, using yt-dlp");
    return null;
  }

  try {
    const params = new URLSearchParams({
      part: "snippet",
      q: query,
      type: "video",
      maxResults: 1,
      key: YOUTUBE_API_KEY
    });

    const response = await fetch(`${YOUTUBE_SEARCH_URL}?${params}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ YouTube API error:", response.status, errorText);
      return null;
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      console.log("❌ No results from API");
      return null;
    }

    const video = data.items[0];
    const title = video.snippet.title;
    const videoId = video.id.videoId;

    console.log("⚡ API found:", title);

    return {
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`
    };
  } catch (e) {
    console.error("❌ YouTube API error:", e.message);
    return null;
  }
}*/

async function searchWithYtDlp(query) {
  try {
    const { stdout } = await execFileAsync(
      YTDLP,
      [
        `ytsearch1:${query}`,    // Search and return 1 result
        "--flat-playlist",       // ⚡ The most important flag: treats search results as a list, doesn't verify video availability (faster/safer)
        "--print",               // Tell yt-dlp to output specific data
        "%(title)s\n%(id)s",     // Format: Line 1 = Title, Line 2 = Video ID
        "--no-warnings",         // Prevent warning messages from messing up the parsing
        "--user-agent",          // Helps avoid being flagged as a bot
        "Mozilla/5.0"
      ],
      { windowsHide: true } // Keeps the command prompt window hidden on Windows
    );

    // Parse the output
    const output = stdout.trim().split("\n");
    
    // Safety check: ensure we got both lines
    if (output.length < 2) return null;

    const title = output[0];
    const id = output[1];

    console.log("🎵 yt-dlp found:", title);

    return {
      title,
      url: `https://www.youtube.com/watch?v=${id}`
    };
  } catch (e) {
    console.error("❌ yt-dlp error:", e.message);
    return null;
  }
}

export async function searchYouTube(query) {
  if (!query) return null;

  const normalizedQuery = query.toLowerCase().trim();

  // ⚡ Check cache first
  const cached = searchCache.get(normalizedQuery);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log("⚡ Cache hit:", cached.data.title);
    return cached.data;
  }

  console.log("🔍 Searching for:", query);

  // ⚡ Try API first (fast), fallback to yt-dlp (reliable)
  //let result = await searchWithAPI(query);
  
 /* if (!result) {
    console.log("⚠️ API failed, falling back to yt-dlp...");
    result = await searchWithYtDlp(query);
  }

  if (!result) {
    console.log("❌ No results found anywhere");
    return null;
  }*/

  const result = await searchWithYtDlp(query);
  if (!result) {
    console.log("❌ No results found");
    return null;
  }

      // ⚡ Store in cache
  searchCache.set(normalizedQuery, {
    data: result,
    timestamp: Date.now()
  });

  return result;
}

// ⚡ Periodically clean old cache entries
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp >= CACHE_TTL) {
      searchCache.delete(key);
    }
  }
}, CACHE_TTL);