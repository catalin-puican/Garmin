import { WAKE_WORD_REGEX } from "../config.js";

export function hasWakeWord(text) {
  return WAKE_WORD_REGEX.test(text.toLowerCase());
}

// ✅ Convert word numbers to digits
function wordsToNumber(text) {
  const ones = {
    'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4,
    'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
    'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13,
    'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17,
    'eighteen': 18, 'nineteen': 19
  };

  const tens = {
    'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50,
    'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90
  };

  const words = text.toLowerCase().trim().split(/\s+/);
  let total = 0;

  // Handle single word numbers
  if (words.length === 1) {
    if (ones[words[0]] !== undefined) return ones[words[0]];
    if (tens[words[0]] !== undefined) return tens[words[0]];
    if (words[0] === 'hundred') return 100;
  }

  // Handle two-word numbers like "twenty four"
  if (words.length === 2) {
    const firstWord = words[0];
    const secondWord = words[1];

    if (tens[firstWord] !== undefined) {
      total = tens[firstWord];
      if (ones[secondWord] !== undefined) {
        total += ones[secondWord];
      }
      return total;
    }
  }

  // Handle "one hundred", "hundred", etc.
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    
    if (ones[word] !== undefined) {
      total += ones[word];
    } else if (tens[word] !== undefined) {
      total += tens[word];
    } else if (word === 'hundred') {
      if (total === 0) total = 1;
      total *= 100;
    }
  }

  return total > 0 ? total : null;
}

// ✅ Extract number from text (handles both digits and words)
function extractNumber(text) {
  // First try to find a digit
  const digitMatch = text.match(/\b(\d+)\b/);
  if (digitMatch) {
    return parseInt(digitMatch[1]);
  }

  // Try word-to-number conversion
  // Look for number words in the text
  const numberWords = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/gi;
  
  const matches = text.match(numberWords);
  if (matches) {
    const numberText = matches.join(' ');
    const num = wordsToNumber(numberText);
    if (num !== null) return num;
  }

  return null;
}

export function parseIntent(text) {
  const clean = text.toLowerCase().replace(/[^\w\s]/g, " ");

  if (!WAKE_WORD_REGEX.test(clean)) return null;

  const afterWake = clean.replace(WAKE_WORD_REGEX, "").trim();

  // ⚡ Play variations: play, plays, played, playing, please, place, plate, praise
  const playMatch = afterWake.match(
    /\b(play|plays|played|playing|please|place|plate|praise)\b\s*(.+)?/
  );

  if (playMatch) {
    const query = playMatch[2]?.trim();
    if (!query || query.length < 2) return null;

    return {
      type: "play",
      query
    };
  }

  // ⚡ Queue variations: queue, q, show queue, what's next, whats next
  // IMPORTANT: Check this BEFORE skip to prevent "next" from triggering skip
  if (/\b(queue|q|show queue|whats next|what's next|what's in queue|show q)\b/.test(afterWake)) {
    return { type: "queue" };
  }

  // ⚡ Skip variations: skip, skip this, skip song, next song
  // Made more specific to avoid catching "what's next"
  if (/\b(skip|skip this|skip song|next song)\b/.test(afterWake)) {
    return { type: "skip" };
  }

  // ⚡ Pause variations: pause, paws, pals
  if (/\b(pause|paws|pals)\b/.test(afterWake)) {
    return { type: "pause" };
  }

  // ⚡ Resume variations: resume, continue, unpause, play again
  if (/\b(resume|continue|unpause|play again)\b/.test(afterWake)) {
    return { type: "resume" };
  }

  // ⚡ Stop variations: stop, stock
  if (/\b(stop|stock)\b/.test(afterWake)) {
    return { type: "stop" };
  }

  // ⚡ Clear queue: clear queue, clear q, clear, remove all
  if (/\b(clear queue|clear q|clear|remove all)\b/.test(afterWake)) {
    return { type: "clearqueue" };
  }

  // ⚡ Volume up: volume up, louder, increase volume, turn up
  if (/\b(volume up|louder|increase volume|turn up)\b/.test(afterWake)) {
    return { type: "volumeup" };
  }

  // ⚡ Volume down: volume down, quieter, softer, decrease volume, turn down
  if (/\b(volume down|quieter|softer|decrease volume|turn down)\b/.test(afterWake)) {
    return { type: "volumedown" };
  }

  // ⚡ Set specific volume: volume 50, volume to 50, set volume 50, volume twenty, volume twenty five
  // Extract everything after "volume" keyword
  const volumeMatch = afterWake.match(/\b(?:volume|set volume|volume to)\s+(.+)/);
  if (volumeMatch) {
    const volumePart = volumeMatch[1].trim();
    const level = extractNumber(volumePart);
    
    if (level !== null && level >= 0 && level <= 100) {
      return {
        type: "volume",
        level
      };
    }
  }

  // ⚡ Disconnect variations: leave, disconnect, exit, bye, goodbye
  if (/\b(leave|disconnect|exit|bye|goodbye)\b/.test(afterWake)) {
    return { type: "disconnect" };
  }

  return null;
}