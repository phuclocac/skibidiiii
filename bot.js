const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const axios = require('axios');

// Cấu hình
const PREFIX = '.';
const TOKEN = process.env.DISCORD_TOKEN;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const VOICE = 'vi-VN-HoaiMyNeural';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

let currentConnection = null;
let player = createAudioPlayer();

// Hàm gọi DeepSeek API
async function askDeepSeek(question) {
    try {
        const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: 'Bạn là trợ lý AI thông minh, trả lời bằng tiếng Việt.' },
                { role: 'user', content: question }
            ],
            temperature: 0.7,
            max_tokens: 2000
        }, {
            headers: {
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Lỗi DeepSeek:', error.response?.data || error.message);
        return '❌ Xin lỗi, tao đang gặp sự cố. Thử lại sau nhé!';
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // XỬ LÝ KHI BỊ TAG
    if (message.mentions.has(client.user)) {
        const userQuery = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();

        if (!userQuery) {
            return message.reply('👋 Có tao đây! Bạn muốn hỏi gì? Hãy nhập câu hỏi sau khi tag nhé.');
        }

        await message.channel.sendTyping();
        const answer = await askDeepSeek(userQuery);

        if (answer.length > 2000) {
            const chunks = answer.match(/[\s\S]{1,1900}/g) || [];
            for (const chunk of chunks) {
                await message.reply(chunk);
            }
        } else {
            await message.reply(answer);
        }
        return;
    }

    // XỬ LÝ LỆNH CÓ DẤU .
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Lệnh .join
    if (command === 'join') {
        const voiceChannel = message.member?.voice.channel;
        if (!voiceChannel) {
            return message.reply('❌ Bạn phải ở trong kênh thoại trước đã!');
        }

        try {
            currentConnection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });
            currentConnection.subscribe(player);
            message.reply(`✅ Đã vào kênh **${voiceChannel.name}**`);
        } catch (error) {
            console.error(error);
            message.reply('❌ Không thể vào kênh thoại.');
        }
    }

    // Lệnh .v
    else if (command === 'v') {
        const text = args.join(' ');
        if (!text) {
            return message.reply('❌ Vui lòng nhập nội dung cần đọc! Ví dụ: `.v Xin chào`');
        }

        if (!currentConnection) {
            return message.reply('❌ Bot chưa ở trong kênh thoại. Dùng `.join` trước.');
        }

        try {
            const edgeTTS = require('./edge-tts-wrapper');
            const audioBuffer = await edgeTTS.synthesize(text, VOICE);
            const resource = createAudioResource(audioBuffer, {
                inputType: 'buffer'
            });
            player.play(resource);
            message.reply(`🗣️ Đang đọc: "${text}"`);
        } catch (error) {
            console.error(error);
            message.reply('❌ Có lỗi khi đọc văn bản.');
        }
    }

    // Lệnh .leave
    else if (command === 'leave') {
        if (currentConnection) {
            currentConnection.destroy();
            currentConnection = null;
            message.reply('👋 Đã rời kênh thoại.');
        } else {
            message.reply('❌ Bot không ở trong kênh thoại nào.');
        }
    }

    // Lệnh .ask
    else if (command === 'ask') {
        const question = args.join(' ');
        if (!question) {
            return message.reply('❌ Vui lòng nhập câu hỏi! Ví dụ: `.ask Xin chào`');
        }

        await message.channel.sendTyping();
        const answer = await askDeepSeek(question);

        if (answer.length > 2000) {
            const chunks = answer.match(/[\s\S]{1,1900}/g) || [];
            for (const chunk of chunks) {
                await message.reply(chunk);
            }
        } else {
            await message.reply(answer);
        }
    }

    // Lệnh .help
    else if (command === 'help') {
        const helpMessage = `
**Danh sách lệnh:**
\`.join\` - Bot vào kênh thoại
\`.v [nội dung]\` - Bot đọc nội dung
\`.leave\` - Bot rời kênh thoại
\`.ask [câu hỏi]\` - Hỏi AI DeepSeek
\`.help\` - Hiển thị lệnh này

**Hoặc tag bot + câu hỏi:**
@Skibididi 1+1 bằng mấy?
`;
        message.reply(helpMessage);
    }
});

player.on('error', error => {
    console.error('Lỗi player:', error);
});

client.once('ready', () => {
    console.log(`✅ Bot ${client.user.tag} đã sẵn sàng!`);
});

client.login(TOKEN);
