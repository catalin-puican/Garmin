// Queue management per guild

class MusicQueue {
  constructor() {
    this.songs = [];
    this.current = null;
    this.volume = 50; // Default 50%
    this.isPaused = false;
  }

  add(song) {
    this.songs.push(song);
  }

  next() {
    this.current = this.songs.shift() || null;
    return this.current;
  }

  peek() {
    return this.songs[0] || null;
  }

  clear() {
    this.songs = [];
  }

  isEmpty() {
    return this.songs.length === 0;
  }

  size() {
    return this.songs.length;
  }

  list() {
    return this.songs;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(100, vol));
  }

  getVolume() {
    return this.volume;
  }

  setPaused(paused) {
    this.isPaused = paused;
  }
}

// Store queues per guild
const queues = new Map();

export function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, new MusicQueue());
  }
  return queues.get(guildId);
}

export function clearQueue(guildId) {
  const queue = getQueue(guildId);
  queue.clear();
  queue.current = null;
}

export function deleteQueue(guildId) {
  queues.delete(guildId);
}