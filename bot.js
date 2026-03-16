const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require('@discordjs/voice');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

// Edge TTS module
const edgeTTS = require('./edge-tts-wrapper');

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('❌ Thiếu DISCORD_TOKEN! Hãy set biến môi trường DISCORD_TOKEN trên Railway.');
  process.exit(1);
}
const PREFIX = '.';

// Voice settings - Edge TTS Vietnamese voice
const VOICE = 'vi-VN-HoaiMyNeural'; // Female Vietnamese voice
// Alternative: 'vi-VN-NamMinhNeural' for male voice

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Map to store connections per guild
const connections = new Map();
const players = new Map();

client.once('ready', () => {
  console.log(`Bot đã online: ${client.user.tag}`);
  console.log(`Prefix: ${PREFIX}`);
  console.log(`Voice: ${VOICE}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // .join - Join voice channel
  if (command === 'join') {
    const voiceChannel = message.member?.voice?.channel;

    if (!voiceChannel) {
      return message.reply('❌ Bạn cần vào kênh thoại trước!');
    }

    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });

      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

      const player = createAudioPlayer();
      connection.subscribe(player);

      connections.set(message.guild.id, connection);
      players.set(message.guild.id, player);

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          connection.destroy();
          connections.delete(message.guild.id);
          players.delete(message.guild.id);
        }
      });

      message.reply(`✅ Đã vào kênh **${voiceChannel.name}**!`);
    } catch (error) {
      console.error('Lỗi khi vào kênh:', error);
      message.reply('❌ Không thể vào kênh thoại. Vui lòng thử lại.');
    }
  }

  // .leave - Leave voice channel
  else if (command === 'leave' || command === 'dc') {
    const connection = connections.get(message.guild.id);
    if (connection) {
      connection.destroy();
      connections.delete(message.guild.id);
      players.delete(message.guild.id);
      message.reply('👋 Đã rời kênh thoại.');
    } else {
      message.reply('❌ Bot chưa ở trong kênh thoại nào.');
    }
  }

  // .v [message] - Text to speech
  else if (command === 'v') {
    const text = args.join(' ');

    if (!text) {
      return message.reply('❌ Vui lòng nhập nội dung cần đọc! Ví dụ: `.v Xin chào`');
    }

    const connection = connections.get(message.guild.id);
    if (!connection) {
      return message.reply('❌ Bot chưa ở trong kênh thoại! Dùng `.join` trước.');
    }

    const player = players.get(message.guild.id);
    if (!player) {
      return message.reply('❌ Có lỗi xảy ra với audio player.');
    }

    try {
      const audioStream = await edgeTTS.synthesize(text, VOICE);
      const resource = createAudioResource(audioStream, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true,
      });

      resource.volume?.setVolume(1);
      player.play(resource);

      player.once(AudioPlayerStatus.Idle, () => {
        // Ready for next
      });

      player.on('error', (error) => {
        console.error('Audio player error:', error);
      });

    } catch (error) {
      console.error('TTS Error:', error);
      message.reply('❌ Lỗi khi tạo giọng nói. Vui lòng thử lại.');
    }
  }

  // .help - Show commands
  else if (command === 'help') {
    const helpText = `
**Danh sách lệnh:**
\`${PREFIX}join\` - Bot vào kênh thoại của bạn
\`${PREFIX}v [nội dung]\` - Bot đọc nội dung bằng giọng nói
\`${PREFIX}leave\` - Bot rời kênh thoại
\`${PREFIX}help\` - Hiển thị danh sách lệnh

**Ví dụ:**
\`${PREFIX}join\`
\`${PREFIX}v Xin chào mọi người!\`
    `.trim();
    message.reply(helpText);
  }
});

client.login(TOKEN).catch((err) => {
  console.error('Lỗi đăng nhập:', err.message);
  process.exit(1);
});
