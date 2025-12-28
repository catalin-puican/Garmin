// ⚡ Improved wake word regex to handle Whisper hallucinations
export const WAKE_WORD_REGEX = 
  /^(ok|okay|hey|oak|oke)\s*(garmin|garden|carmen|got him|carmine|guarding|guard|karma|car man)/i;

// ⚡ Reduced from 350ms to 300ms for faster response
export const SILENCE_DURATION = 300;

// ⚡ Max recording duration in milliseconds (prevents memory issues)
export const MAX_AUDIO_DURATION_MS = 8000; // 8 seconds max