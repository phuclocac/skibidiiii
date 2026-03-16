const { Client, GatewayIntentBits, WebhookClient, EmbedBuilder, ChannelType } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require('@discordjs/voice');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const OpenAI = require('openai').default;

const edgeTTS = require('./edge-tts-wrapper');

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('❌ Thiếu DISCORD_TOKEN!');
  process.exit(1);
}

// =============================================
// CẤU HÌNH AI (ChatGPT)
// =============================================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : null;

const AI_SYSTEM_PROMPT = `Bạn là một AI assistant thông minh và thân thiện được tích hợp vào Discord.
Hãy trả lời ngắn gọn, rõ ràng và phù hợp với ngữ cảnh chat Discord.
Bạn trả lời bằng cùng ngôn ngữ với người dùng (tiếng Việt hoặc tiếng Anh).`;

const conversationHistory = new Map();
const MAX_HISTORY = 10;

async function getAIResponse(userId, userMessage) {
  if (!openai) return '⚠️ Tính năng AI chưa được cấu hình (thiếu OPENAI_API_KEY).';
  if (!conversationHistory.has(userId)) conversationHistory.set(userId, []);
  const history = conversationHistory.get(userId);
  history.push({ role: 'user', content: userMessage });
  if (history.length > MAX_HISTORY * 2) history.splice(0, 2);
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: AI_SYSTEM_PROMPT }, ...history],
    });
    const reply = response.choices[0]?.message?.content ?? 'Xin lỗi, tôi không thể trả lời lúc này.';
    history.push({ role: 'assistant', content: reply });
    return reply;
  } catch (error) {
    console.error('OpenAI error:', error.message);
    return '⚠️ Lỗi khi kết nối AI. Vui lòng thử lại sau.';
  }
}

// =============================================

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1482999564117213246/NZFML5GXAKLUUQSW0JVUP6TCI5MZINV1RBBFE6G_TWRFX1S_B08WUTE3LWU752AUO';
const PREFIX = '.';
const VOICE = 'vi';

// Webhook client cho log xóa tin nhắn
let webhookClient = null;
if (WEBHOOK_URL) {
  try {
    webhookClient = new WebhookClient({ url: WEBHOOK_URL });
    console.log('✅ Webhook đã kết nối');
  } catch (e) {
    console.warn('⚠️ Webhook URL không hợp lệ:', e.message);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  // Cache tin nhắn để bắt được nội dung khi bị xóa
  makeCache: require('discord.js').Options.cacheWithLimits({
    ...require('discord.js').Options.DefaultMakeCacheSettings,
    MessageManager: 500,
  }),
});

const connections = new Map();
const players = new Map();

client.once('ready', () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  console.log(`Prefix: ${PREFIX}`);
  if (openai) console.log('🤖 AI (ChatGPT) đã sẵn sàng');
  else console.warn('⚠️ AI bị tắt — thêm OPENAI_API_KEY vào biến môi trường');
});

// =============================================
// LOG XÓA TIN NHẮN -> WEBHOOK
// =============================================
client.on('messageDelete', async (message) => {
  if (!webhookClient) return;
  if (message.author?.bot) return;

  try {
    const author = message.author;
    const content = message.content || '*[Không có nội dung hoặc là ảnh/file]*';
    const channel = message.channel;
    const guild = message.guild;
    const deletedAt = new Date();

    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('🗑️ Tin nhắn bị xóa')
      .setThumbnail(author?.displayAvatarURL({ size: 256 }) || null)
      .addFields(
        {
          name: '👤 Người dùng',
          value: author ? `${author.username} (<@${author.id}>)` : '*Không rõ*',
          inline: true,
        },
        {
          name: '🆔 User ID',
          value: author?.id || '*Không rõ*',
          inline: true,
        },
        {
          name: '📢 Kênh',
          value: `<#${channel.id}> (${channel.name})`,
          inline: true,
        },
        {
          name: '🏠 Máy chủ',
          value: guild?.name || '*DM*',
          inline: true,
        },
        {
          name: '📝 Nội dung tin nhắn',
          value: content.length > 1024 ? content.slice(0, 1021) + '...' : content,
          inline: false,
        },
        {
          name: '🕐 Thời gian gửi',
          value: message.createdAt ? `<t:${Math.floor(message.createdAt.getTime() / 1000)}:F>` : '*Không rõ*',
          inline: true,
        },
        {
          name: '🕑 Thời gian xóa',
          value: `<t:${Math.floor(deletedAt.getTime() / 1000)}:F>`,
          inline: true,
        },
        {
          name: '⚠️ IP / Proxy / Host',
          value: '*Discord không cung cấp thông tin IP người dùng vì lý do bảo mật.*',
          inline: false,
        },
      )
      .setFooter({ text: `Message ID: ${message.id}` })
      .setTimestamp();

    // Thêm ảnh đính kèm nếu có
    if (message.attachments?.size > 0) {
      const attachmentList = message.attachments.map(a => `[${a.name}](${a.url})`).join('\n');
      embed.addFields({ name: '📎 Đính kèm', value: attachmentList, inline: false });
    }

    await webhookClient.send({ embeds: [embed] });
  } catch (err) {
    console.error('Lỗi gửi webhook:', err.message);
  }
});

