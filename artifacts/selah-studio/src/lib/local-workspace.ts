import Dexie, { type Table } from 'dexie';
import { isTauri } from '@tauri-apps/api/core';
import { BaseDirectory, documentDir, join } from '@tauri-apps/api/path';
import type { Slide, Song } from './studio-data';

export type StoredBackground = {
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
  createdAt?: number;
  purpose?: 'background' | 'media';
  albumId?: string;
  blob?: Blob;
  path?: string;
  type: 'image' | 'video';
};
export type StoredMediaAlbum = {
  id: string;
  name: string;
  description: string;
  mediaIds: string[];
  createdAt: number;
  updatedAt: number;
};
export type ScheduleMediaItem = Pick<StoredBackground, 'id' | 'name' | 'mimeType' | 'size' | 'createdAt' | 'purpose' | 'albumId' | 'type'>;
export type ScheduleMediaSnapshot = {
  media: ScheduleMediaItem[];
  albums: StoredMediaAlbum[];
};
export const MAX_MEDIA_FILE_SIZE_BYTES = 200 * 1024 * 1024;
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
  backgroundDim: number;
  outputName: string;
};

class SelahWorkspace extends Dexie {
  songs!: Table<SongRecord, string>;
  sermons!: Table<SongRecord, string>;
  themes!: Table<ThemeRecord, string>;
  backgrounds!: Table<StoredBackground, string>;
  albums!: Table<StoredMediaAlbum, string>;
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
    this.version(3).stores({
      songs: 'id,title,author',
      sermons: 'id,title',
      themes: 'id',
      backgrounds: 'id,name,type,albumId',
      verses: '[bibleId+book+chapter+verse],[bibleId+book+chapter],bibleId,book,chapter',
      albums: 'id,name,updatedAt',
    });
  }
}

export const workspaceDb = new SelahWorkspace();
const LEGACY_SONGS_KEY = 'selah-active-schedule-songs';
const LEGACY_SONGS_MIGRATION_ID = 'legacy-songs-migrated-v1';
const recordId = (song: Song) => `${song.kind === 'sermon' ? 'sermon' : 'song'}:${song.title.trim().toLocaleLowerCase()}`;

export function mergeSongLibraries(...libraries: Song[][]): Song[] {
  const records = new Map<string, Song>();
  for (const song of libraries.flat()) records.set(recordId(song), song);
  return [...records.values()];
}

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

export function parseLegacySongs(value: unknown): Song[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Song[] => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<Song>;
    if (typeof candidate.title !== 'string' || !candidate.title.trim()
      || !Array.isArray(candidate.lyrics) || !candidate.lyrics.every((line) => typeof line === 'string')) return [];
    return [{
      ...candidate,
      title: candidate.title,
      author: typeof candidate.author === 'string' ? candidate.author : '',
      tag: typeof candidate.tag === 'string' ? candidate.tag : '',
      lyrics: candidate.lyrics,
      kind: candidate.kind === 'sermon' ? 'sermon' : 'song',
    } as Song];
  });
}

export async function migrateLegacySongs(): Promise<Song[]> {
  if (!(await workspaceDb.themes.get(LEGACY_SONGS_MIGRATION_ID))) {
    let legacySongs: Song[] = [];
    let canCompleteMigration = true;
    try {
      const stored = localStorage.getItem(LEGACY_SONGS_KEY);
      if (stored) legacySongs = parseLegacySongs(JSON.parse(stored));
    } catch {
      canCompleteMigration = false;
    }

    if (canCompleteMigration) {
      await workspaceDb.transaction('rw', workspaceDb.songs, workspaceDb.sermons, workspaceDb.themes, async () => {
        if (await workspaceDb.themes.get(LEGACY_SONGS_MIGRATION_ID)) return;
        for (const song of legacySongs) {
          const table = song.kind === 'sermon' ? workspaceDb.sermons : workspaceDb.songs;
          const id = recordId(song);
          if (!(await table.get(id))) await table.put({ ...song, id });
        }
        await workspaceDb.themes.put({ id: LEGACY_SONGS_MIGRATION_ID, value: 'complete' });
      });
    }
  }
  return readSavedSongs();
}

