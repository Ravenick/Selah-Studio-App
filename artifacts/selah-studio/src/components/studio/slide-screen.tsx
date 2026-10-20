import { useEffect, useState } from 'react';
import { getBackgroundBlob } from '@/lib/local-workspace';
import type { Slide } from '@/lib/studio-data';
import { FormattedText } from './formatted-text';

const mountain = { url: '/selah-atmosphere.svg' };
const logo = { url: '/selah-logo.png' };

export type OutputState = {
  slide: Slide;
  mode: 'normal' | 'blackout' | 'clear' | 'logo';
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

export function SlideScreen({
  slide,
  mode = 'normal',
  className = '',
}: {
  slide: Slide;
  mode?: OutputState['mode'];
  className?: string;
}) {
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
      {mode === 'logo' ? <img className="output-logo" src={logo.url} alt="Selah Studio" /> : mode === 'clear' || isStandaloneMedia ? null : (
        <div className="screen-copy">
          {slide.heading && <strong className="song-slide-heading" style={{ color: headerColors[slide.headingStyle?.color ?? 'white'], fontFamily: headerFonts[slide.headingStyle?.font ?? 'font-dm'], fontWeight: Number(slide.headingStyle?.weight ?? '600'), fontSize: `${(3.3 * (slide.headingStyle?.size ?? 100)) / 100}cqw` }}>{slide.heading}</strong>}
          <p>{slide.verses ? slide.verses.map((verse, i) => <span className="scripture-verse" key={i}><sup>──{verse.number}──</sup>{verse.text}{' '}</span>) : <FormattedText text={slide.text} formats={slide.formats} />}</p>
          {slide.kind === 'scripture' && <span className="passage-tag">{slide.title}</span>}
          {slide.id === 'welcome' && <span>WE’RE SO GLAD YOU’RE HERE</span>}
        </div>
      )}
    </div>
  );
}
