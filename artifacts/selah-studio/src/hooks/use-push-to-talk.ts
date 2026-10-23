import { useCallback, useRef, useState } from 'react';
import { useTranscribeAudio } from '@workspace/api-client-react';
import { isTauri } from '@tauri-apps/api/core';

type SpeechRecognitionResult = { results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }>>; error?: string };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResult) => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

export function usePushToTalk(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState('');
  const recognition = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const latestTranscript = useRef<string>('');
  const mutation = useTranscribeAudio();

  const start = useCallback(async () => {
    if (listening || transcribing) return;
    setError('');
    latestTranscript.current = '';
    const browser = window as SpeechWindow;
    const Speech = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;

    if (!isTauri() && Speech) {
      try {
        const instance = new Speech();
        recognition.current = instance;
        instance.continuous = true;
        instance.interimResults = true;
        instance.lang = navigator.language || 'en-US';
        instance.onresult = (event) => {
          const transcript = Array.from(event.results)
            .map((result) => result[0]?.transcript ?? '')
            .join(' ')
            .trim();
          if (transcript) {
            latestTranscript.current = transcript;
            onTranscript(transcript);
          }
        };
        instance.onerror = (event) => {
          // If already captured text, keep it; otherwise show error
          if (!latestTranscript.current) {
            setError(event?.error ? `Speech recognition error: ${event.error}. Check microphone permission and try again.` : 'Speech recognition could not hear that. Try again.');
          }
        };
        instance.onend = () => {
          setListening(false);
          if (latestTranscript.current) {
            onTranscript(latestTranscript.current);
          }
        };
        instance.start();
        setListening(true);
        return;
      } catch {
        setError('Speech recognition could not start. Check microphone permission.');
        return;
      }
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice capture is unavailable in this browser. Type a reference or passage instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined,
      });
      recorder.current = mediaRecorder;
      chunks.current = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audio = new Blob(chunks.current, { type: mediaRecorder.mimeType || 'audio/webm' });
        if (!audio.size) {
          setError('No audio was captured. Check that the microphone is enabled, then press and hold Push to Talk while speaking.');
          return;
        }
        setTranscribing(true);
        try {
          const result = await mutation.mutateAsync({ data: audio });
          const transcript = typeof result?.text === 'string' ? result.text.trim() : '';
          if (transcript) {
            latestTranscript.current = transcript;
            onTranscript(transcript);
          } else {
            setError('No words were detected. Try speaking closer to the microphone.');
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          const hasApiBase = Boolean(
            import.meta.env.VITE_TAURI_API_BASE_URL?.trim() || import.meta.env.VITE_API_BASE_URL?.trim(),
          );
          if (isTauri() && !hasApiBase) {
            setError('Online transcription is not configured in this desktop build. Set the VITE_TAURI_API_BASE_URL GitHub repository variable to your Render API URL, then rebuild.');
          } else if (message && !/failed to fetch|networkerror|load failed/i.test(message)) {
            setError(message);
          } else {
            setError('Audio transcription could not reach the API. Check the Render service URL and its HF_ACCESS_TOKEN setting, then try again.');
          }
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorder.start();
      setListening(true);
    } catch {
      setError('Microphone permission was denied or unavailable.');
    }
  }, [listening, transcribing, mutation, onTranscript]);

  const stop = useCallback(() => {
    if (recognition.current) {
      try {
        recognition.current.stop();
      } catch {
        // Safe fallback
      }
      setListening(false);
    }
    if (recorder.current && recorder.current.state === 'recording') {
      setListening(false);
      try {
        recorder.current.stop();
      } catch {
        // Safe fallback
      }
    }
  }, []);

  const dismissError = useCallback(() => setError(''), []);

  return { listening, transcribing, error, start, stop, dismissError };
}
