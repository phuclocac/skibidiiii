const { Client, GatewayIntentBits, Partials, WebhookClient, EmbedBuilder, ChannelType } = require('discord.js');
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
// CẤU HÌNH AI
// Ưu tiên: Groq (miễn phí) → OpenAI (trả phí)
// =============================================
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

let openai = null;
let aiProvider = null;

if (GROQ_API_KEY) {
  openai = new OpenAI({
    apiKey: GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  });
  aiProvider = 'Groq (miễn phí)';
} else if (OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  aiProvider = 'OpenAI';
}

const AI_MODEL = GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

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
      model: AI_MODEL,
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

// Webhook 1: log xóa & chỉnh sửa tin nhắn
const WEBHOOK_URL = 'https://discord.com/api/webhooks/1482999564117213246/nZfml5gXAkLuuqS-W0jvUp6tCi-5mZINV1RbbfE6-G_TwRFx1S_b08wuTE3LWu752AUo';
// Webhook 2: log lệnh .al
const AL_WEBHOOK_URL = 'https://discord.com/api/webhooks/1483113899271262290/c5e4h1TjLSfPtNJqMBGPekl0yDsUWD8LzBEb9kZG3LS2_QfgqCV2xYZ6XvNAbs4ygEFZ';
const PREFIX = '.';
const VOICE = 'vi';

// Webhook client cho log xóa / sửa tin nhắn
let webhookClient = null;
try {
  webhookClient = new WebhookClient({ url: WEBHOOK_URL });
  console.log('✅ Webhook 1 (log xóa/sửa) đã khởi tạo');
} catch (e) {
  console.error('❌ Webhook 1 lỗi khởi tạo:', e.message);
}

// Webhook client riêng cho lệnh .al
let alWebhookClient = null;
try {
  alWebhookClient = new WebhookClient({ url: AL_WEBHOOK_URL });
  console.log('✅ Webhook 2 (lệnh .al) đã khởi tạo');
} catch (e) {
  console.error('❌ Webhook 2 lỗi khởi tạo:', e.message);
}

// ID chủ sở hữu — nhận thông báo khi có người nhắn DM cho bot
const OWNER_ID = '1109108708371349504';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
  ],
  // Partials cần thiết để nhận sự kiện DM và tin nhắn bị xóa/sửa
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
  ],
  makeCache: require('discord.js').Options.cacheWithLimits({
    ...require('discord.js').Options.DefaultMakeCacheSettings,
    MessageManager: 500,
  }),
});

const connections = new Map();
const players = new Map();

