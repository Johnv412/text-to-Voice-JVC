/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Mic2, 
  Play, 
  Square, 
  Download, 
  Loader2, 
  Volume2, 
  Settings2,
  Languages,
  User,
  ChevronRight,
  Upload,
  Trash2,
  Info,
  Sparkles,
  Headphones,
  Radio,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { generateSpeech, VoiceName, sampleVoice, generatePodcast } from './services/geminiService';

interface Voice {
  id: VoiceName;
  name: string;
  gender: 'Male' | 'Female';
  description: string;
}

interface ClonedVoice {
  id: string;
  name: string;
  sample_path: string;
}

const VOICES: Voice[] = [
  { id: 'Kore', name: 'Kore', gender: 'Female', description: 'Clear and professional' },
  { id: 'Puck', name: 'Puck', gender: 'Male', description: 'Friendly and energetic' },
  { id: 'Charon', name: 'Charon', gender: 'Male', description: 'Deep and authoritative' },
  { id: 'Fenrir', name: 'Fenrir', gender: 'Male', description: 'Calm and steady' },
  { id: 'Zephyr', name: 'Zephyr', gender: 'Female', description: 'Soft and expressive' },
];

const ACCENTS = [
  { id: 'none', label: 'Standard American', value: '' },
  { id: 'brooklyn', label: 'Brooklyn, NY', value: 'Brooklyn, New York' },
  { id: 'french', label: 'French', value: 'French' },
  { id: 'british', label: 'British', value: 'English' },
  { id: 'southern', label: 'Southern US', value: 'Southern American' },
];

