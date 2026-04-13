import { GoogleGenAI, Modality } from "@google/genai";

export type VoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export interface TTSOptions {
  text: string;
  voice: VoiceName;
  accent?: string;
  pitch?: string;
  rate?: string;
}

export async function generateSpeech({ text, voice, accent, pitch, rate }: TTSOptions): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // Construct the prompt with accent, pitch, and rate instructions
  let instructions = [];
  if (accent) instructions.push(`a ${accent} accent`);
  if (pitch && pitch !== 'normal') instructions.push(`a ${pitch} pitch`);
  if (rate && rate !== 'normal') instructions.push(`a ${rate} speed`);

  const prompt = instructions.length > 0
    ? `Say with ${instructions.join(', ')}: ${text}`
    : text;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  
  if (!base64Audio) {
    throw new Error("No audio data received from Gemini API");
  }

  // Gemini TTS returns raw PCM (16-bit, mono, 24kHz). 
  // We need to add a WAV header so the browser can play it.
  const pcmData = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
  const wavData = addWavHeader(pcmData, 24000);
  
  // Convert back to base64 for the frontend
  let binary = '';
  const len = wavData.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(wavData[i]);
  }
  return btoa(binary);
}

export async function sampleVoice(voice: VoiceName): Promise<string> {
  return generateSpeech({
    text: `Hello! I am the ${voice} voice. How can I help you today?`,
    voice
  });
}

function addWavHeader(pcmData: Uint8Array, sampleRate: number): Uint8Array {
  const dataSize = pcmData.length;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // RIFF identifier
  view.setUint8(0, 'R'.charCodeAt(0));
  view.setUint8(1, 'I'.charCodeAt(0));
  view.setUint8(2, 'F'.charCodeAt(0));
  view.setUint8(3, 'F'.charCodeAt(0));
  // RIFF chunk length
  view.setUint32(4, 36 + dataSize, true);
  // RIFF type
  view.setUint8(8, 'W'.charCodeAt(0));
  view.setUint8(9, 'A'.charCodeAt(0));
  view.setUint8(10, 'V'.charCodeAt(0));
  view.setUint8(11, 'E'.charCodeAt(0));
  // format chunk identifier
  view.setUint8(12, 'f'.charCodeAt(0));
  view.setUint8(13, 'm'.charCodeAt(0));
  view.setUint8(14, 't'.charCodeAt(0));
  view.setUint8(15, ' '.charCodeAt(0));
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (PCM = 1)
  view.setUint16(20, 1, true);
  // channel count (Mono = 1)
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, 2, true);
  // bits per sample (16-bit)
  view.setUint16(34, 16, true);
  // data chunk identifier
  view.setUint8(36, 'd'.charCodeAt(0));
  view.setUint8(37, 'a'.charCodeAt(0));
  view.setUint8(38, 't'.charCodeAt(0));
  view.setUint8(39, 'a'.charCodeAt(0));
  // data chunk length
  view.setUint32(40, dataSize, true);

  const wav = new Uint8Array(44 + dataSize);
  wav.set(new Uint8Array(header));
  wav.set(pcmData, 44);

  return wav;
}
