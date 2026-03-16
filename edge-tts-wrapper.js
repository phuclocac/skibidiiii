const googleTTS = require('google-tts-api');
const https = require('https');
const http = require('http');
const { Readable } = require('stream');

async function fetchAudio(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://translate.google.com/',
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const readable = new Readable();
        readable.push(buffer);
        readable.push(null);
        resolve(readable);
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function synthesize(text, voice = 'vi-VN-HoaiMyNeural') {
  // Use Vietnamese language for Google TTS
  const lang = 'vi';

  // Google TTS has 200 char limit per request, handle long text
  if (text.length <= 200) {
    const url = googleTTS.getAudioUrl(text, {
      lang: lang,
      slow: false,
      host: 'https://translate.google.com',
    });
    return await fetchAudio(url);
  } else {
    // For long text, get multiple URLs and concatenate
    const urls = googleTTS.getAllAudioUrls(text, {
      lang: lang,
      slow: false,
      host: 'https://translate.google.com',
      splitPunct: ',.!?',
    });

    const buffers = [];
    for (const item of urls) {
      const stream = await fetchAudio(item.url);
      const chunks = [];
      await new Promise((resolve, reject) => {
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      buffers.push(Buffer.concat(chunks));
    }

    const combined = Buffer.concat(buffers);
    const readable = new Readable();
    readable.push(combined);
    readable.push(null);
    return readable;
  }
}

module.exports = { synthesize };
