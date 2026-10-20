import { useEffect, useState } from 'react';
import { workspaceDb } from './local-workspace';

export type PresentationFont = 'font-bebas-neue' | 'font-montserrat' | 'font-dm' | 'font-georgia' | 'font-mono';

export type ScriptureAppearance = {
  font: PresentationFont;
  textColor: string;
};

export const DEFAULT_SCRIPTURE_APPEARANCE: ScriptureAppearance = {
  font: 'font-mono',
  textColor: '#ffffff',
};

export const PRESENTATION_COLORS = [
  '#ffffff', '#f3f4f6', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#1f2937', '#000000',
  '#fff1f2', '#fecdd3', '#fda4af', '#fb7185', '#f43f5e', '#e11d48', '#be123c', '#881337', '#500724',
  '#fff7ed', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#431407',
  '#fefce8', '#fef08a', '#fde047', '#facc15', '#eab308', '#ca8a04', '#84cc16', '#4d7c0f', '#365314',
  '#dcfce7', '#4ade80', '#16a34a', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#8b5cf6', '#d946ef',
];

const STORAGE_KEY = 'selah-scripture-appearance';
const UPDATE_EVENT = 'selah-scripture-appearance-change';
const CHANNEL_NAME = 'selah_scripture_appearance';

export function readScriptureAppearance(): ScriptureAppearance {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const value = JSON.parse(stored) as Partial<ScriptureAppearance>;
      return {
        font: isPresentationFont(value.font) ? value.font : DEFAULT_SCRIPTURE_APPEARANCE.font,
        textColor: isHexColor(value.textColor) ? value.textColor : DEFAULT_SCRIPTURE_APPEARANCE.textColor,
      };
    }
  } catch {
    // Use the built-in defaults when storage is unavailable or malformed.
  }
  return DEFAULT_SCRIPTURE_APPEARANCE;
}

export function saveScriptureAppearance(value: ScriptureAppearance) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Keep the current window usable when storage is unavailable.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(UPDATE_EVENT));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(value);
    channel.close();
  }
  void workspaceDb.themes.put({ id: 'scripture-appearance', value: JSON.stringify(value) }).catch(() => {
    // localStorage remains available when IndexedDB is unavailable.
  });
}

export function useScriptureAppearance() {
  const [appearance, setAppearance] = useState(readScriptureAppearance);

  useEffect(() => {
    const update = () => setAppearance(readScriptureAppearance());
    void workspaceDb.themes.get('scripture-appearance').then((record) => {
      if (!record || localStorage.getItem(STORAGE_KEY)) return;
      try {
        localStorage.setItem(STORAGE_KEY, record.value);
        update();
      } catch {
        // Keep the built-in default if browser storage is unavailable.
      }
    }).catch(() => undefined);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
    if (channel) channel.onmessage = update;
    window.addEventListener(UPDATE_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(UPDATE_EVENT, update);
      window.removeEventListener('storage', update);
      channel?.close();
    };
  }, []);

  return appearance;
}

function isPresentationFont(value: unknown): value is PresentationFont {
  return value === 'font-bebas-neue' || value === 'font-montserrat' || value === 'font-dm' || value === 'font-georgia' || value === 'font-mono';
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
}