export default function App() {
  const [text, setText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>('Kore');
  const [selectedAccent, setSelectedAccent] = useState(ACCENTS[0]);
  const [pitch, setPitch] = useState('normal');
  const [rate, setRate] = useState('normal');
  const [isLoading, setIsLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Cloning State
  const [clonedVoices, setClonedVoices] = useState<ClonedVoice[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [samplingVoice, setSamplingVoice] = useState<VoiceName | null>(null);

  // Podcast State
  const [podcastScript, setPodcastScript] = useState('');
  const [speakerMap, setSpeakerMap] = useState<Record<string, VoiceName>>({});
  const [accentMap, setAccentMap] = useState<Record<string, string>>({});
  const [isGeneratingPodcast, setIsGeneratingPodcast] = useState(false);
  const [podcastAudioUrl, setPodcastAudioUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'studio' | 'podcast'>('studio');

  // Parse speakers from script
  useEffect(() => {
    const lines = podcastScript.split('\n').filter(l => l.trim().length > 0);
    const speakers = new Set<string>();
    lines.forEach(line => {
      const match = line.match(/^([^:]+):/);
      if (match) speakers.add(match[1].trim());
    });

    const newSpeakerMap = { ...speakerMap };
    const newAccentMap = { ...accentMap };
    let changed = false;
    speakers.forEach(speaker => {
      if (!newSpeakerMap[speaker]) {
        newSpeakerMap[speaker] = 'Kore';
        changed = true;
      }
      if (newAccentMap[speaker] === undefined) {
        newAccentMap[speaker] = '';
        changed = true;
      }
    });
    if (changed) {
      setSpeakerMap(newSpeakerMap);
      setAccentMap(newAccentMap);
    }
  }, [podcastScript]);

  const [podcastProgress, setPodcastProgress] = useState({ current: 0, total: 0 });

  const handleGeneratePodcast = async () => {
    if (!podcastScript.trim()) return;
    setIsGeneratingPodcast(true);
    setPodcastAudioUrl(null);
    
    const lines = podcastScript.split('\n').filter(l => l.trim().length > 0);
    setPodcastProgress({ current: 0, total: lines.length });

    try {
      const base64Audio = await generatePodcast(
        podcastScript, 
        speakerMap, 
        accentMap,
        (current, total) => setPodcastProgress({ current, total })
      );
      const blob = await fetch(`data:audio/wav;base64,${base64Audio}`).then(r => r.blob());
      const url = URL.createObjectURL(blob);
      setPodcastAudioUrl(url);
    } catch (err: any) {
      console.error(err);
      alert(`Failed to generate podcast: ${err.message}`);
    } finally {
      setIsGeneratingPodcast(false);
    }
  };

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const file = new File([audioBlob], `recorded-voice-${Date.now()}.wav`, { type: 'audio/wav' });
        setSelectedFile(file);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      alert('Could not access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  useEffect(() => {
    fetchClonedVoices();
  }, []);

  const fetchClonedVoices = async () => {
    try {
      const res = await fetch('/api/cloned-voices');
      const data = await res.json();
      setClonedVoices(data);
    } catch (err) {
      console.error('Failed to fetch cloned voices', err);
    }
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !cloneName) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('sample', selectedFile);
    formData.append('name', cloneName);

    try {
      const res = await fetch('/api/cloned-voices', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        setCloneName('');
        setSelectedFile(null);
        fetchClonedVoices();
      }
    } catch (err) {
      console.error('Upload failed', err);
    } finally {
      setIsUploading(false);
    }
  };

  const deleteClonedVoice = async (id: string) => {
    try {
      await fetch(`/api/cloned-voices/${id}`, { method: 'DELETE' });
      fetchClonedVoices();
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  const handleSampleVoice = async (voice: VoiceName) => {
    setSamplingVoice(voice);
    try {
      const base64 = await sampleVoice(voice);
      const blob = await fetch(`data:audio/wav;base64,${base64}`).then(res => res.blob());
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
    } catch (err) {
      console.error('Sampling failed', err);
    } finally {
      setSamplingVoice(null);
    }
  };

  const handleGenerate = async () => {
    if (!text.trim()) return;

    setIsLoading(true);
    setAudioUrl(null);
    
    try {
      const base64Audio = await generateSpeech({
        text,
        voice: selectedVoice,
        accent: selectedAccent.value,
        pitch,
        rate
      });

      const blob = await fetch(`data:audio/wav;base64,${base64Audio}`).then(res => res.blob());
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    } catch (error) {
      console.error('Speech generation failed:', error);
      alert('Failed to generate speech. Please check your API key and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const togglePlayback = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `voxgen-${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-12 text-center">
          <motion.div 
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="inline-flex items-center justify-center p-4 bg-slate-900 rounded-3xl mb-6 shadow-2xl"
          >
            <Mic2 className="w-10 h-10 text-white" />
          </motion.div>
          <motion.h1 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl font-extrabold text-slate-900 tracking-tight"
          >
            VoxGen AI <span className="text-slate-400 font-light">Lab</span>
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mt-4 text-lg text-slate-500 max-w-2xl mx-auto"
          >
            The ultimate studio for text-to-speech generation and voice management.
          </motion.p>

          <div className="mt-8 flex justify-center gap-4">
            <button
              onClick={() => setActiveTab('studio')}
              className={`px-6 py-2 rounded-full font-bold transition-all flex items-center gap-2 ${
                activeTab === 'studio' 
                  ? 'bg-slate-900 text-white shadow-lg' 
                  : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              <Volume2 className="w-4 h-4" />
              Studio
            </button>
            <button
              onClick={() => setActiveTab('podcast')}
              className={`px-6 py-2 rounded-full font-bold transition-all flex items-center gap-2 ${
                activeTab === 'podcast' 
                  ? 'bg-slate-900 text-white shadow-lg' 
                  : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              <Radio className="w-4 h-4" />
              Podcast Studio
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Generation */}
          <div className="lg:col-span-8 space-y-8">
            {activeTab === 'studio' ? (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card p-8"
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-100 rounded-lg">
                      <Volume2 className="w-5 h-5 text-slate-600" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-800">Studio Workspace</h2>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 rounded-full border border-slate-100">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Live Engine</span>
                  </div>
                </div>

                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Enter your script here... Experience the power of AI speech."
                  className="input-field h-80 text-xl leading-relaxed placeholder:text-slate-300"
                />
                
                <div className="mt-8 flex items-center gap-4">
                  <button
                    onClick={handleGenerate}
                    disabled={isLoading || !text.trim()}
                    className="btn-primary flex-1 py-4 text-lg flex items-center justify-center gap-3 shadow-xl shadow-slate-900/10"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" />
                        Synthesizing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-6 h-6" />
                        Generate Masterpiece
                      </>
                    )}
                  </button>
                  {audioUrl && (
                    <button
                      onClick={handleDownload}
                      className="p-4 rounded-2xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all shadow-sm flex items-center gap-2"
                      title="Download Last Generation"
                    >
                      <Download className="w-6 h-6" />
                      <span className="hidden sm:inline font-bold">Download</span>
                    </button>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card p-8"
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 rounded-lg">
                      <Radio className="w-5 h-5 text-indigo-600" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-800">Podcast Studio</h2>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Podcast Script</label>
                    <textarea
                      value={podcastScript}
                      onChange={(e) => setPodcastScript(e.target.value)}
                      placeholder="Host: Welcome to the show!&#10;Guest: Thanks for having me."
                      className="input-field h-64 text-lg leading-relaxed font-mono"
                    />
                    <p className="text-[10px] text-slate-400">Format: "SpeakerName: Speech text" on each line.</p>
                  </div>

                  {Object.keys(speakerMap).length > 0 && (
                    <div className="space-y-4">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        Cast Assignments
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {Object.keys(speakerMap).map(speaker => (
                          <div key={speaker} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col gap-3">
                            <span className="font-bold text-slate-700 text-sm">{speaker}</span>
                            <div className="space-y-2">
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Voice</label>
                              <select
                                value={speakerMap[speaker]}
                                onChange={(e) => setSpeakerMap({ ...speakerMap, [speaker]: e.target.value as VoiceName })}
                                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                              >
                                {VOICES.map(v => (
                                  <option key={v.id} value={v.id}>{v.name} ({v.gender})</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Accent</label>
                              <select
                                value={accentMap[speaker]}
                                onChange={(e) => setAccentMap({ ...accentMap, [speaker]: e.target.value })}
                                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                              >
                                {ACCENTS.map(a => (
                                  <option key={a.id} value={a.value}>{a.label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleGeneratePodcast}
                    disabled={isGeneratingPodcast || !podcastScript.trim()}
                    className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-900/10 flex items-center justify-center gap-3 disabled:opacity-50"
                  >
                    {isGeneratingPodcast ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex items-center gap-3">
                          <Loader2 className="w-6 h-6 animate-spin" />
                          <span>Stitching Podcast...</span>
                        </div>
                        <div className="text-[10px] text-indigo-200 font-mono uppercase tracking-widest">
                          Processing line {podcastProgress.current} of {podcastProgress.total}
                        </div>
                        <div className="w-full max-w-xs h-1 bg-indigo-900/50 rounded-full mt-2 overflow-hidden">
                          <motion.div 
                            className="h-full bg-white"
                            initial={{ width: 0 }}
                            animate={{ width: `${(podcastProgress.current / podcastProgress.total) * 100}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <Radio className="w-6 h-6" />
                        Generate Full Episode
                      </>
                    )}
                  </button>
                </div>

                {podcastAudioUrl && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-8 p-6 bg-slate-900 rounded-3xl text-white flex items-center justify-between shadow-2xl"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-indigo-500 flex items-center justify-center">
                        <Radio className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h4 className="font-bold">Podcast Ready</h4>
                        <p className="text-xs text-slate-400">Full episode generated</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <audio src={podcastAudioUrl} controls className="h-10 w-48 sm:w-64" />
                      <button
                        onClick={() => {
                          const a = document.createElement('a');
                          a.href = podcastAudioUrl;
                          a.download = `podcast-${Date.now()}.wav`;
                          a.click();
                        }}
                        className="p-3 rounded-xl bg-white text-slate-900 hover:bg-slate-100 transition-all shadow-lg"
                      >
                        <Download className="w-5 h-5" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* Audio Player (Studio Only) */}
            <AnimatePresence>
              {activeTab === 'studio' && audioUrl && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="glass-card p-8 bg-slate-900 text-white border-none shadow-2xl relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
                  <div className="relative z-10 flex items-center justify-between">
                    <div className="flex items-center gap-6">
                      <button
                        onClick={togglePlayback}
                        className="w-16 h-16 rounded-full bg-white text-slate-900 flex items-center justify-center hover:scale-110 transition-transform shadow-lg"
                      >
                        {isPlaying ? <Square className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
                      </button>
                      <div>
                        <h3 className="text-xl font-bold">Generation Complete</h3>
                        <p className="text-slate-400 text-sm mt-1">Voice: {selectedVoice} • Accent: {selectedAccent.label}</p>
                      </div>
                    </div>
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-white text-slate-900 hover:bg-slate-100 transition-all font-bold shadow-lg"
                    >
                      <Download className="w-5 h-5" />
                      Download WAV
                    </button>
                  </div>
                  <audio
                    ref={audioRef}
                    src={audioUrl}
                    onEnded={() => setIsPlaying(false)}
                    className="hidden"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Voice Cloning Section */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="glass-card p-8"
            >
              <div className="flex items-center gap-3 mb-8">
                <div className="p-2 bg-indigo-100 rounded-lg">
                  <Sparkles className="w-5 h-5 text-indigo-600" />
                </div>
                <h2 className="text-lg font-bold text-slate-800">Voice Cloning Lab</h2>
              </div>

              <form onSubmit={handleFileUpload} className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Profile Name</label>
                  <input 
                    type="text"
                    value={cloneName}
                    onChange={(e) => setCloneName(e.target.value)}
                    placeholder="e.g. My Custom Voice"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Audio Sample</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input 
                        type="file"
                        accept="audio/*"
                        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                        className="hidden"
                        id="voice-upload"
                      />
                      <label 
                        htmlFor="voice-upload"
                        className="w-full px-4 py-3 rounded-xl border border-dashed border-slate-300 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors"
                      >
                        <span className="text-sm text-slate-500 truncate max-w-[150px]">
                          {selectedFile ? selectedFile.name : 'Choose or record sample...'}
                        </span>
                        <Upload className="w-4 h-4 text-slate-400" />
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`p-3 rounded-xl border transition-all flex items-center justify-center gap-2 ${
                        isRecording 
                          ? 'bg-red-50 border-red-200 text-red-600 animate-pulse' 
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                      title={isRecording ? 'Stop Recording' : 'Record Voice'}
                    >
                      {isRecording ? <Square className="w-4 h-4 fill-current" /> : <Mic2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button 
                  type="submit"
                  disabled={isUploading || !selectedFile || !cloneName}
                  className="md:col-span-2 py-3 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Create Voice Profile
                </button>
              </form>

              <div className="space-y-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Your Cloned Profiles</h3>
                {clonedVoices.length === 0 ? (
                  <div className="p-8 rounded-2xl border border-dashed border-slate-200 text-center">
                    <p className="text-sm text-slate-400">No custom voices yet. Upload a sample to begin.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {clonedVoices.map((voice) => (
                      <div key={voice.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between group">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                            <User className="w-5 h-5 text-indigo-600" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-700">{voice.name}</p>
                            <p className="text-[10px] text-slate-400 uppercase tracking-tighter">Profile Active</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              const audio = new Audio(voice.sample_path);
                              audio.play();
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white text-indigo-600 font-bold text-xs shadow-sm hover:bg-indigo-50 transition-all border border-indigo-100"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            Sample
                          </button>
                          <button 
                            onClick={() => deleteClonedVoice(voice.id)}
                            className="p-2 rounded-xl hover:bg-white text-slate-400 hover:text-red-600 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>

          {/* Right Column: Config */}
          <div className="lg:col-span-4 space-y-8">
            {/* Voice Selection */}
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="glass-card p-6"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Voice Library
                </h3>
                <span className="text-[10px] bg-slate-100 px-2 py-1 rounded-md text-slate-500 font-bold">PREBUILT</span>
              </div>
              
              <div className="space-y-3">
                {VOICES.map((voice) => (
                  <div key={voice.id} className="relative group">
                    <button
                      onClick={() => setSelectedVoice(voice.id)}
                      className={`w-full p-4 rounded-2xl border text-left transition-all flex items-center justify-between ${
                        selectedVoice === voice.id
                          ? 'border-slate-900 bg-slate-900 text-white shadow-lg'
                          : 'border-slate-100 hover:border-slate-200 bg-slate-50/50'
                      }`}
                    >
                      <div>
                        <p className="font-bold">{voice.name}</p>
                        <p className={`text-[10px] ${selectedVoice === voice.id ? 'text-slate-400' : 'text-slate-500'}`}>
                          {voice.gender} • {voice.description}
                        </p>
                      </div>
                      <ChevronRight className={`w-4 h-4 transition-transform ${selectedVoice === voice.id ? 'translate-x-1' : 'opacity-0'}`} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSampleVoice(voice.id);
                      }}
                      className={`absolute right-12 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all ${
                        selectedVoice === voice.id 
                          ? 'text-white hover:bg-white/10' 
                          : 'text-slate-400 hover:bg-white hover:text-slate-900 shadow-sm'
                      }`}
                      title="Sample Voice"
                    >
                      {samplingVoice === voice.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Headphones className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Accent Selection */}
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-card p-6"
            >
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2 mb-6">
                <Languages className="w-4 h-4" />
                Accent Engine
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {ACCENTS.map((accent) => (
                  <button
                    key={accent.id}
                    onClick={() => setSelectedAccent(accent)}
                    className={`px-4 py-4 rounded-2xl text-sm font-bold transition-all text-left flex items-center justify-between ${
                      selectedAccent.id === accent.id
                        ? 'bg-slate-900 text-white shadow-lg'
                        : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {accent.label}
                    {selectedAccent.id === accent.id && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </button>
                ))}
              </div>
            </motion.div>

            {/* Voice Tuning */}
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="glass-card p-6"
            >
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2 mb-6">
                <Settings2 className="w-4 h-4" />
                Voice Tuning
              </h3>
              
              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pitch</label>
                    <span className="text-[10px] font-mono text-slate-400 uppercase">{pitch}</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="4" 
                    step="1"
                    value={['very low', 'low', 'normal', 'high', 'very high'].indexOf(pitch)}
                    onChange={(e) => setPitch(['very low', 'low', 'normal', 'high', 'very high'][parseInt(e.target.value)])}
                    className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-slate-900"
                  />
                  <div className="flex justify-between text-[8px] text-slate-400 font-bold uppercase tracking-tighter">
                    <span>Low</span>
                    <span>High</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Speech Rate</label>
                    <span className="text-[10px] font-mono text-slate-400 uppercase">{rate}</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="4" 
                    step="1"
                    value={['very slow', 'slow', 'normal', 'fast', 'very fast'].indexOf(rate)}
                    onChange={(e) => setRate(['very slow', 'slow', 'normal', 'fast', 'very fast'][parseInt(e.target.value)])}
                    className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-slate-900"
                  />
                  <div className="flex justify-between text-[8px] text-slate-400 font-bold uppercase tracking-tighter">
                    <span>Slow</span>
                    <span>Fast</span>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Info Box */}
            <div className="p-6 rounded-3xl bg-indigo-50 border border-indigo-100 relative overflow-hidden">
              <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-indigo-200/20 rounded-full blur-2xl" />
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-3">
                  <Info className="w-5 h-5 text-indigo-600" />
                  <h4 className="font-bold text-indigo-900 text-sm uppercase tracking-tight">System Note</h4>
                </div>
                <p className="text-xs text-indigo-800 leading-relaxed">
                  Voice cloning stores your samples locally. While the core TTS engine uses high-fidelity prebuilt models, your samples are used for reference and profile management.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
