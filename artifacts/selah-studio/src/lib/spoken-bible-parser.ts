import { getMaxVerses, bibleBooks, resolveBook } from './studio-workflows';

export interface ParsedSpokenReference {
  book: string;
  chapter: string;
  verse: string;
  reference: string;
}

/**
 * Normalizes speech transcriptions and resolves spoken artifacts (e.g. "227" -> "2-7").
 */
export function parseSpokenBibleReference(rawText: string): ParsedSpokenReference | null {
  if (!rawText || !rawText.trim()) return null;

  let text = rawText.trim().toLowerCase();

  // 1. Normalize spoken word fillers and range prepositions
  text = text
    .replace(/\bchapter\b/g, '')
    .replace(/\bchapters\b/g, '')
    .replace(/\bverses?\b/g, '')
    .replace(/\bthrough\b/g, '-')
    .replace(/\bthru\b/g, '-')
    .replace(/\btill\b/g, '-')
    .replace(/\buntil\b/g, '-')
    .replace(/\bto\b/g, '-')
    .replace(/\bndash\b/g, '-')
    .replace(/\bminus\b/g, '-')
    .replace(/\bcolon\b/g, ':')
    .replace(/\s+/g, ' ')
    .trim();

  // 2. Resolve target Bible book
  let matchedBook = '';
  let remaining = '';

  // Sort books by length descending so "1 John" matches before "John"
  const sortedBooks = [...bibleBooks].sort((a, b) => b.length - a.length);

  for (const b of sortedBooks) {
    const bLower = b.toLowerCase();
    let pattern = bLower;

    if (bLower.startsWith('1 ')) {
      const rest = bLower.slice(2);
      pattern = `(1|1st|first|one) ${rest}`;
    } else if (bLower.startsWith('2 ')) {
      const rest = bLower.slice(2);
      pattern = `(2|2nd|second|two) ${rest}`;
    } else if (bLower.startsWith('3 ')) {
      const rest = bLower.slice(2);
      pattern = `(3|3rd|third|three) ${rest}`;
    } else if (bLower === 'psalms' || bLower === 'psalm') {
      pattern = '(psalms|psalm|psa)';
    }

    const regex = new RegExp(`^${pattern}\\b`, 'i');
    if (regex.test(text)) {
      matchedBook = b;
      remaining = text.replace(regex, '').trim();
      break;
    }
  }

  // Fallback book matcher if direct match didn't catch alias
  if (!matchedBook) {
    const words = text.split(' ');
    for (let i = Math.min(words.length, 3); i >= 1; i--) {
      const candidate = words.slice(0, i).join(' ');
      const resolved = resolveBook(candidate);
      if (resolved) {
        matchedBook = resolved;
        remaining = words.slice(i).join(' ').trim();
        break;
      }
    }
  }

  if (!matchedBook) return null;

  // 3. Extract chapter & verse strings
  remaining = remaining.replace(/[:\s-]+/g, ' ').trim();

  if (!remaining) {
    return {
      book: matchedBook,
      chapter: '1',
      verse: '1',
      reference: `${matchedBook === 'Psalms' ? 'Psalm' : matchedBook} 1:1`,
    };
  }

  const tokens = remaining.split(' ').filter(Boolean);
  let chapter = '1';
  let rawVerseStr = '1';

  if (tokens.length === 1) {
    const token = tokens[0]!;
    if (token.includes('-')) {
      const parts = token.split('-');
      chapter = parts[0] || '1';
      rawVerseStr = parts[1] || '1';
    } else {
      const num = parseInt(token, 10);
      if (!isNaN(num)) {
        if (num <= 150) {
          chapter = String(num);
          rawVerseStr = '1';
        } else {
          // Token is concatenated (e.g. "1227" -> Chapter 1, Verse 227)
          chapter = token.charAt(0);
          rawVerseStr = token.slice(1);
        }
      }
    }
  } else if (tokens.length >= 2) {
    chapter = tokens[0]!;
    rawVerseStr = tokens.slice(1).join('-');
  }

  chapter = chapter.replace(/\D/g, '') || '1';
  let verseStr = rawVerseStr.replace(/[^\d-]/g, '').trim();

  // 4. Speech Recognition Artifact Resolver (e.g. "227" -> "2-7", "125" -> "1-5", "428" -> "4-8")
  const maxVerseCount = getMaxVerses(matchedBook, chapter);

  if (/^\d{3,4}$/.test(verseStr)) {
    const numVal = parseInt(verseStr, 10);

    // If verse exceeds chapter bounds, untangle the phonetic concatenation
    if (numVal > maxVerseCount) {
      if (verseStr.length === 3) {
        const d1 = parseInt(verseStr[0]!, 10);
        const d2 = parseInt(verseStr[1]!, 10);
        const d3 = parseInt(verseStr[2]!, 10);

        // Pattern: d2 === 2 (phonetic 'to') and d1 < d3 (e.g., 2-2-7 -> 2-7)
        if (d2 === 2 && d1 < d3) {
          verseStr = `${d1}-${d3}`;
        } else if (d1 < d2 * 10 + d3 && d2 * 10 + d3 <= maxVerseCount) {
          verseStr = `${d1}-${d2}${d3}`;
        } else if (d1 * 10 + d2 < d3) {
          verseStr = `${d1}${d2}-${d3}`;
        }
      } else if (verseStr.length === 4) {
        const d1 = parseInt(verseStr[0]!, 10);
        const d2 = parseInt(verseStr[1]!, 10);
        const d12 = parseInt(verseStr.slice(0, 2), 10);
        const d34 = parseInt(verseStr.slice(2), 10);

        if (d2 === 2 && d1 < d34) {
          verseStr = `${d1}-${d34}`;
        } else if (d12 < d34 && d34 <= maxVerseCount) {
          verseStr = `${d12}-${d34}`;
        }
      }
    }
  }

  // Ensure range start is smaller than end
  if (verseStr.includes('-')) {
    const [start, end] = verseStr.split('-').map((v) => parseInt(v, 10));
    if (start && end && start > end) {
      verseStr = `${end}-${start}`;
    }
  }

  if (!verseStr) verseStr = '1';

  const canonicalBookName = matchedBook === 'Psalms' ? 'Psalm' : matchedBook;
  const reference = `${canonicalBookName} ${chapter}:${verseStr}`;

  return {
    book: matchedBook,
    chapter,
    verse: verseStr,
    reference,
  };
}