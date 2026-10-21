import Dexie, { type Table } from 'dexie';
import { isTauri } from '@tauri-apps/api/core';
import { BaseDirectory, documentDir, join } from '@tauri-apps/api/path';
import type { Song } from './studio-data';

export type StoredBackground = { id: string; name: string; mimeType?: string; blob?: Blob; path?: string; type: 'image' | 'video' };
type ThemeRecord = { id: string; value: string };
type SongRecord = Song & { id: string };
export type VerseRecord = {
  bibleId: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  reference: string;
  copyright?: string | null;
};
export type WorkspacePreferences = {
  autoPush: boolean;
  scriptureBackground: string;
  scriptureBackgroundType: 'image' | 'video';
  mediaBackground: string;
  mediaBackgroundType: 'image' | 'video';
  outputName: string;
};

class SelahWorkspace extends Dexie {
  songs!: Table<SongRecord, string>;
  sermons!: Table<SongRecord, string>;
  themes!: Table<ThemeRecord, string>;
  backgrounds!: Table<StoredBackground, string>;
  verses!: Table<VerseRecord, [string, string, number, number]>;
  constructor() {
    super('selah-local-workspace');
    this.version(1).stores({
      songs: 'id,title,author',
      sermons: 'id,title',
      themes: 'id',
      backgrounds: 'id,name,type',
    });
    this.version(2).stores({
      songs: 'id,title,author',
      sermons: 'id,title',
      themes: 'id',
      backgrounds: 'id,name,type',
      verses: '[bibleId+book+chapter+verse],[bibleId+book+chapter],bibleId,book,chapter',
    });
  }
}

export const workspaceDb = new SelahWorkspace();
const recordId = (song: Song) => `${song.kind === 'sermon' ? 'sermon' : 'song'}:${song.title.toLocaleLowerCase()}`;

function createAssetId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export async function readSavedSongs() {
  const [songs, sermons] = await Promise.all([workspaceDb.songs.toArray(), workspaceDb.sermons.toArray()]);
  return [...songs, ...sermons].map(({ id: _id, ...song }) => song);
}
export async function saveLocalSong(song: Song) {
  const record = { ...song, id: recordId(song) };
  if (song.kind === 'sermon') await workspaceDb.sermons.put(record);
  else await workspaceDb.songs.put(record);
}
export async function removeLocalSong(song: Song) {
  const id = recordId(song);
  await Promise.all([workspaceDb.songs.delete(id), workspaceDb.sermons.delete(id)]);
}
export async function readTheme() {
  return (await workspaceDb.themes.get('accent'))?.value ?? 'teal';
}
export async function saveTheme(value: string) {
  await workspaceDb.themes.put({ id: 'accent', value });
}
export async function readScriptureTheme() {
  return (await workspaceDb.themes.get('scripture-background'))?.value ?? 'scripture-obsidian';
}
export async function saveScriptureTheme(value: string) {
  await workspaceDb.themes.put({ id: 'scripture-background', value });
}
export async function readWorkspacePreferences(): Promise<Partial<WorkspacePreferences>> {
  const record = await workspaceDb.themes.get('workspace-preferences');
  if (!record) return {};
  try {
    const parsed = JSON.parse(record.value) as Partial<WorkspacePreferences>;
    return {
      ...(typeof parsed.autoPush === 'boolean' ? { autoPush: parsed.autoPush } : {}),
      ...(typeof parsed.scriptureBackground === 'string' ? { scriptureBackground: parsed.scriptureBackground } : {}),
      ...(parsed.scriptureBackgroundType === 'image' || parsed.scriptureBackgroundType === 'video' ? { scriptureBackgroundType: parsed.scriptureBackgroundType } : {}),
      ...(typeof parsed.mediaBackground === 'string' ? { mediaBackground: parsed.mediaBackground } : {}),
      ...(parsed.mediaBackgroundType === 'image' || parsed.mediaBackgroundType === 'video' ? { mediaBackgroundType: parsed.mediaBackgroundType } : {}),
      ...(typeof parsed.outputName === 'string' ? { outputName: parsed.outputName } : {}),
    };
  } catch {
    return {};
  }
}
export async function saveWorkspacePreferences(value: WorkspacePreferences) {
  await workspaceDb.themes.put({ id: 'workspace-preferences', value: JSON.stringify(value) });
}
export async function readBackgrounds(): Promise<StoredBackground[]> {
  return workspaceDb.backgrounds.toArray();
}
export async function stashBackground(file: File): Promise<StoredBackground> {
  const isVideo = ['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type);
  if (!file.type.startsWith('image/') && !isVideo) {
    throw new Error('Choose an image, GIF, MP4, MOV, or WebM file.');
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const id = createAssetId();
  const item: StoredBackground = { id, name: file.name, mimeType: file.type, type: isVideo ? 'video' : 'image' };
  if (isTauri()) {
    const fs = await import('@tauri-apps/plugin-fs');
    const directory = 'SelahStudio/Assets';
    const relativePath = `${directory}/${id}-${safeName}`;
    await fs.mkdir(directory, { baseDir: BaseDirectory.Document, recursive: true });
    await fs.writeFile(relativePath, new Uint8Array(await file.arrayBuffer()), {
      baseDir: BaseDirectory.Document,
    });
    item.path = await join(await documentDir(), directory, `${id}-${safeName}`);
  } else {
    item.blob = file;
  }
  await workspaceDb.backgrounds.put(item);
  return item;
}

export async function getBackgroundBlob(id: string): Promise<Blob | undefined> {
  const item = await workspaceDb.backgrounds.get(id);
  if (!item) return undefined;
  if (item.blob) return item.blob;
  if (!item.path || !isTauri()) return undefined;
  const fs = await import('@tauri-apps/plugin-fs');
  const bytes = await fs.readFile(item.path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const extension = item.name.split('.').at(-1)?.toLowerCase();
  const mime = item.mimeType || (extension === 'gif' ? 'image/gif'
    : extension === 'png' ? 'image/png'
    : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
    : extension === 'webp' ? 'image/webp'
    : extension === 'mov' ? 'video/quicktime'
    : extension === 'webm' ? 'video/webm'
    : 'video/mp4');
  return new Blob([buffer], { type: mime });
}

export type CachedPassage = {
  bibleId: string;
  book: string;
  chapter: number;
  reference: string;
  verses: string[];
  verseNumbers: number[];
  copyright?: string | null;
};
export async function getCachedPassage(
  bibleId: string,
  book: string,
  chapter: number,
  verseNumbers: number[],
): Promise<CachedPassage | undefined> {
  if (!verseNumbers.length) return undefined;
  const records = await Promise.all(
    verseNumbers.map(verse => workspaceDb.verses.get([bibleId, book, chapter, verse])),
  );
  if (records.some(record => !record)) return undefined;
  const found = records as VerseRecord[];
  return {
    bibleId,
    book,
    chapter,
    reference: found[0]?.reference ?? `${book} ${chapter}`,
    verses: found.map(record => record.text),
    verseNumbers,
    copyright: found[0]?.copyright,
  };
}
export async function cachePassage(passage: CachedPassage) {
  await workspaceDb.verses.bulkPut(
    passage.verses.map((text, index) => ({
      bibleId: passage.bibleId,
      book: passage.book,
      chapter: passage.chapter,
      verse: passage.verseNumbers[index] ?? index + 1,
      text,
      reference: passage.reference,
      copyright: passage.copyright,
    })),
  );
}
