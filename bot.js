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
  getVoiceConnection
} from "@discordjs/voice";

import { listen, stopListening } from "./voice/listener.js";
import { preloadCommonPhrases } from "./voice/tts.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ⚡ Multi-server support: One player per guild
const players = new Map();

// ⚡ Track who summoned the bot per guild
const summonedBy = new Map();

// ⚡ Track if disconnect was manual (don't auto-reconnect)
const manualDisconnects = new Set();

function getOrCreatePlayer(guildId) {
  if (!players.has(guildId)) {
    const player = createAudioPlayer();
    
    // ✅ Handle player errors to prevent crashes
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
      .setName("disconnect")
      .setDescription("Disconnect and stop listening")
  ];

  const rest = new REST({ version: "10" })
    .setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );

  console.log("🚀 Ok Garmin is online and ready for multiple servers!");
  
  // ⚡ Preload TTS cache for faster responses
  preloadCommonPhrases();
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guild.id;

  if (interaction.commandName === "okgarmin") {
    const vc = interaction.member.voice.channel;

    if (!vc) {
      return interaction.reply({
        content: "❌ You need to be in a voice channel first!",
        flags: 64
      });
    }

    // ✅ Check if bot is already listening in this server
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

    // ✅ Remember who summoned the bot
    summonedBy.set(guildId, interaction.user.id);
    manualDisconnects.delete(guildId);

    // ✅ Handle manual disconnects (kicked from voice)
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.log(`🔌 [${guildId}] Disconnected`);
      
      // Try to reconnect once (in case of network hiccup)
      try {
        await Promise.race([
          new Promise((resolve) => connection.once(VoiceConnectionStatus.Signalling, resolve)),
          new Promise((resolve) => connection.once(VoiceConnectionStatus.Connecting, resolve)),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]);
        // If we get here, reconnection is happening
      } catch {
        // Reconnection failed = manual disconnect
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

    // ⚡ Start listening only to the person who summoned
    setTimeout(() => {
      listen(connection, interaction.user.id, player, guildId);
    }, 500);

    await interaction.reply({
      content: `👂 Listening to your voice commands, <@${interaction.user.id}>!`,
      flags: 64
    });
  }

  if (interaction.commandName === "disconnect") {
    const connection = getVoiceConnection(guildId);
    
    if (!connection) {
      return interaction.reply({
        content: "❌ I'm not in a voice channel!",
        flags: 64
      });
    }

    // ✅ Check if the person disconnecting is the one who summoned
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
    summonedBy.delete(guildId);
    connection.destroy();

    await interaction.reply({
      content: "👋 Disconnected!",
      flags: 64
    });
  }
});

client.login(process.env.DISCORD_TOKEN);