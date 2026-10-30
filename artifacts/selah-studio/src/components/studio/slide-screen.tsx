import React from 'react';
import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type ReactElement } from 'react';
import { getBackgroundObjectUrl } from '@/lib/local-workspace';
import type { Slide } from '@/lib/studio-data';
import { createStartupOutput, welcomeSlide, type OutputState } from '@/lib/projector-state';
import { useFitText } from '@/hooks/use-fit-text';
import { FormattedText } from './formatted-text';

export { createStartupOutput, welcomeSlide, type OutputState } from '@/lib/projector-state';

const mountain = { url: '/selah-atmosphere.svg' };
const logo = { url: '/selah-logo.png' };

function isLocalAsset(value?: string) {
  return Boolean(value?.startsWith('local-background:'));
}

function youtubeUrlForEmbed(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname !== 'www.youtube-nocookie.com' && url.hostname !== 'youtube-nocookie.com') return '';
    if (!url.pathname.startsWith('/embed/')) return '';
    return value;
  } catch {
    return '';
  }
}
/**
 * Recursively animate text nodes without flattening FormattedText markup.
 * This lets word blur work for formatted lyrics, sermons and scripture alike.
 */
function animateTextNodes(node: ReactNode, keyPrefix = 'word'): ReactNode {
  if (typeof node === 'string' || typeof node === 'number') {
    const parts = String(node).split(/(\s+)/);
    let wordIndex = 0;
    return parts.map((part, index) => {
      if (!part) return null;
      if (/^\s+$/.test(part)) return part;
      const key = `${keyPrefix}-${index}-${wordIndex}`;
      const delay = wordIndex++ * 45;
      return (
        <span className="selah-blur-word" key={key} style={{ animationDelay: `${delay}ms` }}>
          {part}
        </span>
      );
    });
  }

  if (Array.isArray(node)) {
    return node.map((child, index) => (
      <span className="selah-text-node" key={`${keyPrefix}-node-${index}`}>
        {animateTextNodes(child, `${keyPrefix}-${index}`)}
      </span>
    ));
  }

  if (isValidElement(node)) {
    const element = node as ReactElement<any>;
    return cloneElement(element, {
      ...element.props,
      children: animateTextNodes(element.props.children, `${keyPrefix}-child`),
    });
  }

  return node;
}

function wrapWordsWithBlur(
  node: React.ReactNode,
  counter = { count: 0 },
  staggerMs = 35
): React.ReactNode {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return node;
  }

  // Handle plain text and numbers
  if (typeof node === 'string' || typeof node === 'number') {
    const str = String(node);
    const parts = str.split(/(\s+)/); // Preserve whitespace tokens

    return parts.map((part, idx) => {
      if (/^\s+$/.test(part)) {
        return part; // Return whitespace directly
      }
      const currentWordIdx = counter.count++;
      return (
        <span
          key={`word-${currentWordIdx}-${idx}`}
          className="selah-blur-word"
          style={{ '--word-delay': `${currentWordIdx * staggerMs}ms` } as React.CSSProperties}
        >
          {part}
        </span>
      );
    });
  }

  // Handle arrays of nodes (e.g. mapped scripture verses)
  if (Array.isArray(node)) {
    return node.map((child, idx) => (
      <React.Fragment key={idx}>
        {wrapWordsWithBlur(child, counter, staggerMs)}
      </React.Fragment>
    ));
  }

  // Handle React elements (e.g. <p>, <strong>, <sup>, <FormattedText>)
  if (React.isValidElement(node)) {
    const element = node as ReactElement<any>;
    const children = (node.props as any)?.children;
    if (!children) return node;

    return React.cloneElement(
      element,
      element.props,
      wrapWordsWithBlur(children, counter, staggerMs)
    );
  }

  return node;
}

interface TransitionTextProps {
  mode?: 'cold' | 'fade' | string;
  animationKey: string;
  className?: string;
  children: React.ReactNode;
}

export function TransitionText({
  mode = 'fade',
  animationKey,
  className = '',
  children,
}: TransitionTextProps) {
  const transitionClass = mode === 'cold' ? 'selah-transition-cold' : 'selah-transition-fade';

  return (
    <div key={animationKey} className={`selah-transition ${transitionClass} ${className}`}>
      {children}
    </div>
  );
}

