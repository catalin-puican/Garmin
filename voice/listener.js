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
import { getQueue } from "../music/queue.js";

// ✅ Track active streams per guild
const activeStreams = new Map();

// ✅ Track if listening is active per guild
const listeningActive = new Map();

// ✅ Track idle listeners to prevent duplicate auto-play
const idleListeners = new Map();

// ✅ Store Discord client reference for sending messages
let discordClient = null;

function setDiscordClient(client) {
  discordClient = client;
}

// ✅ Helper to play next song in queue
async function playNextInQueue(player, guildId) {
  const queue = getQueue(guildId);
  const nextSong = queue.next();

  if (!nextSong) {
    console.log(`🔭 [${guildId}] Queue empty`);
    return false;
  }

  console.log(`▶️ [${guildId}] Playing from queue:`, nextSong.title);

  // Cleanup old stream
  const oldStream = activeStreams.get(guildId);
  if (oldStream) {
    try {
      oldStream.destroy();
    } catch (e) {
      // Stream might already be destroyed
    }
  }

  // Start new stream
  const newStream = streamYouTube(nextSong.url);
  activeStreams.set(guildId, newStream);

  // Create audio resource with volume
  const music = createAudioResource(newStream, {
    inputType: StreamType.Arbitrary,
    inlineVolume: true
  });

  // Set volume
  const volume = queue.getVolume() / 100;
  music.volume?.setVolume(volume);

  player.play(music);

  // ✅ Remove old listener before adding new one
  const oldListener = idleListeners.get(guildId);
  if (oldListener) {
    player.removeListener(AudioPlayerStatus.Idle, oldListener);
  }

  // ✅ Auto-play next song when this one ends
  const newListener = () => {
    if (listeningActive.get(guildId)) {
      playNextInQueue(player, guildId);
    }
  };
  
  idleListeners.set(guildId, newListener);
  player.once(AudioPlayerStatus.Idle, newListener);

  return true;
}

export function stopListening(guildId) {
  console.log(`🛑 [${guildId}] Stopping listener`);
  listeningActive.set(guildId, false);
  
  // Cleanup active stream
  const stream = activeStreams.get(guildId);
  if (stream) {
    try {
      stream.destroy();
    } catch (e) {
      // Stream might already be destroyed
    }
    activeStreams.delete(guildId);
  }

  // Cleanup idle listener
  idleListeners.delete(guildId);
}

