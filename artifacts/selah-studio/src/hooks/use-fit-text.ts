import { useLayoutEffect, useState, type RefObject } from 'react';

type FitTextOptions = {
  boundaryRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  contentKey: string;
  enabled?: boolean;
  minFont?: number;
  minFontRatio?: number;
  maxFont?: number;
  maxFontRatio?: number;
};

const EPSILON = 0;

/**
 * Finds the largest readable font size that fits every wrapped line inside the
 * supplied boundary. The hidden copy keeps the slide's CSS context so font,
 * weight, verse markers, and line-height match the visible output.
 */
export function useFitText({
  boundaryRef,
  contentRef,
  contentKey,
  enabled = true,
  minFont = 12,
  minFontRatio,
  maxFont,
  maxFontRatio = 0.075,
}: FitTextOptions) {
  const [fontSize, setFontSize] = useState(maxFont ?? 16.9);

  useLayoutEffect(() => {
    if (!enabled) return;
    const boundary = boundaryRef.current;
    const content = contentRef.current;
    if (!boundary || !content) return;

    let frame = 0;
    let disposed = false;

    const fit = () => {
      if (disposed) return;
      const screen = boundary.closest<HTMLElement>('.slide-screen');
      const copy = content.closest<HTMLElement>('.screen-copy');
      if (!screen || !copy) return;

      const probeCopy = copy.cloneNode(true) as HTMLElement;
      probeCopy.style.setProperty('animation', 'none', 'important');
      probeCopy.style.setProperty('transition', 'none', 'important');
      probeCopy.style.setProperty('visibility', 'hidden', 'important');
      probeCopy.style.setProperty('pointer-events', 'none', 'important');
      screen.appendChild(probeCopy);

      try {
        const probeBoundary = probeCopy.querySelector<HTMLElement>('.slide-text-boundary');
        const probeText = probeBoundary?.querySelector<HTMLElement>(':scope > p');
        if (!probeBoundary || !probeText) return;

        const width = probeBoundary.clientWidth;
        const height = probeBoundary.clientHeight;
        if (!width || !height) return;

        const fits = (candidate: number) => {
          probeText.style.setProperty('animation', 'none', 'important');
          probeText.style.setProperty('transition', 'none', 'important');
          probeText.style.setProperty('font-size', `${candidate}px`, 'important');
          probeText.style.setProperty('max-width', '100%', 'important');
          probeText.style.setProperty('width', '100%', 'important');

          const boundaryRect = probeBoundary.getBoundingClientRect();
          const textRect = probeText.getBoundingClientRect();
          const withinBoundary =
            textRect.top >= boundaryRect.top - EPSILON &&
            textRect.left >= boundaryRect.left - EPSILON &&
            textRect.bottom <= boundaryRect.bottom + EPSILON &&
            textRect.right <= boundaryRect.right + EPSILON;
          const noOverflow = probeText.scrollHeight <= Math.ceil(textRect.height + 1) && probeText.scrollWidth <= Math.ceil(textRect.width + 1);
          return noOverflow && withinBoundary;
        };

        const targetMax = maxFont ?? Math.min(120, width * maxFontRatio);
        const search = (floor: number, ceiling: number) => {
          let low = floor;
          let high = ceiling;
          let best = 0;
          for (let pass = 0; pass < 18; pass += 1) {
            const candidate = (low + high) / 2;
            if (fits(candidate)) {
              best = candidate;
              low = candidate;
            } else {
              high = candidate;
            }
          }
          return best;
        };

        const lowerBound = minFontRatio === undefined ? Math.max(1, minFont) : Math.max(1, width * minFontRatio);
        const upperBound = Math.max(lowerBound, targetMax);
        const baselineFits = fits(lowerBound);
        const best = baselineFits ? search(lowerBound, upperBound) || lowerBound : search(1, lowerBound) || 1;
        const next = Math.max(1, Math.floor(best * 10) / 10);
        setFontSize((current) => (Math.abs(current - next) < 0.1 ? current : next));
      } finally {
        probeCopy.remove();
      }
    };

    const scheduleFit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };

    fit();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleFit);
    observer?.observe(boundary);
    void document.fonts?.ready.then(scheduleFit);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [boundaryRef, contentRef, contentKey, enabled, minFont, minFontRatio, maxFont, maxFontRatio]);

  return fontSize;
}
