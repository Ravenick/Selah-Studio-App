import { resolveBook } from './studio-workflows';
import type { CachedPassage } from './local-workspace';

export type KjvVerse = { verse: string; text: string };
export type KjvChapter = { chapter: string; verses: KjvVerse[] };
export type KjvBookData = { book: string; chapters: KjvChapter[] };

export type SearchVerseResult = {
  reference: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
};

const bookCache = new Map<string, KjvBookData>();
let booksListCache: string[] | null = null;

// Canonical map for file lookup in /kjv/
const BOOK_FILE_NAMES: Record<string, string> = {
  Genesis: 'Genesis',
  Exodus: 'Exodus',
  Leviticus: 'Leviticus',
  Numbers: 'Numbers',
  Deuteronomy: 'Deuteronomy',
  Joshua: 'Joshua',
  Judges: 'Judges',
  Ruth: 'Ruth',
  '1 Samuel': '1 Samuel',
  '2 Samuel': '2 Samuel',
  '1 Kings': '1 Kings',
  '2 Kings': '2 Kings',
  '1 Chronicles': '1 Chronicles',
  '2 Chronicles': '2 Chronicles',
  Ezra: 'Ezra',
  Nehemiah: 'Nehemiah',
  Esther: 'Esther',
  Job: 'Job',
  Psalms: 'Psalms',
  Proverbs: 'Proverbs',
  Ecclesiastes: 'Ecclesiastes',
  'Song of Solomon': 'Song of Solomon',
  Isaiah: 'Isaiah',
  Jeremiah: 'Jeremiah',
  Lamentations: 'Lamentations',
  Ezekiel: 'Ezekiel',
  Daniel: 'Daniel',
  Hosea: 'Hosea',
  Joel: 'Joel',
  Amos: 'Amos',
  Obadiah: 'Obadiah',
  Jonah: 'Jonah',
  Micah: 'Micah',
  Nahum: 'Nahum',
  Habakkuk: 'Habakkuk',
  Zephaniah: 'Zephaniah',
  Haggai: 'Haggai',
  Zechariah: 'Zechariah',
  Malachi: 'Malachi',
  Matthew: 'Matthew',
  Mark: 'Mark',
  Luke: 'Luke',
  John: 'John',
  Acts: 'Acts',
  Romans: 'Romans',
  '1 Corinthians': '1 Corinthians',
  '2 Corinthians': '2 Corinthians',
  Galatians: 'Galatians',
  Ephesians: 'Ephesians',
  Philippians: 'Philippians',
  Colossians: 'Colossians',
  '1 Thessalonians': '1 Thessalonians',
  '2 Thessalonians': '2 Thessalonians',
  '1 Timothy': '1 Timothy',
  '2 Timothy': '2 Timothy',
  Titus: 'Titus',
  Philemon: 'Philemon',
  Hebrews: 'Hebrews',
  James: 'James',
  '1 Peter': '1 Peter',
  '2 Peter': '2 Peter',
  '1 John': '1 John',
  '2 John': '2 John',
  '3 John': '3 John',
  Jude: 'Jude',
  Revelation: 'Revelation',
};

export async function getBookList(): Promise<string[]> {
  if (booksListCache) return booksListCache;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}kjv/Books.json`);
    if (res.ok) {
      booksListCache = (await res.json()) as string[];
      return booksListCache;
    }
  } catch {
    // fallback
  }
  booksListCache = Object.keys(BOOK_FILE_NAMES);
  return booksListCache;
}

export async function loadOfflineBook(bookName: string): Promise<KjvBookData | null> {
  const canonical = resolveBook(bookName) || bookName;
  if (bookCache.has(canonical)) return bookCache.get(canonical)!;

  const fileName = BOOK_FILE_NAMES[canonical] || canonical;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}kjv/${encodeURIComponent(fileName)}.json`);
    if (!res.ok) return null;
    const data = (await res.json()) as KjvBookData;
    bookCache.set(canonical, data);
    return data;
  } catch {
    return null;
  }
}

export type SequenceVerseItem = {
  verseNumber: number;
  text: string;
  reference: string;
};

export async function fetchChapterVersesSequence(
  book: string,
  chapter: number | string,
): Promise<SequenceVerseItem[]> {
  const canonical = resolveBook(book) || book;
  const bookData = await loadOfflineBook(canonical);
  if (!bookData) return [];
  const chData = bookData.chapters.find((c) => Number(c.chapter) === Number(chapter));
  if (!chData) return [];
  return chData.verses.map((v) => ({
    verseNumber: Number(v.verse),
    text: v.text,
    reference: `${canonical} ${chapter}:${v.verse}`,
  }));
}

