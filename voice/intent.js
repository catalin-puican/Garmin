import { WAKE_WORD_REGEX } from "../config.js";

export function hasWakeWord(text) {
  return WAKE_WORD_REGEX.test(text.toLowerCase());
}

export function parseIntent(text) {
  const clean = text.toLowerCase().replace(/[^\w\s]/g, " ");

  if (!WAKE_WORD_REGEX.test(clean)) return null;

  const afterWake = clean.replace(WAKE_WORD_REGEX, "").trim();

  const playMatch = afterWake.match(
    /\b(play|played|plays|playing)\b\s*(.+)?/
  );

  if (playMatch) {
    const query = playMatch[2]?.trim();
    if (!query || query.length < 2) return null;

    return {
      type: "play",
      query
    };
  }

  if (afterWake.includes("stop")) return { type: "stop" };

  if (["leave", "disconnect", "exit"].some(w => afterWake.includes(w))) {
    return { type: "disconnect" };
  }

  return null;
}
