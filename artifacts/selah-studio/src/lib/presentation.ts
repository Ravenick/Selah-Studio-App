import type { Slide } from './studio-data';

export type TextFormat = { start: number; end: number; color?: string | undefined; font?: string | undefined; size?: number | undefined; bold?: boolean | undefined };
export const SAFE_SCRIPTURE_CHARACTERS = 280;
export function parseVerseRange(value: string, max: number): number[] | null {
  const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]), end = Number(match[2] ?? match[1]);
  if (start < 1 || end < start || end > max) return null;
  return Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
}
export function compileScripture(book: string, chapter: string, verses: string[], indexes: number[]): Slide[] {
  const pages: { number: number; text: string }[][] = [];
  let page: { number: number; text: string }[] = [], length = 0;
  for (const index of [...new Set(indexes)].sort((a,b) => a-b)) {
    const text = verses[index];
    if (!text) continue;
    // Split unusually long individual verses at word boundaries too.
    const words = text.split(/\s+/); let chunk = '';
    const chunks: string[] = [];
    for (const word of words) { if (chunk && chunk.length + word.length + 1 > SAFE_SCRIPTURE_CHARACTERS - 12) { chunks.push(chunk); chunk = ''; } chunk += `${chunk ? ' ' : ''}${word}`; }
    if (chunk) chunks.push(chunk);
    for (const part of chunks) {
      if (page.length && length + part.length + 12 > SAFE_SCRIPTURE_CHARACTERS) { pages.push(page); page = []; length = 0; }
      page.push({ number: index + 1, text: part }); length += part.length + 12;
    }
  }
  if (page.length) pages.push(page);
  return pages.map((items, i) => {
    const first = items[0]?.number, last = items.at(-1)?.number;
    const title = `${book === 'Psalms' ? 'Psalm' : book} ${chapter}:${first}${last !== first ? `-${last}` : ''}`;
    return { id: `${book}-${chapter}-${indexes.join('-')}-page-${i}`, title, label: pages.length > 1 ? `Passage · ${i+1}/${pages.length}` : 'Passage', kind: 'scripture', text: items.map(item => item.text).join(' '), verses: items };
  });
}
export function routePreview(slide: Slide, autoPush: boolean) { return { preview: slide, live: autoPush ? slide : null }; }