export async function getOfflineChapterVerses(book: string, chapter: number | string): Promise<string[]> {
  const bookData = await loadOfflineBook(book);
  if (!bookData) return [];
  const chStr = String(chapter);
  const chapterData = bookData.chapters.find((c) => c.chapter === chStr);
  if (!chapterData) return [];
  return chapterData.verses.map((v) => v.text);
}

export async function fetchOfflinePassage(
  book: string,
  chapter: number | string,
  requestedVerses?: number[],
): Promise<CachedPassage | null> {
  const canonical = resolveBook(book) || book;
  const bookData = await loadOfflineBook(canonical);
  if (!bookData) return null;

  const chNum = Number(chapter);
  const chData = bookData.chapters.find((c) => Number(c.chapter) === chNum);
  if (!chData) return null;

  const totalVerses = chData.verses.length;
  const numbers = requestedVerses && requestedVerses.length > 0
    ? requestedVerses.filter((n) => n >= 1 && n <= totalVerses)
    : chData.verses.map((_, i) => i + 1);

  if (!numbers.length) return null;

  const selectedVerses = numbers.map((n) => chData.verses[n - 1]?.text ?? '');
  const first = numbers[0] ?? 1;
  const last = numbers[numbers.length - 1] ?? first;
  const refTitle = `${canonical === 'Psalms' ? 'Psalm' : canonical} ${chNum}:${first}${first === last ? '' : `-${last}`}`;

  return {
    bibleId: 'de4e12af7f28f599-01',
    book: canonical,
    chapter: chNum,
    reference: refTitle,
    verses: selectedVerses,
    verseNumbers: numbers,
    copyright: 'Public Domain (King James Version)',
  };
}

// Popular primary books for fast search prioritization
const PRIORITY_BOOKS = [
  'John', 'Psalms', 'Romans', 'Genesis', 'Matthew', 'Proverbs',
  '1 Corinthians', 'Ephesians', 'Philippians', 'Hebrews', 'Isaiah', 'Revelation',
];

export async function searchOfflineBible(query: string, limit = 12): Promise<SearchVerseResult[]> {
  const clean = query.trim().toLowerCase();
  if (clean.length < 2) return [];

  // 1. Check if user typed a direct reference like "John 3:16" or "Ps 23:1-4"
  const refMatch = /^([1-3]?\s*[a-zA-Z\s]+)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/.exec(query.trim());
  if (refMatch) {
    const rawBook = refMatch[1]?.trim() ?? '';
    const canonical = resolveBook(rawBook);
    if (canonical) {
      const chapter = Number(refMatch[2]);
      const bookData = await loadOfflineBook(canonical);
      if (bookData) {
        const chData = bookData.chapters.find((c) => Number(c.chapter) === chapter);
        if (chData) {
          const startV = refMatch[3] ? Number(refMatch[3]) : 1;
          const endV = refMatch[4] ? Number(refMatch[4]) : refMatch[3] ? startV : chData.verses.length;
          const slice = chData.verses.filter((v) => {
            const num = Number(v.verse);
            return num >= startV && num <= endV;
          });
          return slice.slice(0, limit).map((v) => ({
            reference: `${canonical} ${chapter}:${v.verse}`,
            book: canonical,
            chapter,
            verse: Number(v.verse),
            text: v.text,
          }));
        }
      }
    }
  }

  // 2. Full-text keyword search across priority books first, then remaining
  const allBooks = await getBookList();
  const searchOrder = [
    ...PRIORITY_BOOKS.filter((b) => allBooks.includes(b)),
    ...allBooks.filter((b) => !PRIORITY_BOOKS.includes(b)),
  ];

  const results: SearchVerseResult[] = [];
  const words = clean.split(/\s+/).filter(Boolean);

  for (const book of searchOrder) {
    if (results.length >= limit) break;
    const data = await loadOfflineBook(book);
    if (!data) continue;

    for (const ch of data.chapters) {
      if (results.length >= limit) break;
      const chapterNum = Number(ch.chapter);
      for (const v of ch.verses) {
        const lowerText = v.text.toLowerCase();
        // check if all words match or the full phrase matches
        const isMatch = lowerText.includes(clean) || (words.length > 1 && words.every((w) => lowerText.includes(w)));
        if (isMatch) {
          results.push({
            reference: `${book} ${chapterNum}:${v.verse}`,
            book,
            chapter: chapterNum,
            verse: Number(v.verse),
            text: v.text,
          });
          if (results.length >= limit) break;
        }
      }
    }
  }

  return results;
}
