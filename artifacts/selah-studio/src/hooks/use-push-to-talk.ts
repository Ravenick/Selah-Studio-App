import { useCallback, useRef, useState } from 'react';
import { useTranscribeAudio } from '@workspace/api-client-react';

type SpeechMode = 'offline' | 'online';
type LocalTranscriber = (audio: Float32Array, options: { sampling_rate: number; language: string; task: string }) => Promise<{ text: string }>;

let localTranscriberPromise: Promise<LocalTranscriber> | null = null;

async function getLocalTranscriber(onProgress: (message: string) => void): Promise<LocalTranscriber> {
  if (!localTranscriberPromise) {
    localTranscriberPromise = import('@huggingface/transformers').then(async ({ pipeline, env }) => {
      // Desktop and production builds bundle model weights. Development can fetch
      // the same model remotely and then retain it in the browser cache.
      env.allowLocalModels = true;
      env.allowRemoteModels = import.meta.env.DEV;
      env.localModelPath = `${import.meta.env.BASE_URL}models/`;
      const model = import.meta.env.DEV ? 'onnx-community/whisper-tiny.en' : 'whisper-tiny.en';
      const recognizer = await pipeline('automatic-speech-recognition', model, {
        dtype: 'q8',
        progress_callback: (progress: { status?: string; progress?: number }) => {
          if (progress.status === 'progress_total') {
            const percent = Math.round(progress.progress ?? 0);
            onProgress(`Preparing offline speech model${percent ? ` · ${percent}%` : ''}`);
          }
        },
      });
      return recognizer as unknown as LocalTranscriber;
    }).catch((error) => {
      localTranscriberPromise = null;
      throw error;
    });
  }
  return localTranscriberPromise;
}

async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer();
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(bytes);
    const frames = Math.ceil(decoded.duration * 16_000);
    const offline = new OfflineAudioContext(1, frames, 16_000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    await context.close();
  }
}

export function usePushToTalk(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [mode, setModeState] = useState<SpeechMode>(() =>
    localStorage.getItem('selah-speech-mode') === 'online' ? 'online' : 'offline',
  );
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const mutation = useTranscribeAudio();

  const setMode = useCallback((next: SpeechMode) => {
    setModeState(next);
    localStorage.setItem('selah-speech-mode', next);
    setError('');
  }, []);

  const start = useCallback(async () => {
    if (listening || transcribing) return;
    setError('');
    setStatus('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice capture is unavailable here. Type a reference or passage instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.current = mediaRecorder;
      chunks.current = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audio = new Blob(chunks.current, { type: mediaRecorder.mimeType || 'audio/webm' });
        if (!audio.size) return;
        setTranscribing(true);
        setStatus(mode === 'offline' ? 'Recognizing on this device…' : 'Transcribing online…');
        try {
          let transcript: string;
          if (mode === 'offline') {
            const recognizer = await getLocalTranscriber(setStatus);
            const samples = await decodeToMono16k(audio);
            transcript = (await recognizer(samples, { sampling_rate: 16_000, language: 'english', task: 'transcribe' })).text.trim();
          } else {
            const result = await mutation.mutateAsync({ data: audio });
            transcript = result.text.trim();
          }
          if (transcript) onTranscript(transcript);
          else setError('No words were detected. Try speaking closer to the microphone.');
        } catch (reason) {
          console.error('Speech transcription failed', reason);
          setError(mode === 'offline'
            ? 'Offline recognition could not load the model or decode this recording. Connect once to download the model, then try again.'
            : 'Online transcription failed. Check the API server connection and try again.');
        } finally {
          setTranscribing(false);
          setStatus('');
        }
      };
      mediaRecorder.start();
      setListening(true);
    } catch (reason) {
      console.error('Unable to start voice capture', reason);
      setTranscribing(false);
      setError('Microphone permission was denied or unavailable.');
    }
  }, [listening, transcribing, mode, mutation, onTranscript]);

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') {
      setListening(false);
      recorder.current.stop();
    }
  }, []);

  return { listening, transcribing, error, status, mode, setMode, start, stop };
}
