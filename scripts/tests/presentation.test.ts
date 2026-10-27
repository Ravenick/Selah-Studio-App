import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getOfflineChapterVerses } from '../../artifacts/selah-studio/src/lib/offline-bible';
import { createStartupOutput } from '../../artifacts/selah-studio/src/lib/projector-state';
import { parseLegacySongs, mergeSongLibraries } from '../../artifacts/selah-studio/src/lib/local-workspace';
import { parseSchedulePayload, serializeSchedulePayload } from '../../artifacts/selah-studio/src/lib/schedule';
import { routePreview } from '../../artifacts/selah-studio/src/lib/presentation';
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
  const source = {
    name: 'Sunday Service',
    slides: [sampleSlide],
    song: sampleSong,
    songs: [sampleSong],
    futureField: { keep: true },
  };
  const exported = serializeSchedulePayload(source);
  const imported = parseSchedulePayload(JSON.parse(exported));

  assert.equal(imported.version, '1.0');
  assert.equal(imported.mediaDeckSlides[0]?.id, sampleSlide.id);
  assert.deepEqual(imported.futureField, { keep: true });
  assert.equal(imported.song?.title, sampleSong.title);
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
