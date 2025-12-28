// ⚡ Cache (cleared every hour)
const searchCache = new Map();
const CACHE_TTL = 60 * 60 * 1000;

async function searchWithScraper(query) {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    
    // 1. Fetch search page
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    
    if (!response.ok) return null;
    const html = await response.text();

    // 2. Extract Video ID
    const idMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    const titleMatch = html.match(/"title":{"runs":\[{"text":"(.*?)"}/);

    if (!idMatch) return null;

    const title = titleMatch ? titleMatch[1] : "Unknown Title";
    console.log("⚡ Scraper found:", title);

    return {
      title,
      url: `https://www.youtube.com/watch?v=${idMatch[1]}`
    };

  } catch (e) {
    console.error("❌ Scraper Error:", e.message);
    return null;
  }
}

export async function searchYouTube(query) {
  if (!query) return null;
  const normalizedQuery = query.toLowerCase().trim();

  // Check Cache
  const cached = searchCache.get(normalizedQuery);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log("⚡ Cache hit:", cached.data.title);
    return cached.data;
  }

  console.log("🔍 Searching for:", query);
  const result = await searchWithScraper(query);

  if (!result) {
    console.log("❌ No results found");
    return null;
  }

  searchCache.set(normalizedQuery, { data: result, timestamp: Date.now() });
  return result;
}

// Clean cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp >= CACHE_TTL) searchCache.delete(key);
  }
}, CACHE_TTL);