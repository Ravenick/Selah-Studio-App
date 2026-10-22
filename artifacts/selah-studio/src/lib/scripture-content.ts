export type ParsedBibleContent = { verses: string[]; verseNumbers: number[] };

export function parseBibleContent(content: unknown): ParsedBibleContent {
  if (typeof content !== 'string') {
    throw new Error('The scripture service returned a passage without readable text. Check the API service and selected translation access.');
  }
  const plainText = content
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(?:p|div|article|section)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim();
  const markers = Array.from(plainText.matchAll(/\[(\d+)\]\s*/g));
  if (markers.length) {
    const verses: string[] = [];
    const verseNumbers: number[] = [];
    markers.forEach((marker, index) => {
      const number = Number(marker[1]);
      const start = (marker.index ?? 0) + marker[0].length;
      const end = markers[index + 1]?.index ?? plainText.length;
      const text = plainText.slice(start, end).replace(/\s+/g, ' ').trim();
      if (Number.isInteger(number) && number > 0 && text) {
        verses.push(text);
        verseNumbers.push(number);
      }
    });
    return { verses, verseNumbers };
  }

  // This fallback accommodates text responses from API.Bible that omit
  // bracketed verse markers while retaining one verse per line.
  const lines = plainText
    .split(/\n+/)
    .map(line => line.replace(/^\d+\s+/, '').trim())
    .filter(Boolean);
  return {
    verses: lines.length ? lines : plainText ? [plainText] : [],
    verseNumbers: lines.map((_, index) => index + 1),
  };
}
