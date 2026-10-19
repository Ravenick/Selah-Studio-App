import { resolveBook, bibleBooks, getMaxChapters, getMaxVerses } from './studio-workflows';

const WORD_TO_NUMBER: Record<string, number> = {
  zero: 0,
  one: 1,
  first: 1,
  two: 2,
  second: 2,
  three: 3,
  third: 3,
  four: 4,
  fourth: 4,
  five: 5,
  fifth: 5,
  six: 6,
  sixth: 6,
  seven: 7,
  seventh: 7,
  eight: 8,
  eighth: 8,
  nine: 9,
  ninth: 9,
  ten: 10,
  tenth: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

// Convert number phrases like "twenty three" or "one hundred" into digits
export function wordsToNumbersInString(text: string): string {
  let cleaned = text
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Handle compound tens and ones like "twenty three" -> "23"
  const tens = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const ones = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

  for (let t = 0; t < tens.length; t++) {
    const tenVal = (t + 2) * 10;
    const tenWord = tens[t];
    for (let o = 0; o < ones.length; o++) {
      const oneVal = o + 1;
      const oneWord = ones[o];
      const pattern = new RegExp(`\\b${tenWord}\\s+${oneWord}\\b`, 'gi');
      cleaned = cleaned.replace(pattern, String(tenVal + oneVal));
    }
    cleaned = cleaned.replace(new RegExp(`\\b${tenWord}\\b`, 'gi'), String(tenVal));
  }

  // Handle single words
  for (const [word, val] of Object.entries(WORD_TO_NUMBER)) {
    cleaned = cleaned.replace(new RegExp(`\\b${word}\\b`, 'gi'), String(val));
  }

  return cleaned;
}

export type ParsedSpokenReference = {
  raw: string;
  book: string;
  chapter: string;
  verse: string;
  reference: string;
};

export function parseSpokenBibleReference(transcript: string): ParsedSpokenReference | null {
  if (!transcript || transcript.trim().length < 2) return null;

  let norm = transcript
    .replace(/\b(first|1st)\s+(samuel|kings|chronicles|corinthians|thessalonians|timothy|peter|john)\b/gi, '1 $2')
    .replace(/\b(second|2nd)\s+(samuel|kings|chronicles|corinthians|thessalonians|timothy|peter|john)\b/gi, '2 $2')
    .replace(/\b(third|3rd)\s+(john)\b/gi, '3 $1');

  norm = wordsToNumbersInString(norm);

  // Normalize punctuation and keywords
  norm = norm
    .replace(/\bchapter\b/gi, '')
    .replace(/\bverses?\b/gi, '')
    .replace(/\b(through|thru|to|till|until)\b/gi, '-')
    .replace(/\s*:\s*/g, ':')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  // Pattern A: Book Name + Chapter : Verse[-Verse] (e.g. "John 3:16", "John 3:16-18")
  // Pattern B: Book Name + Chapter + Verse[-Verse] (e.g. "John 3 16", "John 3 16-18", "John 3 1-7")
  // Pattern C: Book Name + Chapter (e.g. "Psalm 23")

  // Sort canonical books by length descending to match multi-word books first
  const sortedBooks = [...bibleBooks].sort((a, b) => b.length - a.length);

  for (const candidateBook of sortedBooks) {
    const bookRegex = new RegExp(`(?:^|\\b)${candidateBook.replace(/\s+/g, '\\s+')}\\b`, 'i');
    const match = bookRegex.exec(norm);
    if (!match) continue;

    const after = norm.slice(match.index + match[0].length).trim();

    // Check for chapter:verse[-verse]
    const chColonVerse = /^(\d+):(\d+(?:-\d+)?)/.exec(after);
    if (chColonVerse) {
      const ch = chColonVerse[1]!;
      const v = chColonVerse[2]!;
      return {
        raw: transcript,
        book: candidateBook,
        chapter: ch,
        verse: v,
        reference: `${candidateBook} ${ch}:${v}`,
      };
    }

    // Check for chapter + verse[-verse] (e.g. "3 16" or "2 1-7")
    const chSpaceVerse = /^(\d+)\s+(\d+(?:-\d+)?)/.exec(after);
    if (chSpaceVerse) {
      const ch = chSpaceVerse[1]!;
      const v = chSpaceVerse[2]!;
      return {
        raw: transcript,
        book: candidateBook,
        chapter: ch,
        verse: v,
        reference: `${candidateBook} ${ch}:${v}`,
      };
    }

    // Check for chapter alone (e.g. "23")
    const chOnly = /^(\d+)/.exec(after);
    if (chOnly) {
      const ch = chOnly[1]!;
      return {
        raw: transcript,
        book: candidateBook,
        chapter: ch,
        verse: '1',
        reference: `${candidateBook} ${ch}:1`,
      };
    }
  }

  // Fallback: search if user said a book name alone
  for (const candidateBook of sortedBooks) {
    if (norm.toLowerCase().includes(candidateBook.toLowerCase())) {
      return {
        raw: transcript,
        book: candidateBook,
        chapter: '1',
        verse: '1',
        reference: `${candidateBook} 1:1`,
      };
    }
  }

  return null;
}