export async function saveLocalSong(song: Song, previousSong?: Song) {
  const record = { ...song, id: recordId(song) };
  const table = song.kind === 'sermon' ? workspaceDb.sermons : workspaceDb.songs;
  await workspaceDb.transaction('rw', workspaceDb.songs, workspaceDb.sermons, async () => {
    await table.put(record);
    if (previousSong && recordId(previousSong) !== record.id) {
      const previousTable = previousSong.kind === 'sermon' ? workspaceDb.sermons : workspaceDb.songs;
      await previousTable.delete(recordId(previousSong));
    }
  });
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
      ...(typeof parsed.backgroundDim === 'number' && parsed.backgroundDim >= 0 && parsed.backgroundDim <= 100 ? { backgroundDim: parsed.backgroundDim } : {}),
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
export async function readMediaAlbums(): Promise<StoredMediaAlbum[]> {
  return workspaceDb.albums.orderBy('updatedAt').reverse().toArray();
}

export async function createScheduleMediaSnapshot(
  slides: Slide[],
  previousSnapshot?: ScheduleMediaSnapshot,
): Promise<{ slides: Slide[]; mediaLibrary: ScheduleMediaSnapshot }> {
  const media = new Map<string, ScheduleMediaItem>();
  const albumSlides = new Map<string, Slide[]>();
  const scheduledSlides = await Promise.all(slides.map(async (slide) => {
    const id = slide.mediaUrl?.startsWith('local-background:')
      ? slide.mediaUrl.slice('local-background:'.length)
      : undefined;
    if (slide.kind !== 'media' || !id) return slide;
    const stored = await workspaceDb.backgrounds.get(id);
    const savedMetadata = previousSnapshot?.media.find((item) => item.id === id);
    const albumId = slide.mediaAlbumId ?? savedMetadata?.albumId ?? stored?.albumId;
    const metadata: ScheduleMediaItem = {
      id,
      name: stored?.name ?? savedMetadata?.name ?? slide.title,
      ...((stored?.mimeType ?? savedMetadata?.mimeType) ? { mimeType: stored?.mimeType ?? savedMetadata?.mimeType } : {}),
      ...((stored?.size ?? savedMetadata?.size) !== undefined ? { size: stored?.size ?? savedMetadata?.size } : {}),
      ...((stored?.createdAt ?? savedMetadata?.createdAt) !== undefined ? { createdAt: stored?.createdAt ?? savedMetadata?.createdAt } : {}),
      purpose: 'media',
      ...(albumId ? { albumId } : {}),
      type: stored?.type ?? savedMetadata?.type ?? (slide.mediaType === 'video' ? 'video' : 'image'),
    };
    media.set(id, metadata);
    if (albumId) albumSlides.set(albumId, [...(albumSlides.get(albumId) ?? []), { ...slide, mediaAlbumId: albumId }]);
    return { ...slide, title: metadata.name, mediaAlbumId: albumId };
  }));
  const albums = await Promise.all([...albumSlides.entries()].map(async ([id, members]) => {
    const stored = await workspaceDb.albums.get(id);
    const savedAlbum = previousSnapshot?.albums.find((album) => album.id === id);
    return {
      id,
      name: stored?.name ?? savedAlbum?.name ?? `Media album ${id.slice(0, 8)}`,
      description: stored?.description ?? savedAlbum?.description ?? '',
      mediaIds: members.flatMap((slide) => slide.mediaUrl?.startsWith('local-background:')
        ? [slide.mediaUrl.slice('local-background:'.length)]
        : []),
      createdAt: stored?.createdAt ?? savedAlbum?.createdAt ?? 0,
      updatedAt: stored?.updatedAt ?? savedAlbum?.updatedAt ?? 0,
    };
  }));
  return { slides: scheduledSlides, mediaLibrary: { media: [...media.values()], albums } };
}

export async function isBackgroundAvailable(id: string): Promise<boolean> {
  try {
    return Boolean(await getBackgroundBlob(id));
  } catch (error) {
    console.error(`Could not resolve saved media file "${id}".`, error);
    return false;
  }
}

export async function replaceMediaFile(reference: StoredBackground, file: File): Promise<void> {
  const supportedVideoTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
  const type = supportedVideoTypes.includes(file.type.toLowerCase())
    ? 'video'
    : file.type.toLowerCase().startsWith('image/') ? 'image' : undefined;
  if (!type) throw new Error('Choose a supported image, GIF, MP4, MOV, or WebM file.');
  if (type !== reference.type) throw new Error(`Choose a ${reference.type} file to restore “${reference.name}”.`);
  if (file.size > MAX_MEDIA_FILE_SIZE_BYTES) throw new Error(`${file.name} exceeds the 200 MB per-file limit.`);

  const existing = await workspaceDb.backgrounds.get(reference.id);
  const next: StoredBackground = {
    ...reference,
    ...(existing?.albumId ? { albumId: existing.albumId } : {}),
    mimeType: file.type,
    size: file.size,
    createdAt: reference.createdAt ?? existing?.createdAt ?? Date.now(),
    purpose: 'media',
    type,
  };
  const cachedUrl = backgroundUrlCache.get(reference.id);
  if (cachedUrl) void cachedUrl.then((url) => { if (url) URL.revokeObjectURL(url); });
  backgroundUrlCache.delete(reference.id);

  if (isTauri()) {
    const fs = await import('@tauri-apps/plugin-fs');
    const directory = 'SelahStudio/Assets';
    const safeName = reference.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 160) || 'media';
    const relativePath = `${directory}/${createAssetId()}-${safeName}`;
    await fs.mkdir(directory, { baseDir: BaseDirectory.Document, recursive: true });
    try {
      await fs.writeFile(relativePath, new Uint8Array(await file.arrayBuffer()), { baseDir: BaseDirectory.Document });
      next.path = await join(await documentDir(), relativePath);
      delete next.blob;
      await workspaceDb.backgrounds.put(next);
    } catch (error) {
      try {
        if (await fs.exists(relativePath, { baseDir: BaseDirectory.Document })) {
          await fs.remove(relativePath, { baseDir: BaseDirectory.Document });
        }
      } catch (cleanupError) {
        console.error('Could not remove a partially restored media file.', cleanupError);
      }
      throw error;
    }
    if (existing?.path && existing.path !== next.path) {
      try {
        if (await fs.exists(existing.path)) await fs.remove(existing.path);
      } catch (error) {
        console.error(`Could not remove the previous file for restored media "${reference.name}".`, error);
      }
    }
    return;
  }

  next.blob = file;
  delete next.path;
  await workspaceDb.backgrounds.put(next);
}

