const mountain = { url: '/selah-atmosphere.svg' };
const logo = { url: '/selah-logo.png' };
import { useEffect, useState } from 'react';
import { getBackgroundBlob } from '@/lib/local-workspace';
import type { Slide } from '@/lib/studio-data';
import { FormattedText } from './formatted-text';

export type OutputState = { slide: Slide; mode: 'normal' | 'blackout' | 'clear' | 'logo' };
export const welcomeSlide: Slide = {
  id: 'welcome',
  title: 'Welcome Walk',
  label: 'Welcome',
  text: 'Welcome home.',
  kind: 'media',
};

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
  const headerColors = {
    white: 'var(--screen-text)',
    teal: 'var(--primary)',
    gold: 'var(--gold)',
    rose: '#fb7185',
  };
  const headerFonts = {
    'font-dm': 'inherit',
    'font-georgia': 'Georgia, serif',
    'font-mono': 'ui-monospace, monospace',
  };

  useEffect(() => {
    const match = slide.background?.match(/^local-background:(.+)$/);
    if (!match?.[1]) {
      setResolvedBackground('');
      return;
    }
    let alive = true;
    let objectUrl = '';
    void getBackgroundBlob(match[1])
      .then((blob) => {
        if (alive && blob) {
          objectUrl = URL.createObjectURL(blob);
          setResolvedBackground(objectUrl);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [slide.background]);

  const background = resolvedBackground || slide.background;
  const hasBackground = Boolean(background && !background.startsWith('local-background:'));
  const isVideo =
    slide.backgroundType === 'video' ||
    Boolean(background && (background.endsWith('.mp4') || background.endsWith('.webm') || background.includes('/video')));

  return (
    <div
      className={`slide-screen ${slide.kind === 'scripture' ? 'scripture-screen' : ''} ${
        slide.background?.startsWith('scripture-') ? slide.background : ''
      } ${slide.verses ? 'compiled-scripture' : ''} ${slide.chorus ? 'chorus-screen' : ''} ${
        mode === 'blackout' ? 'screen-blackout' : ''
      } ${className}`}
    >
      {/* Background Layer with Darkening Overlay for Text Contrast */}
      {(slide.kind !== 'scripture' || (slide.background && slide.background !== 'scripture-obsidian')) &&
        mode !== 'blackout' && (
          <>
            {isVideo && hasBackground ? (
              <video
                src={background}
                className="screen-background"
                autoPlay
                muted
                loop
                playsInline
              />
            ) : (
              <img
                src={
                  hasBackground &&
                  (background?.startsWith('blob:') ||
                    background?.startsWith('https:') ||
                    background?.startsWith('/'))
                    ? background
                    : mountain.url
                }
                alt=""
                width={1536}
                height={864}
                className={`screen-background ${slide.background?.startsWith('tone-') ? slide.background : ''}`}
              />
            )}
            {/* Subtle Contrast Scrim: Ensures readability over bright video loops */}
            <div className="screen-scrim" />
          </>
        )}

      {/* Screen Mode Content */}
      {mode === 'logo' ? (
        <img className="output-logo" src={logo.url} alt="Selah Studio" />
      ) : mode === 'clear' ? null : (
        <div className="screen-copy">
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