client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  console.log(`Prefix: ${PREFIX}`);
  if (openai) console.log(`🤖 AI đã sẵn sàng — Provider: ${aiProvider} | Model: ${AI_MODEL}`);
  else console.warn('⚠️ AI bị tắt — thêm GROQ_API_KEY (miễn phí) hoặc OPENAI_API_KEY vào biến môi trường');

  // Kiểm tra webhook 1 khi khởi động
  if (webhookClient) {
    try {
      await webhookClient.send({
        content: `🟢 Bot **${client.user.tag}** đã online — Webhook 1 (log xóa/sửa) hoạt động bình thường.`,
      });
      console.log('✅ Webhook 1 test thành công');
    } catch (e) {
      console.error('❌ Webhook 1 test thất bại:', e.message);
    }
  } else {
    console.error('❌ Webhook 1 chưa được khởi tạo');
  }

  // Kiểm tra webhook 2 khi khởi động
  if (alWebhookClient) {
    try {
      await alWebhookClient.send({
        content: `🟢 Bot **${client.user.tag}** đã online — Webhook 2 (lệnh .al) hoạt động bình thường.`,
      });
      console.log('✅ Webhook 2 test thành công');
    } catch (e) {
      console.error('❌ Webhook 2 test thất bại:', e.message);
    }
  } else {
    console.error('❌ Webhook 2 chưa được khởi tạo');
  }
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
// LOG TIN NHẮN BỊ SỬA -> WEBHOOK
// =============================================
client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!webhookClient) return;
  if (newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;

  try {
    const author = newMessage.author;
    const channel = newMessage.channel;
    const guild = newMessage.guild;
    const editedAt = new Date();

    const oldContent = oldMessage.content || '*[Không có nội dung hoặc không được lưu trong cache]*';
    const newContent = newMessage.content || '*[Không có nội dung]*';

    const embed = new EmbedBuilder()
      .setColor(0xFFA500)
      .setTitle('✏️ Tin nhắn bị sửa')
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
          name: '📝 Nội dung cũ',
          value: oldContent.length > 1024 ? oldContent.slice(0, 1021) + '...' : oldContent,
          inline: false,
        },
        {
          name: '✅ Nội dung mới',
          value: newContent.length > 1024 ? newContent.slice(0, 1021) + '...' : newContent,
          inline: false,
        },
        {
          name: '🕑 Thời gian sửa',
          value: `<t:${Math.floor(editedAt.getTime() / 1000)}:F>`,
          inline: true,
        },
        {
          name: '🔗 Liên kết tin nhắn',
          value: `[Nhấn để xem](${newMessage.url})`,
          inline: true,
        },
      )
      .setFooter({ text: `Message ID: ${newMessage.id}` })
      .setTimestamp();

    await webhookClient.send({ embeds: [embed] });
  } catch (err) {
    console.error('Lỗi gửi webhook sửa tin nhắn:', err.message);
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

  // Thông báo cho chủ khi có người nhắn DM cho bot
  if (isDM && message.author.id !== OWNER_ID) {
    try {
      const owner = await client.users.fetch(OWNER_ID);
      const dmEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📩 Có người nhắn DM cho bot')
        .setThumbnail(message.author.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: '👤 Tên', value: message.author.username, inline: true },
          { name: '🆔 ID', value: message.author.id, inline: true },
          { name: '🏷️ Tag', value: `<@${message.author.id}>`, inline: true },
          { name: '📝 Nội dung', value: message.content || '*[Không có nội dung]*', inline: false },
          { name: '🕐 Thời gian', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
        )
        .setFooter({ text: `User ID: ${message.author.id}` })
        .setTimestamp();

      // Thêm ảnh đính kèm nếu có
      if (message.attachments?.size > 0) {
        const list = message.attachments.map(a => `[${a.name}](${a.url})`).join('\n');
        dmEmbed.addFields({ name: '📎 Đính kèm', value: list, inline: false });
      }

      await owner.send({ embeds: [dmEmbed] });
    } catch (e) {
      console.error('Lỗi gửi thông báo DM cho chủ:', e.message);
    }
  }

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
      if (err.status === 429 || err.message?.includes('429')) {
        return message.reply('❌ **Tài khoản OpenAI hết quota!** Vào https://platform.openai.com/account/billing để nạp tiền.');
      }
      message.reply('⚠️ Lỗi khi gọi AI. Vui lòng thử lại.');
    }
  }

  // .aiclear - Xóa lịch sử hội thoại AI
  else if (command === 'aiclear') {
    conversationHistory.delete(message.author.id);
    message.reply('🗑️ Đã xóa lịch sử hội thoại AI của bạn.');
  }

  // .tóm tắt - Tóm tắt 50 tin nhắn gần nhất trong kênh
  else if (
    (command === 'tóm' && args[0]?.toLowerCase() === 'tắt') ||
    command === 'tómtắt'
  ) {
    if (!openai) return message.reply('⚠️ Tính năng AI chưa được cấu hình (thiếu OPENAI_API_KEY).');
    if (isDM) return message.reply('❌ Lệnh này chỉ dùng được trong server.');

    try {
      await message.reply('⏳ Đang tóm tắt 50 tin nhắn gần nhất...');

      // Fetch 50 tin nhắn, bao gồm cả tin nhắn vừa reply
      let fetched;
      try {
        fetched = await message.channel.messages.fetch({ limit: 50 });
      } catch (fetchErr) {
        console.error('Lỗi fetch messages:', fetchErr);
        return message.channel.send(`⚠️ Không thể đọc lịch sử tin nhắn: ${fetchErr.message}`);
      }

      const sorted = [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      // Bao gồm cả tin nhắn bot trừ tin nhắn hệ thống, giữ context đầy đủ
      const conversation = sorted
        .filter(m => m.content && m.content.trim())
        .map(m => `[${m.author.bot ? '🤖' : ''}${m.author.username}]: ${m.content}`)
        .join('\n');

      if (!conversation.trim()) {
        return message.channel.send('❌ Không có tin nhắn nào để tóm tắt.');
      }

      // Cắt bớt nếu quá dài (giới hạn ~3000 ký tự để tránh vượt token)
      const truncated = conversation.length > 3000 ? conversation.slice(-3000) : conversation;

      if ('sendTyping' in message.channel) message.channel.sendTyping();

      let response;
      try {
        response = await openai.chat.completions.create({
          model: AI_MODEL,
          messages: [
            { role: 'system', content: 'Bạn là AI tóm tắt nội dung cuộc trò chuyện Discord. Hãy tóm tắt ngắn gọn, dễ hiểu bằng tiếng Việt.' },
            { role: 'user', content: `Tóm tắt cuộc trò chuyện này:\n\n${truncated}` },
          ],
          max_tokens: 800,
        });
      } catch (aiErr) {
        console.error('Lỗi OpenAI:', aiErr);
        if (aiErr.status === 429 || aiErr.message?.includes('429')) {
          return message.channel.send(
            '❌ **Hết quota AI!**\n' +
            '> Dùng **Groq miễn phí**: đăng ký tại https://console.groq.com → lấy API key → thêm vào Railway với tên `GROQ_API_KEY`\n' +
            '> Hoặc nạp tiền OpenAI tại https://platform.openai.com/account/billing'
          );
        }
        return message.channel.send(`⚠️ Lỗi kết nối AI: ${aiErr.message}`);
      }

      const summary = response.choices[0]?.message?.content ?? 'Không thể tóm tắt.';
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📋 Tóm tắt 50 tin nhắn gần nhất')
        .setDescription(summary.length > 4096 ? summary.slice(0, 4093) + '...' : summary)
        .setFooter({ text: `Kênh: #${message.channel.name} • ${sorted.length} tin nhắn` })
        .setTimestamp();

      await message.channel.send({ embeds: [embed] });
    } catch (err) {
      console.error('Lỗi tóm tắt (unexpected):', err);
      message.channel.send(`⚠️ Lỗi không xác định: ${err.message}`);
    }
  }

  // .run [tên file] - Chạy file exe/script trên server
  else if (command === 'run') {
    const fileName = args[0];
    if (!fileName) {
      return message.reply('❌ Dùng: `.run [tên file]`\nVí dụ: `.run bot.exe` hoặc `.run script.sh`');
    }

    if (message.author.id !== message.guild.ownerId) {
      return message.reply('❌ Chỉ chủ máy chủ mới có thể dùng lệnh này.');
    }

    const filePath = path.join(process.cwd(), 'executables', fileName);

    if (!fs.existsSync(filePath)) {
      return message.reply(`❌ Không tìm thấy file: \`${fileName}\`\nHãy đặt file vào thư mục \`executables/\` trên server.`);
    }

    message.reply(`⚙️ Đang chạy \`${fileName}\`...`);

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

  // =============================================
  // .al [tin nhắn] id [id người dùng]  — LỆNH ẨN, CHỈ ADMIN
  // =============================================
  else if (command === 'al') {
    // Kiểm tra quyền admin
    if (!message.member?.permissions.has('Administrator')) {
      return;
    }

    const fullText = args.join(' ');

    // Tách tin nhắn và ID: "nội dung id <id>"
    const idSeparator = / id /i;
    const separatorMatch = fullText.match(/ id /i);
    if (!separatorMatch) {
      return message.reply('❌ Cú pháp: `.al [tin nhắn] id [user_id hoặc all]`');
    }

    const separatorIndex = fullText.indexOf(separatorMatch[0]);
    const msgContent = fullText.slice(0, separatorIndex).trim();
    const targetId = fullText.slice(separatorIndex + separatorMatch[0].length).trim();

    if (!msgContent) return message.reply('❌ Tin nhắn không được để trống.');
    if (!targetId) return message.reply('❌ Thiếu ID người dùng hoặc `all`.');

    // Xóa lệnh để tránh lộ
    await message.delete().catch(() => {});

    const reportLines = [];
    const sentAt = new Date();

    if (targetId.toLowerCase() === 'all') {
      // Gửi cho toàn bộ thành viên
      let members;
      try {
        members = await message.guild.members.fetch();
      } catch (err) {
        console.error('Lỗi fetch members:', err.message);
        return;
      }

      const humanMembers = members.filter(m => !m.user.bot);
      let successCount = 0;
      let failCount = 0;

      for (const [, member] of humanMembers) {
        try {
          await member.send(`<@${member.user.id}> ${msgContent}`);
          successCount++;
          reportLines.push(`✅ ${member.user.username} (${member.user.id})`);
        } catch {
          failCount++;
          reportLines.push(`❌ ${member.user.username} (${member.user.id}) — không gửi được DM`);
        }
        // Tránh rate limit
        await new Promise(r => setTimeout(r, 500));
      }

      // Báo cáo lên webhook
      if (alWebhookClient) {
        const chunkSize = 15;
        for (let i = 0; i < reportLines.length; i += chunkSize) {
          const chunk = reportLines.slice(i, i + chunkSize);
          const embed = new EmbedBuilder()
            .setColor(0x00B0F4)
            .setTitle('📨 Báo cáo lệnh .al (Gửi tất cả)')
            .addFields(
              { name: '👤 Admin thực hiện', value: `${message.author.username} (<@${message.author.id}>)`, inline: true },
              { name: '🏠 Server', value: message.guild.name, inline: true },
              { name: '📝 Nội dung gửi', value: msgContent.length > 1024 ? msgContent.slice(0, 1021) + '...' : msgContent, inline: false },
              { name: `📊 Kết quả (${i + 1}–${Math.min(i + chunkSize, reportLines.length)}/${reportLines.length})`, value: chunk.join('\n') || '*Không có*', inline: false },
            )
            .setFooter({ text: `Thành công: ${successCount} | Thất bại: ${failCount}` })
            .setTimestamp(sentAt);
          await alWebhookClient.send({ embeds: [embed] }).catch(e => console.error('AL webhook error:', e.message));
        }
      }

    } else {
      // Gửi cho 1 người dùng cụ thể
      let targetMember;
      try {
        targetMember = await message.guild.members.fetch(targetId);
      } catch {
        if (alWebhookClient) {
          const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Lệnh .al — Không tìm thấy người dùng')
            .addFields(
              { name: '👤 Admin thực hiện', value: `${message.author.username} (<@${message.author.id}>)`, inline: true },
              { name: '🏠 Server', value: message.guild.name, inline: true },
              { name: '🆔 ID mục tiêu', value: targetId, inline: true },
              { name: '📝 Nội dung', value: msgContent, inline: false },
              { name: '⚠️ Lỗi', value: 'Không tìm thấy thành viên với ID này.', inline: false },
            )
            .setTimestamp(sentAt);
          await alWebhookClient.send({ embeds: [embed] }).catch(e => console.error('AL webhook error:', e.message));
        }
        return;
      }

      let status = '✅ Đã gửi';
      try {
        await targetMember.send(`<@${targetMember.user.id}> ${msgContent}`);
      } catch {
        status = '❌ Không gửi được DM (người dùng có thể đã tắt DM)';
      }

      if (alWebhookClient) {
        const embed = new EmbedBuilder()
          .setColor(status.startsWith('✅') ? 0x57F287 : 0xFF0000)
          .setTitle('📨 Báo cáo lệnh .al (Gửi cá nhân)')
          .addFields(
            { name: '👤 Admin thực hiện', value: `${message.author.username} (<@${message.author.id}>)`, inline: true },
            { name: '🏠 Server', value: message.guild.name, inline: true },
            { name: '🎯 Người nhận', value: `${targetMember.user.username} (<@${targetMember.user.id}>)`, inline: true },
            { name: '🆔 User ID', value: targetId, inline: true },
            { name: '📝 Nội dung gửi', value: msgContent.length > 1024 ? msgContent.slice(0, 1021) + '...' : msgContent, inline: false },
            { name: '📊 Kết quả', value: status, inline: false },
          )
          .setTimestamp(sentAt);
        await alWebhookClient.send({ embeds: [embed] }).catch(e => console.error('AL webhook error:', e.message));
      }
    }
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
\`${PREFIX}tóm tắt\` - Tóm tắt 50 tin nhắn gần nhất trong kênh
\`${PREFIX}help\` - Hiển thị danh sách lệnh

**Tính năng AI:**
• Tag bot \`@Bot [câu hỏi]\` để chat với ChatGPT trong server
• Nhắn DM trực tiếp cho bot để chat riêng

**Ví dụ:**
\`${PREFIX}join\`
\`${PREFIX}v Xin chào mọi người!\`
\`${PREFIX}ai Python là gì?\`
\`${PREFIX}run myapp.exe\`
\`${PREFIX}tóm tắt\`
    `.trim();
    message.reply(helpText);
  }
});

client.login(TOKEN).catch((err) => {
  console.error('Lỗi đăng nhập:', err.message);
  process.exit(1);
});