export async function saveMediaAlbum(album: Omit<StoredMediaAlbum, 'createdAt' | 'updatedAt'> & Partial<Pick<StoredMediaAlbum, 'createdAt' | 'updatedAt'>>): Promise<StoredMediaAlbum> {
  const now = Date.now();
  const existing = await workspaceDb.albums.get(album.id);
  const next: StoredMediaAlbum = {
    ...album,
    mediaIds: [...new Set(album.mediaIds)],
    createdAt: existing?.createdAt ?? album.createdAt ?? now,
    updatedAt: now,
  };
  await workspaceDb.transaction('rw', workspaceDb.albums, workspaceDb.backgrounds, async () => {
    const records = await Promise.all(next.mediaIds.map((id) => workspaceDb.backgrounds.get(id)));
    if (records.some((record) => !record)) throw new Error('One or more album files are no longer available.');
    const previousAlbums = await workspaceDb.albums.toArray();
    for (const previous of previousAlbums) {
      if (previous.id === next.id) continue;
      const retained = previous.mediaIds.filter((id) => !next.mediaIds.includes(id));
      if (retained.length !== previous.mediaIds.length) {
        await workspaceDb.albums.put({ ...previous, mediaIds: retained, updatedAt: now });
      }
    }
    if (existing) {
      for (const id of existing.mediaIds) {
        if (next.mediaIds.includes(id)) continue;
        const record = await workspaceDb.backgrounds.get(id);
        if (record?.albumId === next.id) {
          const { albumId: _albumId, ...standalone } = record;
          await workspaceDb.backgrounds.put(standalone);
        }
      }
    }
    await workspaceDb.albums.put(next);
    for (const record of records) {
      if (record) await workspaceDb.backgrounds.put({ ...record, albumId: next.id });
    }
  });
  return next;
}