export function listen(connection, userId, player, guildId) {
  // ✅ Mark as actively listening
  listeningActive.set(guildId, true);
  
  if (connection.state.status === VoiceConnectionStatus.Destroyed) {
    console.log(`⚠️ [${guildId}] Connection destroyed, stopping listener`);
    stopListening(guildId);
    return;
  }

  if (!listeningActive.get(guildId)) {
    console.log(`⚠️ [${guildId}] Listening disabled, not starting new listener`);
    return;
  }

  const receiver = connection.receiver;

  const opusStream = receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: SILENCE_DURATION
    }
  });

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

    if (!listeningActive.get(guildId)) {
      return;
    }

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

    // ✅ Helper to send message to channel
    async function sendChannelMessage(message) {
      if (discordClient) {
        try {
          const guild = await discordClient.guilds.fetch(guildId);
          const member = await guild.members.fetch(userId);
          const voiceChannel = member.voice.channel;
          
          if (voiceChannel) {
            // Try to send to the voice channel's text channel or any text channel
            const textChannel = guild.channels.cache.find(ch => ch.isTextBased() && ch.permissionsFor(guild.members.me).has('SendMessages'));
            if (textChannel) {
              await textChannel.send(message);
            }
          }
        } catch (error) {
          console.error(`❌ [${guildId}] Failed to send message:`, error.message);
        }
      }
    }

    const intent = parseIntent(text);

    if (intent?.type === "play") {
      const video = await searchYouTube(intent.query);

      if (!video) {
        const notFoundTts = speak("I couldn't find that song");
        player.play(notFoundTts);
        
        // ✅ Wait for TTS to finish before continuing to listen
        player.once(AudioPlayerStatus.Idle, () => {
          if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
            listen(connection, userId, player, guildId);
          }
        });
        return;
      }

      const queue = getQueue(guildId);
      const isQueueEmpty = queue.isEmpty() && player.state.status === AudioPlayerStatus.Idle;

      // Add to queue
      queue.add(video);
      console.log(`➕ [${guildId}] Added to queue:`, video.title, `(${queue.size()} in queue)`);

      if (isQueueEmpty) {
        // Nothing playing, start immediately with announcement
        const ttsResource = speak(`Now playing ${video.title}`);
        player.play(ttsResource);

        // ✅ Remove old listener before adding new one
        const oldListener = idleListeners.get(guildId);
        if (oldListener) {
          player.removeListener(AudioPlayerStatus.Idle, oldListener);
        }

        const newListener = () => {
          if (listeningActive.get(guildId)) {
            playNextInQueue(player, guildId);
          }
        };
        
        idleListeners.set(guildId, newListener);
        player.once(AudioPlayerStatus.Idle, newListener);
      }

      if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
        return listen(connection, userId, player, guildId);
      }
      return;
    }

    if (intent?.type === "skip") {
      const queue = getQueue(guildId);
      
      // ✅ Check if there's something to skip
      if (player.state.status === AudioPlayerStatus.Idle) {
        const ttsResource = speak("Nothing is playing");
        player.play(ttsResource);
        
        player.once(AudioPlayerStatus.Idle, () => {
          if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
            listen(connection, userId, player, guildId);
          }
        });
        return;
      }

      // ✅ Remove the old idle listener to prevent double-triggering
      const oldListener = idleListeners.get(guildId);
      if (oldListener) {
        player.removeListener(AudioPlayerStatus.Idle, oldListener);
        idleListeners.delete(guildId);
      }
      
      // ✅ Stop current song
      player.stop(true);
      
      // ✅ Check what's next in queue
      const nextSong = queue.peek();
      
      if (!nextSong) {
        const ttsResource = speak("Queue is empty");
        player.play(ttsResource);
        
        player.once(AudioPlayerStatus.Idle, () => {
          if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
            listen(connection, userId, player, guildId);
          }
        });
        return;
      }

      // ✅ Announce the next song with its title
      const ttsResource = speak(`Playing next song ${nextSong.title}`);
      player.play(ttsResource);
      
      // ✅ After TTS, play the actual song
      player.once(AudioPlayerStatus.Idle, () => {
        if (listeningActive.get(guildId)) {
          playNextInQueue(player, guildId);
        }
      });

      console.log(`⏭️ [${guildId}] Skipped to next song`);

      if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
        return listen(connection, userId, player, guildId);
      }
      return;
    }

    if (intent?.type === "pause") {
      const queue = getQueue(guildId);
      queue.setPaused(true);
      player.pause();
      
      console.log(`⏸️ [${guildId}] Paused`);

      if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
        return listen(connection, userId, player, guildId);
      }
      return;
    }

    if (intent?.type === "resume") {
      const queue = getQueue(guildId);
      queue.setPaused(false);
      player.unpause();
      
      console.log(`▶️ [${guildId}] Resumed`);

      if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
        return listen(connection, userId, player, guildId);
      }
      return;
    }

    if (intent?.type === "volumeup") {
      const queue = getQueue(guildId);
      const newVol = Math.min(100, queue.getVolume() + 10);
      queue.setVolume(newVol);
      
      // Update current playing volume
      if (player.state.resource?.volume) {
        player.state.resource.volume.setVolume(newVol / 100);
      }

      console.log(`🔊 [${guildId}] Volume: ${newVol}%`);

      if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
        return listen(connection, userId, player, guildId);
      }
      return;
    }

    if (intent?.type === "volumedown") {
      const queue = getQueue(guildId);
      const newVol = Math.max(0, queue.getVolume() - 10);
      queue.setVolume(newVol);
      
      if (player.state.resource?.volume) {
        player.state.resource.volume.setVolume(newVol / 100);
      }

      console.log(`🔉 [${guildId}] Volume: ${newVol}%`);

      if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
        return listen(connection, userId, player, guildId);
      }
      return;
    }

    if (intent?.type === "volume") {
      const queue = getQueue(guildId);
      queue.setVolume(intent.level);
      
      if (player.state.resource?.volume) {
        player.state.resource.volume.setVolume(intent.level / 100);
      }

      console.log(`🔊 [${guildId}] Volume set to: ${intent.level}%`);

      if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
        return listen(connection, userId, player, guildId);
      }
      return;
    }

    if (intent?.type === "queue") {
      const queue = getQueue(guildId);
      const songs = queue.list();
      
      // ✅ Send queue to channel without interrupting music
      if (songs.length === 0) {
        await sendChannelMessage("📋 **Queue is empty!**");
      } else {
        const queueText = songs.slice(0, 10).map((song, i) => 
          `${i + 1}. ${song.title}`
        ).join("\n");
        
        const remaining = songs.length > 10 ? `\n... and ${songs.length - 10} more` : "";
        
        await sendChannelMessage(`📋 **Queue (${songs.length} song${songs.length > 1 ? 's' : ''}):**\n${queueText}${remaining}`);
      }

      // ✅ Continue listening immediately without touching the player
      if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
        return listen(connection, userId, player, guildId);
      }
      return;
    }

    if (intent?.type === "clearqueue") {
      const queue = getQueue(guildId);
      queue.clear();
      
      const ttsResource = speak("Queue cleared");
      player.play(ttsResource);

      player.once(AudioPlayerStatus.Idle, () => {
        if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
          listen(connection, userId, player, guildId);
        }
      });
      return;
    }

    if (intent?.type === "stop") {
      // ✅ Remove idle listener to prevent auto-play
      const oldListener = idleListeners.get(guildId);
      if (oldListener) {
        player.removeListener(AudioPlayerStatus.Idle, oldListener);
        idleListeners.delete(guildId);
      }

      const stream = activeStreams.get(guildId);
      if (stream) {
        try {
          stream.destroy();
        } catch (e) {
          // Stream might already be destroyed
        }
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
        try {
          stream.destroy();
        } catch (e) {
          // Stream might already be destroyed
        }
        activeStreams.delete(guildId);
      }
      player.stop(true);
      stopListening(guildId);
      connection.destroy();
      return;
    }

    if (connection.state.status !== VoiceConnectionStatus.Destroyed && listeningActive.get(guildId)) {
      listen(connection, userId, player, guildId);
    }
  });

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

// Export helper for manual queue operations
export { playNextInQueue, setDiscordClient };