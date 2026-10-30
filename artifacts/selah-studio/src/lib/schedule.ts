import { z } from 'zod';
import type { Slide, Song } from './studio-data';
import type { ScheduleMediaSnapshot } from './local-workspace';

const textFormatSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  color: z.string().optional(),
  font: z.string().optional(),
  size: z.number().finite().positive().optional(),
  bold: z.boolean().optional(),
}).passthrough().refine((format) => format.end > format.start, 'Format end must be after its start');

const headerStyleSchema = z.object({
  weight: z.enum(['400', '500', '600', '700']),
  size: z.number().finite().positive(),
  color: z.string(),
  font: z.string(),
  showMarker: z.boolean().optional(),
}).passthrough();

const sectionSchema = z.object({
  text: z.string(),
  chorus: z.boolean(),
  formats: z.array(textFormatSchema).optional(),
}).passthrough();

const songSchema = z.object({
  title: z.string().trim().min(1).max(300),
  author: z.string().default(''),
  tag: z.string().default(''),
  lyrics: z.array(z.string()).default([]),
  kind: z.enum(['song', 'sermon']).optional(),
  sections: z.array(sectionSchema).optional(),
  background: z.string().optional(),
  backgroundType: z.enum(['image', 'video']).optional(),
  headerStyle: headerStyleSchema.optional(),
  sermonText: z.string().optional(),
  slideBreaks: z.array(z.number().int().nonnegative()).optional(),
}).passthrough();

const slideSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  label: z.string(),
  kind: z.enum(['song', 'scripture', 'media', 'sermon']),
  title: z.string(),
  background: z.string().optional(),
  backgroundType: z.enum(['image', 'video']).optional(),
  heading: z.string().optional(),
  headingStyle: headerStyleSchema.optional(),
  chorus: z.boolean().optional(),
  verses: z.array(z.object({ number: z.number().int().positive(), text: z.string() }).passthrough()).optional(),
  formats: z.array(textFormatSchema).optional(),
  mediaUrl: z.string().optional(),
  mediaType: z.enum(['image', 'video', 'youtube']).optional(),
  mediaAlbumId: z.string().optional(),
  audioMuted: z.boolean().optional(),
  youtubeUrl: z.string().optional(),
}).passthrough();

const scheduleMediaSchema = z.object({
  media: z.array(z.object({
    id: z.string().min(1),
    name: z.string(),
    mimeType: z.string().optional(),
    size: z.number().nonnegative().optional(),
    createdAt: z.number().nonnegative().optional(),
    purpose: z.enum(['background', 'media']).optional(),
    albumId: z.string().optional(),
    type: z.enum(['image', 'video']),
  }).passthrough()),
  albums: z.array(z.object({
    id: z.string().min(1),
    name: z.string(),
    description: z.string(),
    mediaIds: z.array(z.string()),
    createdAt: z.number().nonnegative(),
    updatedAt: z.number().nonnegative(),
  }).passthrough()),
}).passthrough();

const scheduleSchema = z.object({
  version: z.literal('1.0').optional(),
  timestamp: z.string().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  slides: z.array(slideSchema).optional(),
  mediaDeckSlides: z.array(slideSchema).optional(),
  mediaLibrary: scheduleMediaSchema.optional(),
  song: songSchema.nullable().optional(),
  songs: z.array(songSchema).optional(),
  scriptureBackground: z.string().optional(),
  mediaBackground: z.string().optional(),
  mediaBackgroundType: z.enum(['image', 'video']).optional(),
  scriptureBackgroundType: z.enum(['image', 'video']).optional(),
  backgroundDim: z.number().finite().min(0).max(100).optional(),
}).passthrough().refine((schedule) =>
  schedule.slides !== undefined
  || schedule.mediaDeckSlides !== undefined
  || schedule.song !== undefined
  || schedule.songs !== undefined,
'Schedule must contain slides or song data');

export type SchedulePayload = {
  version: '1.0';
  timestamp: string;
  name: string;
  slides: Slide[];
  mediaDeckSlides: Slide[];
  mediaLibrary?: ScheduleMediaSnapshot;
  song: Song | null;
  songs: Song[];
  scriptureBackground?: string;
  mediaBackground?: string;
  mediaBackgroundType?: 'image' | 'video';
  scriptureBackgroundType?: 'image' | 'video';
  backgroundDim?: number;
  [key: string]: unknown;
};

export function parseSchedulePayload(value: unknown): SchedulePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid schedule file: expected a JSON object.');
  }

  const raw = value as Record<string, unknown>;
  if (raw.version !== undefined && raw.version !== '1.0') {
    throw new Error(`Unsupported schedule version: ${String(raw.version)}.`);
  }

  const parsed = scheduleSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.slice(0, 4).map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : 'schedule';
      return `${path}: ${issue.message}`;
    });
    throw new Error(`Invalid schedule file: ${details.join('; ')}.`);
  }

  const data = parsed.data;
  const slides = data.slides ?? [];
  const song = data.song ?? data.songs?.[0] ?? null;
  const songs = data.songs?.length ? data.songs : song ? [song] : [];
  const mediaItems = new Map((data.mediaLibrary?.media ?? []).map((item) => [item.id, item]));
  const mediaDeckSlides = (data.mediaDeckSlides ?? slides).map((slide) => {
    if (slide.kind !== 'media' || !slide.mediaUrl?.startsWith('local-background:') || slide.mediaAlbumId) return slide;
    const id = slide.mediaUrl.slice('local-background:'.length);
    const albumId = mediaItems.get(id)?.albumId;
    return albumId ? { ...slide, mediaAlbumId: albumId } : slide;
  });
  const timestamp = data.timestamp && Number.isFinite(Date.parse(data.timestamp))
    ? data.timestamp
    : new Date().toISOString();

  return {
    ...data,
    version: '1.0',
    timestamp,
    name: data.name ?? 'Imported Service',
    slides: slides as Slide[],
    mediaDeckSlides: mediaDeckSlides as Slide[],
    song: song as Song | null,
    songs: songs as Song[],
  };
}

export function serializeSchedulePayload(value: unknown): string {
  return JSON.stringify(parseSchedulePayload(value), null, 2);
}