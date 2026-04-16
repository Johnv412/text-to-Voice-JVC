import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import multer from 'multer';
import dotenv from 'dotenv';
import { GoogleGenAI, Modality } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;
const db = new Database('voices.db');

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS voice_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sample_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Configure Multer for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage });

app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Helper for WAV Header
function addWavHeader(pcmData: Buffer, sampleRate: number): Buffer {
  const dataSize = pcmData.length;
  const header = Buffer.alloc(44);

  // RIFF identifier
  header.write('RIFF', 0);
  // RIFF chunk length
  header.writeUInt32LE(36 + dataSize, 4);
  // RIFF type
  header.write('WAVE', 8);
  // format chunk identifier
  header.write('fmt ', 12);
  // format chunk length
  header.writeUInt32LE(16, 16);
  // sample format (PCM = 1)
  header.writeUInt16LE(1, 20);
  // channel count (Mono = 1)
  header.writeUInt16LE(1, 22);
  // sample rate
  header.writeUInt32LE(sampleRate, 24);
  // byte rate (sample rate * block align)
  header.writeUInt32LE(sampleRate * 2, 28);
  // block align (channel count * bytes per sample)
  header.writeUInt16LE(2, 32);
  // bits per sample (16-bit)
  header.writeUInt16LE(16, 34);
  // data chunk identifier
  header.write('data', 36);
  // data chunk length
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

// API Routes
app.get('/api/cloned-voices', (req, res) => {
  const voices = db.prepare('SELECT * FROM voice_profiles ORDER BY created_at DESC').all();
  res.json(voices);
});

app.post('/api/cloned-voices', upload.single('sample'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  const { name } = req.body;
  const id = Math.random().toString(36).substr(2, 9);
  const samplePath = `/uploads/${req.file.filename}`;

  db.prepare('INSERT INTO voice_profiles (id, name, sample_path) VALUES (?, ?, ?)')
    .run(id, name, samplePath);

  res.json({ id, name, samplePath });
});

app.delete('/api/cloned-voices/:id', (req, res) => {
  const { id } = req.params;
  const voice = db.prepare('SELECT sample_path FROM voice_profiles WHERE id = ?').get() as any;
  
  if (voice) {
    const fullPath = path.join(process.cwd(), voice.sample_path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    db.prepare('DELETE FROM voice_profiles WHERE id = ?').run(id);
  }
  
  res.json({ success: true });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