// =============================================
// LỆNH BOT
// =============================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ── AI: trả lời khi @mention hoặc DM ─────────────────────────────
  const isDM = message.channel.type === ChannelType.DM;
  const isMentioned = message.mentions.has(client.user);
  if ((isDM || isMentioned) && !message.content.startsWith(PREFIX)) {
    let userMessage = message.content.replace(`<@${client.user.id}>`, '').trim();
    if (!userMessage) return message.reply('Bạn muốn hỏi gì? Hãy nhập câu hỏi!');
    if ('sendTyping' in message.channel) message.channel.sendTyping();
    const typingInterval = setInterval(() => {
      if ('sendTyping' in message.channel) message.channel.sendTyping();
    }, 5000);
    try {
      const reply = await getAIResponse(message.author.id, userMessage);
      clearInterval(typingInterval);
      if (reply.length > 2000) {
        for (const chunk of reply.match(/[\s\S]{1,2000}/g)) await message.reply(chunk);
      } else {
        await message.reply(reply);
      }
    } catch (err) {
      clearInterval(typingInterval);
      await message.reply('⚠️ Lỗi khi gọi AI.');
    }
    return;
  }

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // .join
  if (command === 'join') {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply('❌ Bạn cần vào kênh thoại trước!');

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
      console.error('Lỗi join:', error);
      message.reply('❌ Không thể vào kênh thoại.');
    }
  }

  // .leave
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

  // .v [nội dung]
  else if (command === 'v') {
    const text = args.join(' ');
    if (!text) return message.reply('❌ Vui lòng nhập nội dung! Ví dụ: `.v Xin chào`');

    const connection = connections.get(message.guild.id);
    if (!connection) return message.reply('❌ Bot chưa ở trong kênh thoại! Dùng `.join` trước.');

    const player = players.get(message.guild.id);
    if (!player) return message.reply('❌ Lỗi audio player.');

    try {
      const audioStream = await edgeTTS.synthesize(text, VOICE);
      const resource = createAudioResource(audioStream, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true,
      });
      resource.volume?.setVolume(1);
      player.play(resource);
      player.on('error', (e) => console.error('Player error:', e));
    } catch (error) {
      console.error('TTS Error:', error);
      message.reply('❌ Lỗi khi tạo giọng nói. Vui lòng thử lại.');
    }
  }

  // .ai [câu hỏi] - Chat với ChatGPT
  else if (command === 'ai') {
    const userMessage = args.join(' ');
    if (!userMessage) return message.reply('❌ Vui lòng nhập câu hỏi! Ví dụ: `.ai Python là gì?`');
    if ('sendTyping' in message.channel) message.channel.sendTyping();
    const typingInterval = setInterval(() => {
      if ('sendTyping' in message.channel) message.channel.sendTyping();
    }, 5000);
    try {
      const reply = await getAIResponse(message.author.id, userMessage);
      clearInterval(typingInterval);
      if (reply.length > 2000) {
        for (const chunk of reply.match(/[\s\S]{1,2000}/g)) await message.reply(chunk);
      } else {
        await message.reply(reply);
      }
    } catch (err) {
      clearInterval(typingInterval);
      message.reply('⚠️ Lỗi khi gọi AI. Vui lòng thử lại.');
    }
  }

  // .aiclear - Xóa lịch sử hội thoại AI
  else if (command === 'aiclear') {
    conversationHistory.delete(message.author.id);
    message.reply('🗑️ Đã xóa lịch sử hội thoại AI của bạn.');
  }

  // .run [tên file] - Chạy file exe/script trên server
  else if (command === 'run') {
    const fileName = args[0];
    if (!fileName) {
      return message.reply('❌ Dùng: `.run [tên file]`\nVí dụ: `.run bot.exe` hoặc `.run script.sh`');
    }

    // Chỉ cho phép chủ server chạy lệnh này
    if (message.author.id !== message.guild.ownerId) {
      return message.reply('❌ Chỉ chủ máy chủ mới có thể dùng lệnh này.');
    }

    const filePath = path.join(process.cwd(), 'executables', fileName);

    if (!fs.existsSync(filePath)) {
      return message.reply(`❌ Không tìm thấy file: \`${fileName}\`\nHãy đặt file vào thư mục \`executables/\` trên server.`);
    }

    message.reply(`⚙️ Đang chạy \`${fileName}\`...`);

    // Cấp quyền thực thi trước
    exec(`chmod +x "${filePath}"`, () => {
      exec(`"${filePath}"`, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          const errMsg = error.message.slice(0, 1900);
          return message.channel.send(`❌ Lỗi khi chạy:\n\`\`\`\n${errMsg}\n\`\`\``);
        }
        const output = (stdout || stderr || '(Không có output)').slice(0, 1900);
        message.channel.send(`✅ Kết quả \`${fileName}\`:\n\`\`\`\n${output}\n\`\`\``);
      });
    });
  }

  // .help
  else if (command === 'help') {
    const helpText = `
**Danh sách lệnh:**
\`${PREFIX}join\` - Bot vào kênh thoại của bạn
\`${PREFIX}v [nội dung]\` - Bot đọc nội dung bằng giọng nói
\`${PREFIX}leave\` - Bot rời kênh thoại
\`${PREFIX}run [file]\` - Chạy file trong thư mục \`executables/\` (chỉ chủ server)
\`${PREFIX}ai [câu hỏi]\` - Chat với ChatGPT
\`${PREFIX}aiclear\` - Xóa lịch sử hội thoại AI của bạn
\`${PREFIX}help\` - Hiển thị danh sách lệnh

**Tính năng AI:**
• Tag bot \`@Bot [câu hỏi]\` để chat với ChatGPT trong server
• Nhắn DM trực tiếp cho bot để chat riêng

**Ví dụ:**
\`${PREFIX}join\`
\`${PREFIX}v Xin chào mọi người!\`
\`${PREFIX}ai Python là gì?\`
\`${PREFIX}run myapp.exe\`
    `.trim();
    message.reply(helpText);
  }
});

client.login(TOKEN).catch((err) => {
  console.error('Lỗi đăng nhập:', err.message);
  process.exit(1);
});
