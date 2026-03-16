const { Readable } = require('stream');
const https = require('https');
const crypto = require('crypto');

// Edge TTS WebSocket-based implementation
// Uses Microsoft Edge's TTS service directly

const EDGE_TTS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

function getSSML(text, voice, rate = '+0%', pitch = '+0Hz', volume = '+0%') {
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>
    <voice name='${voice}'>
      <prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>
        ${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
      </prosody>
    </voice>
  </speak>`;
}

function generateXRequestId() {
  return crypto.randomBytes(16).toString('hex');
}

function getTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', 'T').split('.')[0] + 'Z';
}

async function synthesize(text, voice = 'vi-VN-HoaiMyNeural') {
  return new Promise((resolve, reject) => {
    try {
      const WebSocket = require('ws');

      const requestId = generateXRequestId();
      const url = `${EDGE_TTS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${generateXRequestId()}`;

      const ws = new WebSocket(url, {
        headers: {
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
          'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36 Edg/91.0.864.41',
        },
      });

      const audioChunks = [];
      let audioStarted = false;

      ws.on('open', () => {
        // Send configuration
        ws.send(
          `X-Timestamp:${getTimestamp()}\r\n` +
          `Content-Type:application/json; charset=utf-8\r\n` +
          `Path:speech.config\r\n\r\n` +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: {
                    sentenceBoundaryEnabled: false,
                    wordBoundaryEnabled: false,
                  },
                  outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
                },
              },
            },
          })
        );

        // Send SSML request
        const ssml = getSSML(text, voice);
        ws.send(
          `X-RequestId:${requestId}\r\n` +
          `Content-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${getTimestamp()}\r\n` +
          `Path:ssml\r\n\r\n` +
          ssml
        );
      });

      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          // Binary data = audio
          const headerEnd = data.indexOf('\r\n\r\n') !== -1 ? data.indexOf('\r\n\r\n') + 4 : 0;
          // Find the audio data after the header
          const headerStr = data.slice(0, 2).toString('hex');
          const headerLen = data.readUInt16BE(0);
          const audioData = data.slice(2 + headerLen);
          if (audioData.length > 0) {
            audioChunks.push(audioData);
            audioStarted = true;
          }
        } else {
          const text = data.toString();
          if (text.includes('Path:turn.end')) {
            ws.close();
          }
        }
      });

      ws.on('close', () => {
        if (audioChunks.length > 0) {
          const audioBuffer = Buffer.concat(audioChunks);
          const readable = new Readable();
          readable.push(audioBuffer);
          readable.push(null);
          resolve(readable);
        } else {
          reject(new Error('No audio data received'));
        }
      });

      ws.on('error', (err) => {
        reject(err);
      });

      // Timeout
      setTimeout(() => {
        ws.close();
        if (audioChunks.length > 0) {
          const audioBuffer = Buffer.concat(audioChunks);
          const readable = new Readable();
          readable.push(audioBuffer);
          readable.push(null);
          resolve(readable);
        } else {
          reject(new Error('TTS timeout'));
        }
      }, 30000);

    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { synthesize };
