import { useLayoutEffect, useState, type RefObject } from 'react';

type FitTextOptions = {
  boundaryRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  contentKey: string;
  enabled?: boolean;
  minFont?: number;
  maxFont?: number;
};

const EPSILON = 1;

/**
 * Finds the largest readable font size that fits every wrapped line inside the
 * supplied boundary. A hidden clone is measured before the visible text is
 * updated, preventing a transient overflowing render on live output.
 */
export function useFitText({
  boundaryRef,
  contentRef,
  contentKey,
  enabled = true,
  minFont = 12,
  maxFont = 120,
}: FitTextOptions) {
  const [fontSize, setFontSize] = useState(maxFont);

  useLayoutEffect(() => {
    if (!enabled) return;
    const boundary = boundaryRef.current;
    const content = contentRef.current;
    if (!boundary || !content) return;

    let frame = 0;
    let disposed = false;

    const scheduleFit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed) return;
        const width = Math.floor(boundary.clientWidth);
        const height = Math.floor(boundary.clientHeight);
        if (!width || !height) return;

        const probe = content.cloneNode(true) as HTMLElement;
        const sourceStyle = window.getComputedStyle(content);
        probe.style.cssText = [
          'position:fixed', 'left:-100000px', 'top:0', 'visibility:hidden',
          'pointer-events:none', 'display:block', 'box-sizing:border-box',
          `width:${width}px`, 'height:auto', 'min-height:0', 'max-width:100%',
          'margin:0', 'padding:0', `font-family:${sourceStyle.fontFamily}`,
          `font-weight:${sourceStyle.fontWeight}`, `font-style:${sourceStyle.fontStyle}`,
          'line-height:1.18', `letter-spacing:${sourceStyle.letterSpacing}`,
          `text-transform:${sourceStyle.textTransform}`, 'white-space:pre-wrap',
          'overflow-wrap:anywhere', 'word-break:normal',
        ].join(';');
        document.body.appendChild(probe);

        let low = minFont;
        let high = maxFont;
        let best = minFont;
        for (let pass = 0; pass < 10; pass += 1) {
          const candidate = (low + high) / 2;
          probe.style.fontSize = `${candidate}px`;
          const overflowing = probe.scrollHeight > height + EPSILON || probe.scrollWidth > width + EPSILON;
          if (overflowing) high = candidate;
          else {
            best = candidate;
            low = candidate;
          }
        }
        probe.remove();

        const next = Math.max(minFont, Math.floor(best * 10) / 10);
        setFontSize((current) => (Math.abs(current - next) < 0.1 ? current : next));
      });
    };

    scheduleFit();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleFit);
    observer?.observe(boundary);
    void document.fonts?.ready.then(scheduleFit);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [boundaryRef, contentRef, contentKey, enabled, minFont, maxFont]);

  return fontSize;
}
