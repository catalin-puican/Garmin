import {
  EndBehaviorType,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus
} from "@discordjs/voice";

import { opus } from "prism-media";
import { pcmToWavBuffer } from "./audio.js";
import { transcribe } from "../groq/transcribe.js";
import { parseIntent } from "./intent.js";
import { SILENCE_DURATION, MAX_AUDIO_DURATION_MS } from "../config.js";
import { searchYouTube } from "../music/search.js";
import { streamYouTube } from "../music/stream.js";
import { speak } from "./tts.js";

// ✅ Track active streams per guild
const activeStreams = new Map();

// ✅ Track if listening is active per guild
const listeningActive = new Map();

export function stopListening(guildId) {
  console.log(`🛑 [${guildId}] Stopping listener`);
  listeningActive.set(guildId, false);
  
  // Cleanup active stream
  const stream = activeStreams.get(guildId);
  if (stream) {
    stream.destroy();
    activeStreams.delete(guildId);
  }
}

export function listen(connection, userId, player, guildId) {
  // ✅ Mark as actively listening
  listeningActive.set(guildId, true);
  
  // ✅ Check if connection is valid before listening
  if (connection.state.status === VoiceConnectionStatus.Destroyed) {
    console.log(`⚠️ [${guildId}] Connection destroyed, stopping listener`);
    stopListening(guildId);
    return;
  }

  // ✅ Check if we should still be listening
  if (!listeningActive.get(guildId)) {
    console.log(`⚠️ [${guildId}] Listening disabled, not starting new listener`);
    return;
  }

  const receiver = connection.receiver;

  // ⚡ Subscribe to ONLY the specified user's audio
  const opusStream = receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: SILENCE_DURATION
    }
  });

  // ⚡ Optimized decoder settings
  const decoder = new opus.Decoder({
    rate: 16000,
    channels: 1,
    frameSize: 960
  });

  let chunks = [];
  let startTime = Date.now();
  let isProcessing = false;

  opusStream.pipe(decoder);

  decoder.on("data", chunk => {
    chunks.push(chunk);
    
    const elapsed = Date.now() - startTime;
    if (elapsed >= MAX_AUDIO_DURATION_MS) {
      decoder.end();
    }
  });

  decoder.once("end", async () => {
    if (isProcessing) return;
    isProcessing = true;

    // ✅ Check if still listening
    if (!listeningActive.get(guildId)) {
      return;
    }

    // ✅ Need at least some audio
    if (chunks.length < 3) {
      if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
        return listen(connection, userId, player, guildId);
      }
      return;
    }

    const pcm = Buffer.concat(chunks);
    const wav = pcmToWavBuffer(pcm);
    
    const text = await transcribe(wav);

    if (!text) {
      if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
        return listen(connection, userId, player, guildId);
      }
      return;
    }

    console.log(`🗣️ [${guildId}] Heard:`, text);

    const intent = parseIntent(text);

    if (intent?.type === "play") {
      const video = await searchYouTube(intent.query);

      if (!video) {
        const notFoundTts = speak("I couldn't find that song");
        player.play(notFoundTts);
        
        if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
          return listen(connection, userId, player, guildId);
        }
        return;
      }

      console.log(`▶️ [${guildId}] Now playing:`, video.title);

      // ✅ Cleanup old stream for this guild
      const oldStream = activeStreams.get(guildId);
      if (oldStream) {
        oldStream.destroy();
      }

      // ✅ Start new stream
      const newStream = streamYouTube(video.url);
      activeStreams.set(guildId, newStream);

      // 📢 Say title while stream buffers
      const ttsResource = speak(`Now playing ${video.title}`);
      player.play(ttsResource);

      // 🎯 Play music after TTS
      player.once(AudioPlayerStatus.Idle, () => {
        if (!listeningActive.get(guildId)) return;
        
        const music = createAudioResource(newStream, {
          inputType: StreamType.Raw,
          inlineVolume: true
        });
        player.play(music);
      });

      if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
        return listen(connection, userId, player, guildId);
      }
      return;
    }

    if (intent?.type === "stop") {
      const stream = activeStreams.get(guildId);
      if (stream) {
        stream.destroy();
        activeStreams.delete(guildId);
      }
      player.stop(true);
      
      if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
        return listen(connection, userId, player, guildId);
      }
      return;
    }

    if (intent?.type === "disconnect") {
      const stream = activeStreams.get(guildId);
      if (stream) {
        stream.destroy();
        activeStreams.delete(guildId);
      }
      player.stop(true);
      stopListening(guildId);
      connection.destroy();
      return;
    }

    // ✅ Continue listening
    if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
      listen(connection, userId, player, guildId);
    }
  });

  // 🔒 Handle errors gracefully
  opusStream.on("error", err => {
    const errMsg = err.message || String(err);
    
    if (errMsg.includes("decrypt") || errMsg.includes("Decryption")) {
      console.log(`⚠️ [${guildId}] Decryption error, retrying...`);
    } else {
      console.error(`⚠️ [${guildId}] Opus stream error:`, errMsg);
    }
    
    if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
      setTimeout(() => listen(connection, userId, player, guildId), 500);
    }
  });

  decoder.on("error", err => {
    console.error(`⚠️ [${guildId}] Decoder error:`, err.message);
    if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
      listen(connection, userId, player, guildId);
    }
  });
}