const transitionStyles = `
  .selah-transition { width: 100%; display: block; }
  
  /* 1. Cold Cut */
  .selah-transition-cold { animation: none !important; }
  
  /* 2. Standard Fade */
  .selah-transition-fade { 
    animation: selahTextFade 1.5s ease-in-out both; 
  }

  @keyframes selahTextFade {
    0% { opacity: 0; }
    100% { opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .selah-transition-fade, 
    .selah-transition-blur {
      animation-duration: 1ms !important;
    }
  }
`;
export function SlideScreen({
  slide,
  mode = 'normal',
  transitionMode = 'fade',
  className = '',
  backgroundDim = 50,
  preview = false,
}: {
  slide: Slide;
  mode?: 'normal' | 'blackout' | 'clear' | 'logo';
  transitionMode?: 'cold' | 'fade' | string;
  className?: string;
  backgroundDim?: number;
  preview?: boolean;
}) {
  // 1. Safe transition class definition (Fixes 'stageClass is not defined')
  const stageClass = transitionMode === 'cold' ? 'selah-transition-cold' : 'selah-transition-fade';
  const animationKey = `${slide.id}-${transitionMode}`;
  const [resolvedBackground, setResolvedBackground] = useState('');

  const [resolvedMedia, setResolvedMedia] = useState('');
  const [mediaError, setMediaError] = useState('');
  const copyRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLElement>(null);
  const textBoundaryRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const audioMuted = preview || (slide.audioMuted ?? true);
  const headerColors: Record<string, string> = { white: 'var(--screen-text)', teal: 'var(--primary)', gold: 'var(--gold)', rose: '#fb7185' };
  const headerFonts: Record<string, string> = {
    'font-dm': 'inherit',
    'font-georgia': 'Georgia, serif',
    'font-mono': 'ui-monospace, monospace',
    'font-bebas-neue': 'Bebas Neue, sans-serif',
    'font-montserrat': 'Montserrat, sans-serif',
  };

  useEffect(() => {
    let alive = true;
    const source = slide.background;
    if (!isLocalAsset(source)) {
      setResolvedBackground('');
      return;
    }
    void getBackgroundObjectUrl(source!.slice('local-background:'.length)).then((url) => {
      if (alive && url) {
        setResolvedBackground(url);
      }
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [slide.background]);

  useEffect(() => {
    let alive = true;
    const source = slide.mediaUrl;
    if (!isLocalAsset(source)) {
      setResolvedMedia(source || '');
      setMediaError('');
      return;
    }
    setResolvedMedia('');
    setMediaError('');
    void getBackgroundObjectUrl(source!.slice('local-background:'.length)).then((url) => {
      if (alive && url) {
        setResolvedMedia(url);
      } else if (alive) {
        setMediaError('This local media file could not be opened.');
      }
    }).catch(() => {
      if (alive) setMediaError('This local media file could not be opened.');
    });
    return () => {
      alive = false;
    };
  }, [slide.mediaUrl]);

  useEffect(() => {
    if (slide.mediaType !== 'youtube' || !resolvedMedia) return;
    const frame = document.querySelector<HTMLIFrameElement>(`iframe[data-selah-youtube="${CSS.escape(slide.id)}"]`);
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: audioMuted ? 'mute' : 'unMute', args: [] }), '*');
  }, [audioMuted, resolvedMedia, slide.id, slide.mediaType]);

  const background = resolvedBackground || slide.background || (slide.kind === 'scripture' ? '/backgrounds/stills/Echo Spheres Party - 16x9.jpg' : undefined);
  const hasBackground = Boolean(background && !isLocalAsset(background));
  const isBackgroundVideo = slide.backgroundType === 'video' || Boolean(background && /\.(mp4|webm|mov)(\?|$)/i.test(background));
  const isStandaloneMedia = slide.kind === 'media' && Boolean(slide.mediaUrl);
  const youtubeEmbed = slide.mediaType === 'youtube' && resolvedMedia ? youtubeUrlForEmbed(resolvedMedia) : '';

  const fittedFontSize = useFitText({
    boundaryRef: textBoundaryRef,
    contentRef: textRef,
    enabled: !isStandaloneMedia && mode === 'normal',
    contentKey: `${slide.id}|${slide.kind}|${slide.heading ?? ''}|${slide.text}|${JSON.stringify(slide.formats ?? [])}|${JSON.stringify(slide.verses ?? [])}`,
  });

  // A verse/chorus marker follows the actual wrapped text block. Short lyrics
  // keep it close; additional lines naturally move both the text's top edge and
  // the marker upward, without letting either cross the output-safe top edge.
  useLayoutEffect(() => {
    const copy = copyRef.current;
    const marker = headingRef.current;
    const text = textRef.current;
    if (!copy || !marker || !text || !slide.heading) return;

    let frame = 0;
    const positionMarker = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const copyRect = copy.getBoundingClientRect();
        const textRect = text.getBoundingClientRect();
        const markerRect = marker.getBoundingClientRect();
        if (!copyRect.height || !textRect.height || !markerRect.height) return;

        const safeTop = copyRect.height * 0.06;
        const gap = Math.max(6, copyRect.height * 0.018);
        const desiredTop = textRect.top - copyRect.top - markerRect.height - gap;
        marker.style.top = `${Math.max(safeTop, desiredTop)}px`;
      });
    };

    positionMarker();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(positionMarker);
    observer?.observe(copy);
    observer?.observe(text);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [fittedFontSize, slide.heading, slide.text, slide.verses]);

  return (
    <div className={`slide-screen ${slide.kind === 'scripture' ? 'scripture-screen' : ''} ${slide.kind === 'song' || slide.kind === 'sermon' ? 'song-screen' : ''} ${slide.chorus ? 'chorus-screen' : ''} ${mode === 'blackout' ? 'screen-blackout' : ''} ${isStandaloneMedia ? 'standalone-media-screen' : ''} ${className}`}>
      <style>{transitionStyles}</style>
      {mode !== 'blackout' && isStandaloneMedia && (
        <div className="standalone-media-stage">
          {slide.mediaType === 'youtube' ? (
            youtubeEmbed ? (
              <iframe
                key={slide.id}
                data-selah-youtube={slide.id}
                src={`${youtubeEmbed}${youtubeEmbed.includes('?') ? '&' : '?'}mute=${audioMuted ? '1' : '0'}`}
                title={slide.title || 'YouTube media'}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : <div className="standalone-media-error">Loading YouTube video…</div>
          ) : slide.mediaType === 'video' ? (
            resolvedMedia ? <video src={resolvedMedia} className="standalone-media-content" autoPlay loop playsInline preload="auto" controls muted={audioMuted} onError={() => setMediaError('This video could not be played on the projector.')} /> : <div className="standalone-media-error">{mediaError}</div>
          ) : (
            resolvedMedia ? <img src={resolvedMedia} className="standalone-media-content" alt={slide.title || 'Presentation media'} onError={() => setMediaError('This image could not be displayed on the projector.')} /> : <div className="standalone-media-error">{mediaError}</div>
          )}
        </div>
      )}
      {!isStandaloneMedia && mode !== 'blackout' && (
        <>
          {isBackgroundVideo && hasBackground ? (
            <video src={background} className="screen-background" autoPlay muted loop playsInline preload="auto" />
          ) : (
            <img src={hasBackground && (background?.startsWith('blob:') || background?.startsWith('https:') || background?.startsWith('/')) ? background : mountain.url} alt="" width={1536} height={864} className={`screen-background ${slide.background?.startsWith('tone-') ? slide.background : ''}`} />
          )}
          <div className="screen-scrim" style={{ opacity: Math.max(0, Math.min(100, backgroundDim)) / 100 }} />
        </>
      )}
      {mode === 'logo' ? (
        <div className="output-logo-wrapper">
          <img className="output-logo" src={logo.url} alt="Selah Studio" />
        </div>
      ) : mode === 'clear' || isStandaloneMedia ? null : (
        <div ref={copyRef} key={`text-${animationKey}`} className={`screen-copy ${stageClass}`}>
          {slide.heading && (
            <strong
              ref={headingRef}
              className="song-slide-heading"
              style={{
                color: headerColors[slide.headingStyle?.color ?? 'white'] ?? slide.headingStyle?.color ?? 'var(--screen-text)',
                fontFamily: headerFonts[slide.headingStyle?.font ?? 'font-montserrat'],
                fontWeight: Number(slide.headingStyle?.weight ?? '600'),
                fontSize: `${(3.3 * (slide.headingStyle?.size ?? 100)) / 100}cqw`,
              }}
            >
              {slide.heading}
            </strong>
          )}

          <div ref={textBoundaryRef} className="slide-text-boundary">
          <p ref={textRef} style={{ fontSize: `${fittedFontSize}px` }}>
            {slide.verses ? (
              slide.verses.map((verse, i) => (
                <span className="scripture-verse" key={i}>
                  <sup>──{verse.number}──</sup>
                  {verse.text}{' '}
                </span>
              ))
            ) : (
              <FormattedText text={slide.text} formats={slide.formats} />
            )}
          </p>
          </div>

          {slide.kind === 'scripture' && <span className="passage-tag">{slide.title}</span>}
          {slide.id === 'welcome' && <span>WE’RE SO GLAD YOU’RE HERE</span>}
        </div>
      )}
    </div>
  );
}
