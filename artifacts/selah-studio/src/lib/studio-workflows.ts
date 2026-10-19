import fixtures from './scripture-fixtures.json';
import bibleStructure from './bible-structure.json';

type BookStructure = { chapters: number; verses: number[] };
const structureMap: Record<string, BookStructure> = bibleStructure as Record<string, BookStructure>;
const scripture: Record<string, string[][]> = fixtures;

export const bibleBooks = Object.keys(structureMap);

export function getBookStructure(book: string): BookStructure | undefined {
  const resolved = resolveBook(book) || book;
  return structureMap[resolved];
}

export function getMaxChapters(book: string): number {
  return getBookStructure(book)?.chapters ?? 150;
}

export function getMaxVerses(book: string, chapter: number | string): number {
  const struct = getBookStructure(book);
  if (!struct) return 176;
  const chIdx = Number(chapter) - 1;
  return struct.verses[chIdx] ?? 176;
}

export function matchingBooks(value: string) {
  const clean = value.trim().toLowerCase();
  if (!clean) return bibleBooks;
  return bibleBooks.filter((book) => book.toLowerCase().startsWith(clean));
}

export function resolveBook(value: string) {
  const clean = value.trim().toLowerCase();
  if (!clean) return undefined;
  const exact = bibleBooks.find((book) => book.toLowerCase() === clean);
  if (exact) return exact;
  const prefix = bibleBooks.find((book) => book.toLowerCase().startsWith(clean));
  return prefix;
}

export function getChapter(book: string, chapter: string): string[] {
  return validNumber(chapter, scripture[book]?.length ?? 0) ? scripture[book]?.[Number(chapter) - 1] ?? [] : [];
}

export function validNumber(value: string, max: number) {
  return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max;
}

export function validChapter(book: string, chapter: string) {
  const max = getMaxChapters(book);
  return validNumber(chapter, max);
}

export function validVerse(book: string, chapter: string, verse: string) {
  const max = getMaxVerses(book, chapter);
  return validNumber(verse, max);
}

export type SongSection = { text: string; chorus: boolean; formats?: import('./presentation').TextFormat[] | undefined };
export function parseSections(lyrics: string, previous: SongSection[] = []): SongSection[] {
  return lyrics.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/).filter(Boolean).map((text, index) => ({ text, chorus: previous[index]?.chorus ?? false, ...(text === previous[index]?.text && previous[index]?.formats ? {formats:previous[index]?.formats} : {}) }));
}
export function sectionHeadings(sections: SongSection[]) {
  const total = sections.filter(section => !section.chorus).length;
  let number = 0;
  return sections.map(section => section.chorus ? 'Chorus' : `${++number}/${total}:`);
}