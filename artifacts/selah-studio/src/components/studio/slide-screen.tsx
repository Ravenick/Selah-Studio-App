import React from 'react';
import { cloneElement, isValidElement, useEffect, useState, type ReactNode, type ReactElement } from 'react';
import { getBackgroundBlob } from '@/lib/local-workspace';
import type { Slide } from '@/lib/studio-data';
import { FormattedText } from './formatted-text';

const mountain = { url: '/selah-atmosphere.svg' };
const logo = { url: '/selah-logo.png' };

export type OutputState = {
  slide: Slide;
  mode: 'normal' | 'blackout' | 'clear' | 'logo';
  transitionMode?: 'cold' | 'fade' | 'blur-words';
};

export const welcomeSlide: Slide = {
  id: 'welcome', title: 'Welcome Walk', label: 'Welcome', text: 'Welcome home.', kind: 'media',
};

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
}: {
  slide: Slide;
  mode?: 'normal' | 'blackout' | 'clear' | 'logo';
  transitionMode?: 'cold' | 'fade' | string;
  className?: string;
}) {
  // 1. Safe transition class definition (Fixes 'stageClass is not defined')
  const stageClass = transitionMode === 'cold' ? 'selah-transition-cold' : 'selah-transition-fade';
  const animationKey = `${slide.id}-${transitionMode}`;
  const [resolvedBackground, setResolvedBackground] = useState('');

  const [resolvedMedia, setResolvedMedia] = useState('');
  const audioMuted = slide.audioMuted ?? true;
  const headerColors = { white: 'var(--screen-text)', teal: 'var(--primary)', gold: 'var(--gold)', rose: '#fb7185' };
  const headerFonts = { 'font-dm': 'inherit', 'font-georgia': 'Georgia, serif', 'font-mono': 'ui-monospace, monospace' };

  useEffect(() => {
    let alive = true;
    let objectUrl = '';
    const source = slide.background;
    if (!isLocalAsset(source)) {
      setResolvedBackground('');
      return;
    }
    void getBackgroundBlob(source!.slice('local-background:'.length)).then((blob) => {
      if (alive && blob) {
        objectUrl = URL.createObjectURL(blob);
        setResolvedBackground(objectUrl);
      }
    }).catch(() => undefined);
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [slide.background]);

  useEffect(() => {
    let alive = true;
    let objectUrl = '';
    const source = slide.mediaUrl;
    if (!isLocalAsset(source)) {
      setResolvedMedia(source || '');
      return;
    }
    setResolvedMedia('');
    void getBackgroundBlob(source!.slice('local-background:'.length)).then((blob) => {
      if (alive && blob) {
        objectUrl = URL.createObjectURL(blob);
        setResolvedMedia(objectUrl);
      }
    }).catch(() => undefined);
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
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

  return (
    <div className={`slide-screen ${slide.kind === 'scripture' ? 'scripture-screen' : ''} ${slide.background?.startsWith('scripture-') ? slide.background : ''} ${slide.verses ? 'compiled-scripture' : ''} ${slide.chorus ? 'chorus-screen' : ''} ${mode === 'blackout' ? 'screen-blackout' : ''} ${isStandaloneMedia ? 'standalone-media-screen' : ''} ${className}`}>
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
            resolvedMedia ? <video src={resolvedMedia} className="standalone-media-content" autoPlay loop playsInline controls muted={audioMuted} /> : <div className="standalone-media-error">Loading video…</div>
          ) : (
            resolvedMedia ? <img src={resolvedMedia} className="standalone-media-content" alt={slide.title || 'Presentation media'} /> : <div className="standalone-media-error">Loading image…</div>
          )}
        </div>
      )}
      {!isStandaloneMedia && (slide.kind !== 'scripture' || (slide.background && slide.background !== 'scripture-obsidian')) && mode !== 'blackout' && (
        <>
          {isBackgroundVideo && hasBackground ? (
            <video src={background} className="screen-background" autoPlay muted loop playsInline />
          ) : (
            <img src={hasBackground && (background?.startsWith('blob:') || background?.startsWith('https:') || background?.startsWith('/')) ? background : mountain.url} alt="" width={1536} height={864} className={`screen-background ${slide.background?.startsWith('tone-') ? slide.background : ''}`} />
          )}
          <div className="screen-scrim" />
        </>
      )}
      {mode === 'logo' ? (
        <div className="output-logo-wrapper">
          <img className="output-logo" src={logo.url} alt="Selah Studio" />
        </div>
      ) : mode === 'clear' || isStandaloneMedia ? null : (
        <div key={`text-${animationKey}`} className={`screen-copy ${stageClass}`}>
          {slide.heading && (
            <strong
              className="song-slide-heading"
              style={{
                color: headerColors[slide.headingStyle?.color ?? 'white'],
                fontFamily: headerFonts[slide.headingStyle?.font ?? 'font-dm'],
                fontWeight: Number(slide.headingStyle?.weight ?? '600'),
                fontSize: `${(3.3 * (slide.headingStyle?.size ?? 100)) / 100}cqw`,
              }}
            >
              {slide.heading}
            </strong>
          )}

          <p>
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

          {slide.kind === 'scripture' && <span className="passage-tag">{slide.title}</span>}
          {slide.id === 'welcome' && <span>WE’RE SO GLAD YOU’RE HERE</span>}
        </div>
      )}
    </div>
  );
}
