import { describe, it, expect } from "vitest";
import { searchYouTube } from "../src/music/search.js";

describe("YouTube search", () => {
  it("returns a url", async () => {
    const v = await searchYouTube("despacito");
    expect(v.url).toContain("youtube.com");
  });
});
