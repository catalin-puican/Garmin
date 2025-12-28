// ⚡ Optimized PCM to WAV conversion
export function pcmToWavBuffer(pcm) {
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  
  const header = Buffer.allocUnsafe(44); // ⚡ allocUnsafe is faster
  
  // RIFF header
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  
  // fmt chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);  // fmt chunk size
  header.writeUInt16LE(1, 20);   // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28); // byte rate
  header.writeUInt16LE(channels * (bitsPerSample / 8), 32);  // block align
  header.writeUInt16LE(bitsPerSample, 34);
  
  // data chunk
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  // ⚡ Single concatenation instead of multiple
  return Buffer.concat([header, pcm]);
}