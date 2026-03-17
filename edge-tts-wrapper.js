const axios = require('axios');

async function synthesize(text, voice = 'vi-VN-HoaiMyNeural') {
    try {
        // Edge TTS API endpoint thực tế
        const response = await axios.post(
            'https://api16.edge-tts.com/v1/audio/speech',
            {
                input: text,
                voice: voice,
                response_format: 'mp3'
            },
            { 
                responseType: 'arraybuffer',
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        return Buffer.from(response.data);
    } catch (error) {
        console.error('Lỗi TTS:', error.message);
        throw error;
    }
}

module.exports = { synthesize };
