export const WAKE_WORD_REGEX =
  /^(ok|okay|hey)\s*(garmin|garden|carmen|got him)/i;

// ⚡ Reduced from 350ms to 300ms for faster response
export const SILENCE_DURATION = 300;

// ⚡ Max recording duration in milliseconds (prevents memory issues)
export const MAX_AUDIO_DURATION_MS = 8000; // 8 seconds max