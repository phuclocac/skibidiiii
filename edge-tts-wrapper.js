const { spawn } = require('child_process');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

async function synthesize(text, voice = 'vi-VN-HoaiMyNeural') {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `tts_${crypto.randomBytes(8).toString('hex')}.mp3`);

    const args = [
      '-m', 'edge_tts',
      '--voice', voice,
      '--text', text,
      '--write-media', tmpFile,
    ];

    const proc = spawn('python3', args);

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`edge-tts exited ${code}: ${stderr}`));
      }

      if (!fs.existsSync(tmpFile)) {
        return reject(new Error('TTS output file not found'));
      }

      const audioBuffer = fs.readFileSync(tmpFile);
      fs.unlink(tmpFile, () => {});

      const readable = new Readable();
      readable.push(audioBuffer);
      readable.push(null);
      resolve(readable);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to run edge-tts: ${err.message}`));
    });

    setTimeout(() => {
      proc.kill();
      reject(new Error('TTS timeout'));
    }, 30000);
  });
}

module.exports = { synthesize };
