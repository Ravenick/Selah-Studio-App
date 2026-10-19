import type { Song } from './studio-data';

export type PublicHymn = Song & {
  id: string;
  source: 'Open Hymnal Project';
  license: 'Public domain';
};

const PUBLIC_DOMAIN_COPYRIGHT = /copyright\s*:\s*public\s+domain\b/i;
let catalogPromise: Promise<PublicHymn[]> | null = null;

function cleanText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function parseHymn(entry: Element, index: number): PublicHymn | null {
  const title = cleanText(entry.querySelector('h3')?.textContent);
  const paragraphs = Array.from(entry.querySelectorAll(':scope > p'));
  const credits = paragraphs.find((paragraph) =>
    PUBLIC_DOMAIN_COPYRIGHT.test(paragraph.textContent ?? ''),
  );
  if (!title || !credits || !PUBLIC_DOMAIN_COPYRIGHT.test(credits.textContent ?? '')) {
    return null;
  }

  const lyrics: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph === credits || paragraph.querySelector('img, scripRef')) break;
    const text = cleanText(paragraph.textContent);
    if (!text || /^(words|music|setting)\s*:/i.test(text)) break;
    lyrics.push(text.replace(/^\d+[\.\)]\s*/, ''));
  }
  if (!lyrics.length) return null;

  const author = cleanText(
    (credits.textContent ?? '')
      .split(/music\s*:|setting\s*:|copyright\s*:/i)[0]
      ?.replace(/^.*?words\s*:\s*/i, ''),
  );
  const slug = entry.getAttribute('title') || `hymn-${index}`;

  return {
    id: `${slug}-${index}`,
    title,
    author: author || 'Open Hymnal contributor',
    tag: 'Public-domain hymn',
    kind: 'song',
    lyrics,
    sections: lyrics.map((text) => ({ text, chorus: false })),
    source: 'Open Hymnal Project',
    license: 'Public domain',
  };
}

async function loadPublicHymns() {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const response = await fetch(`${import.meta.env.BASE_URL}openhymnal.201406.xml`);
      if (!response.ok) {
        throw new Error(`The offline hymn catalog could not be loaded (${response.status}).`);
      }

      const xml = (await response.text())
        .replace(/<!DOCTYPE[^>]*>/i, '')
        .replace(/&mdash;/g, '—');
      const document = new DOMParser().parseFromString(xml, 'application/xml');
      if (document.getElementsByTagName('parsererror').length) {
        throw new Error('The offline hymn catalog could not be read.');
      }

      return Array.from(document.getElementsByTagName('div3'))
        .map((entry, index) => parseHymn(entry, index))
        .filter((hymn): hymn is PublicHymn => hymn !== null);
    })().catch((error: unknown) => {
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function searchPublicHymns(query: string, limit = 8) {
  const term = normalize(query);
  if (term.length < 2) return [];

  const hymns = await loadPublicHymns();
  return hymns
    .map((hymn) => {
      const title = normalize(hymn.title);
      const author = normalize(hymn.author);
      const lyrics = normalize(hymn.lyrics.join(' '));
      const score = title.startsWith(term)
        ? 3
        : title.includes(term)
          ? 2
          : author.includes(term) || lyrics.includes(term)
            ? 1
            : 0;
      return { hymn, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.hymn.title.localeCompare(b.hymn.title))
    .slice(0, limit)
    .map(({ hymn }) => hymn);
}