export async function moveMediaToAlbum(mediaId: string, albumId?: string): Promise<void> {
  await workspaceDb.transaction('rw', workspaceDb.albums, workspaceDb.backgrounds, async () => {
    const media = await workspaceDb.backgrounds.get(mediaId);
    if (!media) throw new Error('This media file is no longer available.');
    if (albumId && !(await workspaceDb.albums.get(albumId))) throw new Error('The selected album is no longer available.');
    const albums = await workspaceDb.albums.toArray();
    const now = Date.now();
    for (const album of albums) {
      const contains = album.mediaIds.includes(mediaId);
      const shouldContain = album.id === albumId;
      const mediaIds = shouldContain
        ? [...album.mediaIds.filter((id) => id !== mediaId), mediaId]
        : album.mediaIds.filter((id) => id !== mediaId);
      if (contains !== shouldContain) {
        await workspaceDb.albums.put({ ...album, mediaIds, updatedAt: now });
      }
    }
    await workspaceDb.backgrounds.put({ ...media, albumId });
  });
}

export async function deleteMediaAlbum(albumId: string): Promise<void> {
  await workspaceDb.transaction('rw', workspaceDb.albums, workspaceDb.backgrounds, async () => {
    const album = await workspaceDb.albums.get(albumId);
    if (!album) return;
    const records = await workspaceDb.backgrounds.where('albumId').equals(albumId).toArray();
    for (const media of records) {
      const { albumId: _albumId, ...standalone } = media;
      await workspaceDb.backgrounds.put(standalone);
    }
    await workspaceDb.albums.delete(albumId);
  });
}

export async function stashBackground(file: File, purpose: StoredBackground['purpose'] = 'background'): Promise<StoredBackground> {
  const supportedVideoTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
  const isVideo = supportedVideoTypes.includes(file.type.toLowerCase());
  if (!file.type.toLowerCase().startsWith('image/') && !isVideo) {
    throw new Error('Choose an image, GIF, MP4, MOV, or WebM file.');
  }
  if (purpose === 'media' && file.size > MAX_MEDIA_FILE_SIZE_BYTES) {
    throw new Error(`${file.name} exceeds the 200 MB per-file limit.`);
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 160) || 'media';
  const id = createAssetId();
  const item: StoredBackground = { id, name: file.name, mimeType: file.type, size: file.size, createdAt: Date.now(), purpose, type: isVideo ? 'video' : 'image' };
  if (isTauri()) {
    const fs = await import('@tauri-apps/plugin-fs');
    const directory = 'SelahStudio/Assets';
    const relativePath = `${directory}/${id}-${safeName}`;
    try {
      await fs.mkdir(directory, { baseDir: BaseDirectory.Document, recursive: true });
      await fs.writeFile(relativePath, new Uint8Array(await file.arrayBuffer()), {
        baseDir: BaseDirectory.Document,
      });
      item.path = await join(await documentDir(), directory, `${id}-${safeName}`);
      await workspaceDb.backgrounds.put(item);
      return item;
    } catch (error) {
      try {
        if (await fs.exists(relativePath, { baseDir: BaseDirectory.Document })) {
          await fs.remove(relativePath, { baseDir: BaseDirectory.Document });
        }
      } catch (cleanupError) {
        console.error('Could not remove a partially saved media file.', cleanupError);
        throw new Error(`Media upload failed and its temporary file could not be removed: ${error instanceof Error ? error.message : 'Unknown storage error.'}`);
      }
      throw error;
    }
  } else {
    item.blob = file;
  }
  await workspaceDb.backgrounds.put(item);
  return item;
}

const backgroundUrlCache = new Map<string, Promise<string | undefined>>();

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

export function getBackgroundObjectUrl(id: string): Promise<string | undefined> {
  const cached = backgroundUrlCache.get(id);
  if (cached) return cached;

  const request = getBackgroundBlob(id).then((blob) => blob ? URL.createObjectURL(blob) : undefined);
  backgroundUrlCache.set(id, request);
  void request.catch(() => backgroundUrlCache.delete(id));
  return request;
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
