# Discord TTS Bot

Bot Discord với chức năng Text-to-Speech dùng giọng tiếng Việt (Edge TTS của Microsoft).

## Cài đặt

### Yêu cầu
- Node.js v18+ 
- ffmpeg (phải cài trên máy hoặc VPS)

### Bước 1: Cài ffmpeg

**Ubuntu/Debian:**
```bash
sudo apt-get install ffmpeg
```

**CentOS/RHEL:**
```bash
sudo yum install ffmpeg
```

**Windows:**
Download từ https://ffmpeg.org/download.html và thêm vào PATH.

### Bước 2: Cài packages

```bash
npm install
```

Nếu gặp lỗi với `@discordjs/opus`, chạy:
```bash
npm install --ignore-scripts
```

### Bước 3: Cấu hình token

Chỉnh sửa file `bot.js`, tìm dòng:
```js
const TOKEN = process.env.DISCORD_TOKEN || 'TOKEN_CỦA_BẠN';
```

Hoặc tạo file `.env`:
```
DISCORD_TOKEN=your_token_here
```

### Bước 4: Chạy bot

```bash
npm start
# hoặc
node bot.js
```

## Lệnh

| Lệnh | Mô tả |
|------|-------|
| `.join` | Bot vào kênh thoại của bạn |
| `.v [nội dung]` | Bot đọc nội dung bằng giọng nói |
| `.leave` | Bot rời kênh thoại |
| `.help` | Hiển thị danh sách lệnh |

## Ví dụ sử dụng

```
.join
.v Xin chào mọi người!
.v Hôm nay trời đẹp quá
.leave
```

## Giọng nói

Bot sử dụng giọng **vi-VN-HoaiMyNeural** (nữ, tiếng Việt) từ Microsoft Edge TTS.

Để đổi sang giọng nam, chỉnh trong `bot.js`:
```js
const VOICE = 'vi-VN-NamMinhNeural';
```

## Host trên VPS

```bash
# Cài pm2 để chạy nền
npm install -g pm2

# Chạy bot
pm2 start bot.js --name discord-tts-bot

# Tự khởi động lại khi reboot
pm2 startup
pm2 save
```

## Quyền cần thiết cho Bot

Khi tạo bot trên Discord Developer Portal, cần bật:
- `Message Content Intent`
- `Server Members Intent` 
- `Presence Intent`

Permissions cần:
- Read Messages/View Channels
- Send Messages
- Connect (Voice)
- Speak (Voice)
- Use Voice Activity
