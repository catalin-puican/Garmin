import "dotenv/config";


import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";

import {
  joinVoiceChannel,
  createAudioPlayer,
  VoiceConnectionStatus,
  getVoiceConnection,
  AudioPlayerStatus
} from "@discordjs/voice";

import { listen, stopListening, playNextInQueue, setDiscordClient } from "./voice/listener.js";
import { preloadCommonPhrases } from "./voice/tts.js";
import { getQueue, clearQueue } from "./music/queue.js";
import { searchYouTube } from "./music/search.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages
  ]
});

const players = new Map();
const summonedBy = new Map();
const manualDisconnects = new Set();

function getOrCreatePlayer(guildId) {
  if (!players.has(guildId)) {
    const player = createAudioPlayer();
    
    player.on("error", error => {
      console.error(`❌ [${guildId}] Player error:`, error.message);
    });
    
    players.set(guildId, player);
  }
  return players.get(guildId);
}

client.once(Events.ClientReady, async () => {
  const commands = [
    new SlashCommandBuilder()
      .setName("okgarmin")
      .setDescription("Start listening to your voice commands"),
    
    new SlashCommandBuilder()
      .setName("okgarmindisconnect")
      .setDescription("Disconnect and stop listening"),
    
    new SlashCommandBuilder()
      .setName("okgarminplay")
      .setDescription("Add a song to the queue")
      .addStringOption(option =>
        option.setName("song")
          .setDescription("Song name or URL")
          .setRequired(true)
      ),
    
    new SlashCommandBuilder()
      .setName("okgarminskip")
      .setDescription("Skip to the next song in queue"),
    
    new SlashCommandBuilder()
      .setName("okgarminpause")
      .setDescription("Pause the current song"),
    
    new SlashCommandBuilder()
      .setName("okgarminresume")
      .setDescription("Resume the paused song"),
    
    new SlashCommandBuilder()
      .setName("okgarminqueue")
      .setDescription("Show the current queue"),
    
    new SlashCommandBuilder()
      .setName("okgarminclearqueue")
      .setDescription("Clear all songs from the queue"),
    
    new SlashCommandBuilder()
      .setName("okgarminvolume")
      .setDescription("Set the volume (0-100)")
      .addIntegerOption(option =>
        option.setName("level")
          .setDescription("Volume level (0-100)")
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(100)
      ),
    
    new SlashCommandBuilder()
      .setName("okgarminstop")
      .setDescription("Stop playing music (keeps queue)")
  ];

  const rest = new REST({ version: "10" })
    .setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );

  // ✅ Pass Discord client to listener for DM functionality
  setDiscordClient(client);

  console.log("🚀 Ok Garmin is online with full queue & volume support!");
  console.log("📋 Available commands:");
  console.log("   /okgarmin - Start listening");
  console.log("   /okgarminplay [song] - Add to queue");
  console.log("   /okgarminskip - Skip song");
  console.log("   /okgarminpause - Pause");
  console.log("   /okgarminresume - Resume");
  console.log("   /okgarminqueue - Show queue");
  console.log("   /okgarminclearqueue - Clear queue");
  console.log("   /okgarminvolume [0-100] - Set volume");
  console.log("   /okgarminstop - Stop music");
  console.log("   /okgarmindisconnect - Disconnect");
  
  preloadCommonPhrases();
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guild.id;

  // ========== /okgarmin ==========
  if (interaction.commandName === "okgarmin") {
    const vc = interaction.member.voice.channel;

    if (!vc) {
      return interaction.reply({
        content: "❌ You need to be in a voice channel first!",
        flags: 64
      });
    }

    const existingConnection = getVoiceConnection(guildId);
    if (existingConnection && summonedBy.has(guildId)) {
      return interaction.reply({
        content: `⚠️ Already listening to <@${summonedBy.get(guildId)}>! They need to disconnect first.`,
        flags: 64
      });
    }

    const connection = joinVoiceChannel({
      channelId: vc.id,
      guildId: guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
      debug: false
    });

    const player = getOrCreatePlayer(guildId);
    connection.subscribe(player);

    summonedBy.set(guildId, interaction.user.id);
    manualDisconnects.delete(guildId);

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.log(`🔌 [${guildId}] Disconnected`);
      
      try {
        await Promise.race([
          new Promise((resolve) => connection.once(VoiceConnectionStatus.Signalling, resolve)),
          new Promise((resolve) => connection.once(VoiceConnectionStatus.Connecting, resolve)),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]);
      } catch {
        console.log(`👋 [${guildId}] Manual disconnect detected, staying out`);
        manualDisconnects.add(guildId);
        stopListening(guildId);
        summonedBy.delete(guildId);
        connection.destroy();
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      console.log(`💥 [${guildId}] Connection destroyed`);
      stopListening(guildId);
      summonedBy.delete(guildId);
    });

    setTimeout(() => {
      listen(connection, interaction.user.id, player, guildId);
    }, 500);

    // ✅ Send command list via DM
    try {
      const commandHelp = `👂 **Ok Garmin is now listening to your voice!**

🎵 **Voice Commands:**
• "ok garmin play [song name]" - Add song to queue
• "ok garmin skip" - Skip to next song
• "ok garmin pause" - Pause current song
• "ok garmin resume" - Resume playback
• "ok garmin stop" - Stop music (keeps queue)
• "ok garmin what's next" - Show queue
• "ok garmin clear queue" - Clear all songs
• "ok garmin volume up/down" - Adjust volume
• "ok garmin volume [0-100]" - Set specific volume
• "ok garmin disconnect" - Leave voice channel

💡 **Tips:**
- Queue messages will be sent to your DMs
- Only you can control the bot while it's active
- Music keeps playing while checking queue`;

      await interaction.user.send(commandHelp);
      
      await interaction.reply({
        content: `👂 Listening to your voice commands! Check your DMs for the command list.`,
        flags: 64
      });
    } catch (error) {
      console.error("Failed to send DM:", error.message);
      await interaction.reply({
        content: `👂 Listening to your voice commands, <@${interaction.user.id}>!\nTry: "ok garmin play [song name]"`,
        flags: 64
      });
    }
  }

  // ========== /okgarmindisconnect ==========
  if (interaction.commandName === "okgarmindisconnect") {
    const connection = getVoiceConnection(guildId);
    
    if (!connection) {
      return interaction.reply({
        content: "❌ I'm not in a voice channel!",
        flags: 64
      });
    }

    const summonerId = summonedBy.get(guildId);
    if (summonerId && summonerId !== interaction.user.id) {
      return interaction.reply({
        content: `⚠️ Only <@${summonerId}> can disconnect me!`,
        flags: 64
      });
    }

    const player = players.get(guildId);
    if (player) {
      player.stop(true);
    }
    
    manualDisconnects.add(guildId);
    stopListening(guildId);
    clearQueue(guildId);
    summonedBy.delete(guildId);
    connection.destroy();

    await interaction.reply({
      content: "👋 Disconnected and cleared queue!",
      flags: 64
    });
  }

  // ========== /okgarminplay ==========
  if (interaction.commandName === "okgarminplay") {
    const connection = getVoiceConnection(guildId);
    
    if (!connection) {
      return interaction.reply({
        content: "❌ I'm not in a voice channel! Use `/okgarmin` first.",
        flags: 64
      });
    }

    const summonerId = summonedBy.get(guildId);
    if (summonerId && summonerId !== interaction.user.id) {
      return interaction.reply({
        content: `⚠️ Only <@${summonerId}> can control the music!`,
        flags: 64
      });
    }

    const songQuery = interaction.options.getString("song");
    
    await interaction.deferReply({ flags: 64 });

    const video = await searchYouTube(songQuery);

    if (!video) {
      return interaction.editReply({
        content: "❌ Couldn't find that song!"
      });
    }

    const queue = getQueue(guildId);
    const player = getOrCreatePlayer(guildId);
    const isQueueEmpty = queue.isEmpty() && player.state.status === AudioPlayerStatus.Idle;

    queue.add(video);
    console.log(`➕ [${guildId}] Added:`, video.title);

    if (isQueueEmpty) {
      await interaction.editReply({
        content: `▶️ Now playing: **${video.title}**`
      });
      playNextInQueue(player, guildId);
    } else {
      const position = queue.size();
      await interaction.editReply({
        content: `➕ Added to queue (position ${position}): **${video.title}**`
      });
    }
  }

  // ========== /okgarminskip ==========
  if (interaction.commandName === "okgarminskip") {
    const connection = getVoiceConnection(guildId);
    
    if (!connection) {
      return interaction.reply({
        content: "❌ I'm not in a voice channel!",
        flags: 64
      });
    }

    const summonerId = summonedBy.get(guildId);
    if (summonerId && summonerId !== interaction.user.id) {
      return interaction.reply({
        content: `⚠️ Only <@${summonerId}> can control the music!`,
        flags: 64
      });
    }

    const player = players.get(guildId);
    const queue = getQueue(guildId);

    player.stop(true);

    if (playNextInQueue(player, guildId)) {
      await interaction.reply({
        content: "⏭️ Skipped to next song!",
        flags: 64
      });
    } else {
      await interaction.reply({
        content: "⏭️ Skipped! Queue is empty.",
        flags: 64
      });
    }
  }

  // ========== /okgarminpause ==========
  if (interaction.commandName === "okgarminpause") {
    const player = players.get(guildId);
    
    if (!player) {
      return interaction.reply({
        content: "❌ Nothing is playing!",
        flags: 64
      });
    }

    const summonerId = summonedBy.get(guildId);
    if (summonerId && summonerId !== interaction.user.id) {
      return interaction.reply({
        content: `⚠️ Only <@${summonerId}> can control the music!`,
        flags: 64
      });
    }

    const queue = getQueue(guildId);
    queue.setPaused(true);
    player.pause();

    await interaction.reply({
      content: "⏸️ Paused!",
      flags: 64
    });
  }

  // ========== /okgarminresume ==========
  if (interaction.commandName === "okgarminresume") {
    const player = players.get(guildId);
    
    if (!player) {
      return interaction.reply({
        content: "❌ Nothing is paused!",
        flags: 64
      });
    }

    const summonerId = summonedBy.get(guildId);
    if (summonerId && summonerId !== interaction.user.id) {
      return interaction.reply({
        content: `⚠️ Only <@${summonerId}> can control the music!`,
        flags: 64
      });
    }

    const queue = getQueue(guildId);
    queue.setPaused(false);
    player.unpause();

    await interaction.reply({
      content: "▶️ Resumed!",
      flags: 64
    });
  }

  // ========== /okgarminqueue ==========
  if (interaction.commandName === "okgarminqueue") {
    const queue = getQueue(guildId);
    const songs = queue.list();
    
    if (songs.length === 0) {
      return interaction.reply({
        content: "🔭 Queue is empty!",
        flags: 64
      });
    }

    const queueText = songs.slice(0, 10).map((song, i) => 
      `${i + 1}. ${song.title}`
    ).join("\n");

    const remaining = songs.length > 10 ? `\n... and ${songs.length - 10} more` : "";

    await interaction.reply({
      content: `📋 **Queue (${songs.length} song${songs.length > 1 ? 's' : ''}):**\n${queueText}${remaining}`,
      flags: 64
    });
  }

  // ========== /okgarminclearqueue ==========
  if (interaction.commandName === "okgarminclearqueue") {
    const summonerId = summonedBy.get(guildId);
    if (summonerId && summonerId !== interaction.user.id) {
      return interaction.reply({
        content: `⚠️ Only <@${summonerId}> can control the queue!`,
        flags: 64
      });
    }

    const queue = getQueue(guildId);
    queue.clear();

    await interaction.reply({
      content: "🗑️ Queue cleared!",
      flags: 64
    });
  }

  // ========== /okgarminvolume ==========
  if (interaction.commandName === "okgarminvolume") {
    const summonerId = summonedBy.get(guildId);
    if (summonerId && summonerId !== interaction.user.id) {
      return interaction.reply({
        content: `⚠️ Only <@${summonerId}> can control the volume!`,
        flags: 64
      });
    }

    const level = interaction.options.getInteger("level");
    const queue = getQueue(guildId);
    queue.setVolume(level);

    const player = players.get(guildId);
    if (player?.state.resource?.volume) {
      player.state.resource.volume.setVolume(level / 100);
    }

    await interaction.reply({
      content: `🔊 Volume set to ${level}%`,
      flags: 64
    });
  }

  // ========== /okgarminstop ==========
  if (interaction.commandName === "okgarminstop") {
    const summonerId = summonedBy.get(guildId);
    if (summonerId && summonerId !== interaction.user.id) {
      return interaction.reply({
        content: `⚠️ Only <@${summonerId}> can control the music!`,
        flags: 64
      });
    }

    const player = players.get(guildId);
    if (player) {
      player.stop(true);
    }

    await interaction.reply({
      content: "⏹️ Stopped! (Queue preserved)",
      flags: 64
    });
  }
});

client.login(process.env.DISCORD_TOKEN);