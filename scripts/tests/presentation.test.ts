import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getOfflineChapterVerses } from '../../artifacts/selah-studio/src/lib/offline-bible';
import { createStartupOutput } from '../../artifacts/selah-studio/src/lib/projector-state';
import { parseLegacySongs, mergeSongLibraries } from '../../artifacts/selah-studio/src/lib/local-workspace';
import { parseSchedulePayload, serializeSchedulePayload } from '../../artifacts/selah-studio/src/lib/schedule';
import { prepareMediaDeck, routePreview } from '../../artifacts/selah-studio/src/lib/presentation';
import type { Slide, Song } from '../../artifacts/selah-studio/src/lib/studio-data';

const sampleSong: Song = {
  title: 'Sunday Song',
  author: 'Team',
  tag: 'Worship',
  lyrics: ['First verse'],
};

const sampleSlide: Slide = {
  id: 'song-1',
  title: sampleSong.title,
  label: 'Verse 1',
  kind: 'song',
  text: 'First verse',
};

test('legacy songs normalize and merge by kind and title', () => {
  const legacy = parseLegacySongs([
    { title: ' Sunday Song ', lyrics: ['First verse'] },
    { title: '', lyrics: ['ignored'] },
    { title: 'Bad lyrics', lyrics: [42] },
  ]);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0]?.kind, 'song');
  assert.equal(legacy[0]?.author, '');

  const merged = mergeSongLibraries(legacy, [{ ...sampleSong, author: 'Updated' }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.author, 'Updated');
});

test('schedule export and import preserve data and migrate legacy versionless files', () => {
  const mediaSlide: Slide = {
    id: 'media-photo',
    title: 'original-filename.jpg',
    label: 'Image',
    kind: 'media',
    text: '',
    mediaUrl: 'local-background:stable-media-id',
    mediaType: 'image',
  };
  const source = {
    name: 'Sunday Service',
    slides: [sampleSlide],
    mediaDeckSlides: [mediaSlide],
    mediaLibrary: {
      media: [{
        id: 'stable-media-id',
        name: 'original-filename.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
        createdAt: 123,
        purpose: 'media',
        albumId: 'album-1',
        type: 'image',
      }],
      albums: [{
        id: 'album-1',
        name: 'Opening set',
        description: '',
        mediaIds: ['stable-media-id'],
        createdAt: 100,
        updatedAt: 200,
      }],
    },
    song: sampleSong,
    songs: [sampleSong],
    futureField: { keep: true },
  };
  const exported = serializeSchedulePayload(source);
  const imported = parseSchedulePayload(JSON.parse(exported));

  assert.equal(imported.version, '1.0');
  assert.equal(imported.mediaDeckSlides[0]?.id, mediaSlide.id);
  assert.equal(imported.mediaDeckSlides[0]?.mediaUrl, mediaSlide.mediaUrl);
  assert.equal(imported.mediaDeckSlides[0]?.mediaAlbumId, 'album-1');
  assert.equal(imported.mediaLibrary?.media[0]?.name, 'original-filename.jpg');
  assert.deepEqual(imported.mediaLibrary?.albums[0]?.mediaIds, ['stable-media-id']);
  assert.deepEqual(imported.futureField, { keep: true });
  assert.equal(imported.song?.title, sampleSong.title);
  assert.equal(parseSchedulePayload({ slides: [sampleSlide] }).mediaLibrary, undefined);
});

test('schedule validation rejects unsupported versions and malformed slides', () => {
  assert.throws(() => parseSchedulePayload({}), /Schedule must contain slides or song data/);
  assert.throws(() => parseSchedulePayload({ version: '2.0' }), /Unsupported schedule version/);
  assert.throws(() => parseSchedulePayload({ slides: [{ kind: 'song' }] }), /slides\.0/);
});

test('offline Scripture reads bundled-format KJV data without an API', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /kjv\/Esther\.json$/);
    return new Response(JSON.stringify({
      book: 'Esther',
      chapters: [{ chapter: '8', verses: [{ verse: '9', text: 'KJV verse offline' }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    assert.deepEqual(await getOfflineChapterVerses('Esther', 8), ['KJV verse offline']);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('projector starts on the animated logo and preview only routes live when enabled', () => {
  const startup = createStartupOutput();
  assert.equal(startup.mode, 'logo');
  assert.equal(startup.slide.id, 'welcome');
  assert.equal(routePreview(sampleSlide, false).live, null);
  assert.equal(routePreview(sampleSlide, true).live, sampleSlide);
});

test('standalone media appends only to an existing standalone media deck', () => {
  const first: Slide = {
    id: 'media-one',
    title: 'One',
    label: 'Image',
    kind: 'media',
    text: '',
    mediaUrl: 'local-background:one',
    mediaType: 'image',
  };
  const second: Slide = { ...first, id: 'media-two', title: 'Two', mediaUrl: 'local-background:two' };
  const existing = prepareMediaDeck([first], [second], 'media', []);

  assert.deepEqual(existing.deck.map((slide) => slide.id), ['media-one', 'media-two']);
  assert.equal(existing.selectedIndex, 1);
  assert.equal(existing.clearOtherDeck, false);

  const afterAlbum = prepareMediaDeck([{ ...first, mediaAlbumId: 'album-one' }], [second], 'media', []);
  assert.deepEqual(afterAlbum.deck.map((slide) => slide.id), ['media-two']);
  assert.equal(afterAlbum.clearOtherDeck, true);

  const afterSong = prepareMediaDeck([first], [second], 'media', [sampleSlide]);
  assert.deepEqual(afterSong.deck.map((slide) => slide.id), ['media-two']);
  assert.equal(afterSong.clearOtherDeck, true);
});

test('album presentation always replaces the deck and preserves saved order', () => {
  const existing: Slide = {
    id: 'media-existing',
    title: 'Existing',
    label: 'Image',
    kind: 'media',
    text: '',
    mediaUrl: 'local-background:existing',
    mediaType: 'image',
  };
  const albumSlides: Slide[] = [
    { ...existing, id: 'media-second', mediaAlbumId: 'album-one' },
    { ...existing, id: 'media-first', mediaAlbumId: 'album-one' },
  ];
  const prepared = prepareMediaDeck([existing], albumSlides, 'album', []);

  assert.deepEqual(prepared.deck.map((slide) => slide.id), ['media-second', 'media-first']);
  assert.equal(prepared.selectedIndex, 0);
  assert.equal(prepared.clearOtherDeck, true);
});
