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
    model: "gemini-3.1-flash-tts-preview",
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

export async function generatePodcast(
  script: string, 
  speakerMap: Record<string, VoiceName>, 
  accentMap: Record<string, string>,
  onProgress?: (current: number, total: number) => void
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // Parse script into segments
  const lines = script.split('\n').filter((l: string) => l.trim().length > 0);
  const segments = lines.map((line: string) => {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      return { speaker: match[1].trim(), text: match[2].trim() };
    }
    return { speaker: 'Unknown', text: line.trim() };
  });

  const pcmChunks: Uint8Array[] = [];
  const silenceBuffer = new Uint8Array(24000 * 2 * 0.5); // 0.5s silence at 24kHz 16-bit mono

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  for (let i = 0; i < segments.length; i++) {
    if (onProgress) onProgress(i + 1, segments.length);
    const segment = segments[i];
    const voiceName = speakerMap[segment.speaker] || 'Kore';
    const accent = accentMap?.[segment.speaker] || '';
    
    let instructions = [];
    if (accent) instructions.push(`a ${accent} accent`);
    const prompt = instructions.length > 0
      ? `Say with ${instructions.join(', ')}: ${segment.text}`
      : segment.text;

    let success = false;
    let retries = 0;
    const maxRetries = 3;

    while (!success && retries <= maxRetries) {
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.1-flash-tts-preview",
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
          const pcmData = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
          pcmChunks.push(pcmData);
          pcmChunks.push(silenceBuffer);
        }
        success = true;
      } catch (error: any) {
        if (error.message?.includes('429') || error.message?.includes('quota')) {
          retries++;
          if (retries > maxRetries) throw error;
          const waitTime = Math.pow(2, retries) * 1000 + Math.random() * 1000;
          console.warn(`Rate limit hit. Retrying in ${Math.round(waitTime)}ms... (Attempt ${retries}/${maxRetries})`);
          await delay(waitTime);
        } else {
          throw error;
        }
      }
    }

    // Small delay between segments to be kind to the API
    if (i < segments.length - 1) {
      await delay(500);
    }
  }

  if (pcmChunks.length === 0) {
    throw new Error("No audio generated");
  }

  // Calculate total size
  const totalSize = pcmChunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const finalPcm = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of pcmChunks) {
    finalPcm.set(chunk, offset);
    offset += chunk.length;
  }

  const wavData = addWavHeader(finalPcm, 24000);
  
  // Convert to base64
  let binary = '';
  const len = wavData.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(wavData[i]);
  }
  return btoa(binary);
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
