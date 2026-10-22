import { useRef, useState } from 'react';
import { Check, Music2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { parseSections, sectionHeadings, type SongSection } from '@/lib/studio-workflows';
import type { HeaderStyle, Song } from '@/lib/studio-data';
import { SelectionEditor } from './selection-editor';
import { FormattedText } from './formatted-text';
import { PRESENTATION_COLORS, type PresentationFont } from '@/lib/scripture-appearance';
import type { TextFormat } from '@/lib/presentation';

const defaultHeaderStyle: HeaderStyle = { weight: '700', size: 100, color: '#ffffff', font: 'font-montserrat', showMarker: true };
const defaultSongBackground = '/backgrounds/motion/Blue Particles.mp4';

function rebaseFormatsAfterEdit(formats: TextFormat[], previousText: string, nextText: string): TextFormat[] {
  let prefix = 0;
  while (prefix < previousText.length && prefix < nextText.length && previousText[prefix] === nextText[prefix]) prefix++;
  let suffix = 0;
  while (suffix < previousText.length - prefix && suffix < nextText.length - prefix
    && previousText[previousText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]) suffix++;
  const oldChangedEnd = previousText.length - suffix;
  const newChangedEnd = nextText.length - suffix;
  const delta = newChangedEnd - oldChangedEnd;

  return formats.flatMap((format) => {
    if (format.end <= prefix) return [format];
    if (format.start >= oldChangedEnd) return [{ ...format, start: format.start + delta, end: format.end + delta }];
    if (format.start < prefix && format.end > oldChangedEnd) return [{ ...format, end: format.end + delta }];
    if (format.start < prefix) return [{ ...format, end: prefix }];
    if (format.end > oldChangedEnd) return [{ ...format, start: newChangedEnd, end: format.end + delta }];
    return [];
  }).filter((format) => format.start >= 0 && format.start < format.end && format.start < nextText.length);
}

export function SongBuilder({ onClose, onApply, onSave, mode = 'song', initialSong }: { mode?: 'song' | 'sermon'; initialSong?: Song | undefined; onClose: () => void; onApply: (song: Song) => void; onSave: (song: Song) => void }) {
  const sermon = mode === 'sermon';
  const [title, setTitle] = useState(initialSong?.title ?? '');
  const titleInput = useRef<HTMLInputElement>(null);
  const [titleNeedsAttention, setTitleNeedsAttention] = useState(false);
  const [lyrics, setLyrics] = useState(initialSong?.sermonText ?? initialSong?.lyrics.join('\n\n') ?? '');
  const [sections, setSections] = useState<SongSection[]>(initialSong?.sections ?? parseSections(initialSong?.sermonText ?? initialSong?.lyrics.join('\n\n') ?? ''));
  const [draggingSection, setDraggingSection] = useState<number | null>(null);
  const [headerStyle, setHeaderStyle] = useState<HeaderStyle>(initialSong?.headerStyle ?? defaultHeaderStyle);
  const [textSelection, setTextSelection] = useState<{ start: number; end: number } | null>(null);
  const baseline = useRef({
    title: initialSong?.title ?? '',
    lyrics: initialSong?.sermonText ?? initialSong?.lyrics.join('\n\n') ?? '',
    sections: JSON.stringify(initialSong?.sections ?? parseSections(initialSong?.sermonText ?? initialSong?.lyrics.join('\n\n') ?? '')),
    headerStyle: JSON.stringify(initialSong?.headerStyle ?? defaultHeaderStyle),
  });
  const [active, setActive] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const background = defaultSongBackground;
  const backgroundType: 'image' | 'video' = 'video';
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);
  const dirty = title !== baseline.current.title
    || lyrics !== baseline.current.lyrics
    || JSON.stringify(sections) !== baseline.current.sections
    || JSON.stringify(headerStyle) !== baseline.current.headerStyle;
  const headings = sectionHeadings(sections);
  const current = sections[active];
  const textRange = textSelection && textSelection.end > textSelection.start
    ? textSelection
    : { start: 0, end: current?.text.length ?? 0 };
  const activeTextFormat = current?.formats
    ?.filter((format) => format.start <= textRange.start && format.end >= textRange.end)
    .reduce<Partial<TextFormat>>((style, format) => ({ ...style, ...format }), {}) ?? {};
  function applyTextStyle(style: Partial<TextFormat>) {
    if (!current?.text.length) return;
    const range = textSelection && textSelection.end > textSelection.start
      ? textSelection
      : { start: 0, end: current.text.length };
    setSections((items) => items.map((item, index) => index === active
      ? { ...item, formats: [...(item.formats ?? []), { ...range, ...style }] }
      : item));
    setApplied(false);
  }
  function applyHeaderStyle(style: Partial<HeaderStyle>) {
    setHeaderStyle((current) => ({ ...current, ...style }));
    setApplied(false);
  }
  function moveSection(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= sections.length || to >= sections.length) return;
    const next = [...sections];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setSections(next);
    setLyrics(next.map(item => item.text).join('\n\n'));
    setActive(to);
    setTextSelection(null);
    setApplied(false);
  }
  function close() { if (dirty) setConfirm(true); else onClose(); }
  function draft(): Song { return { title: title.trim(), author: sermon ? 'Your sermon' : 'Your lyrics', tag: sermon ? 'Sermon' : 'Custom', kind: mode, lyrics: sections.map(section => section.text), sections: sections.map(section => ({ ...section, chorus: sermon ? false : section.chorus })), background, backgroundType, ...(sermon ? { sermonText: lyrics, slideBreaks: sections.slice(0, -1).map((_, index) => index + 1) } : { headerStyle }) }; }
  function submit(save: boolean) {
    if (!title.trim()) {
      setError(sermon ? 'Give this sermon a title before applying or saving.' : 'Give this song a title before applying or saving.');
      setTitleNeedsAttention(true);
      requestAnimationFrame(() => {
        titleInput.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        titleInput.current?.focus();
      });
      window.setTimeout(() => setTitleNeedsAttention(false), 900);
      return;
    }
    if (!sections.length) { setError(sermon ? 'Add at least one sermon section.' : 'Add at least one song verse.'); return; }
    if (save) onSave(draft()); else { onApply(draft()); setApplied(true); setError(''); }
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="song-builder" onEscapeKeyDown={event => { event.preventDefault(); if (confirm) setConfirm(false); else close(); }}>
    <DialogHeader className="builder-heading"><div className="builder-eyebrow"><Music2 size={14}/> {sermon ? 'SERMON WORKSHOP' : 'SONG WORKSHOP'}</div><DialogTitle>{sermon ? 'New Sermon Builder' : initialSong ? 'Edit Song' : 'New Song Builder'}</DialogTitle><DialogDescription className="sr-only">Compose and style song or sermon slides.</DialogDescription></DialogHeader>
    <div className="builder-fixed-stylebar" aria-label="Song and sermon style controls">
      <section className="builder-ribbon-group">
        <div className="builder-ribbon-fields">
          <label>TEXT FONT<select aria-label="Song or sermon text font" value={(activeTextFormat.font as PresentationFont | undefined) ?? 'font-montserrat'} onChange={(event) => applyTextStyle({ font: event.target.value })}><option value="font-montserrat">Montserrat</option><option value="font-bebas-neue">Bebas Neue</option><option value="font-dm">DM Sans</option><option value="font-georgia">Georgia</option><option value="font-mono">Monospace</option></select></label>
          <label>TEXT SIZE <span>{activeTextFormat.size ?? 100}%</span><input aria-label="Song or sermon text size" type="range" min="75" max="160" step="5" value={activeTextFormat.size ?? 100} onChange={(event) => applyTextStyle({ size: Number(event.target.value) })}/></label>
        </div>
        <div className="builder-ribbon-palette" role="group" aria-label="Song or sermon text color palette">{PRESENTATION_COLORS.map((color) => <button key={color} type="button" className={(activeTextFormat.color ?? '#ffffff').toLowerCase() === color ? 'selected' : ''} style={{ backgroundColor: color, filter: `drop-shadow(0 0 3px ${color}66)` }} aria-label={`Text color ${color}`} aria-pressed={(activeTextFormat.color ?? '#ffffff').toLowerCase() === color} title={color} onClick={() => applyTextStyle({ color })}/>)}</div>
        <span className="builder-ribbon-caption">TEXT APPEARANCE</span>
      </section>
      {!sermon && <section className="builder-ribbon-group">
        <div className="builder-ribbon-fields">
          <label>MARKER FONT<select aria-label="Verse marker font" value={headerStyle.font} onChange={(event) => applyHeaderStyle({ font: event.target.value })}><option value="font-montserrat">Montserrat</option><option value="font-bebas-neue">Bebas Neue</option><option value="font-dm">DM Sans</option><option value="font-georgia">Georgia</option><option value="font-mono">Monospace</option></select></label>
          <label>MARKER SIZE <span>{headerStyle.size}%</span><input aria-label="Verse marker size" type="range" min="75" max="150" value={headerStyle.size} onChange={(event) => applyHeaderStyle({ size: Number(event.target.value) })}/></label>
          <label>WEIGHT<select aria-label="Verse marker weight" value={headerStyle.weight} onChange={(event) => applyHeaderStyle({ weight: event.target.value as HeaderStyle['weight'] })}><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option></select></label>
        </div>
        <div className="builder-ribbon-palette" role="group" aria-label="Verse marker color palette">{PRESENTATION_COLORS.map((color) => <button key={color} type="button" className={headerStyle.color.toLowerCase() === color ? 'selected' : ''} style={{ backgroundColor: color, filter: `drop-shadow(0 0 3px ${color}66)` }} aria-label={`Verse marker color ${color}`} aria-pressed={headerStyle.color.toLowerCase() === color} title={color} onClick={() => applyHeaderStyle({ color })}/>)}</div>
        <label className="builder-marker-toggle"><Switch aria-label="Show automatic verse and chorus markers" checked={headerStyle.showMarker !== false} onCheckedChange={(checked) => applyHeaderStyle({ showMarker: checked })}/><span>Show automatic verse / chorus marker</span></label>
        <span className="builder-ribbon-caption">AUTOMATIC VERSE MARKER</span>
      </section>}
    </div>
    <div className="builder-body">
      <div className="builder-compose-fields">
        <label className="builder-label" htmlFor="new-song-title">{sermon ? 'SERMON TITLE' : 'SONG TITLE'}</label><input ref={titleInput} id="new-song-title" className={titleNeedsAttention ? 'builder-title-missing' : ''} placeholder={sermon ? 'Untitled sermon' : 'Untitled worship song'} value={title} onChange={event => { setTitle(event.target.value); setTitleNeedsAttention(false); setError(''); setApplied(false); }}/>
        <label className="builder-label" htmlFor="new-song-lyrics">{sermon ? 'SERMON TEXT' : 'LYRICS'} <span>{sections.length} sections</span></label><textarea id="new-song-lyrics" placeholder={'Paste your lyrics…\n\nA blank line between each verse.'} value={lyrics} onChange={event => { const value = event.target.value; const next = parseSections(value, sections); setLyrics(value); setSections(next); setActive(index => Math.min(index, Math.max(0, next.length - 1))); setTextSelection(null); setApplied(false); }}/>
      </div>
      <div className="builder-preview-pane">
        <div className="builder-label">STYLE PREVIEW <span>{headings[active] ?? (sermon ? 'Sermon slide' : 'Verse')}</span></div>
        <div id="song-section-panel" role="tabpanel" aria-labelledby={`song-section-${active}`} className={`builder-slide-preview style-preview-screen ${current?.chorus ? 'is-chorus' : ''}`}><video src={background} muted autoPlay loop playsInline/><div>{!sermon && headerStyle.showMarker !== false && <strong style={{ color: headerStyle.color, fontFamily: headerStyle.font === 'font-bebas-neue' ? 'Bebas Neue, sans-serif' : headerStyle.font === 'font-montserrat' ? 'Montserrat, sans-serif' : headerStyle.font === 'font-mono' ? 'ui-monospace, monospace' : headerStyle.font === 'font-georgia' ? 'Georgia, serif' : 'inherit', fontSize: `${Math.max(10, 15 * headerStyle.size / 100)}px`, fontWeight: Number(headerStyle.weight) }}>{headings[active]}</strong>}<p style={{ fontSize: `${Math.max(8, Math.min(19, 19 * Math.sqrt(350 / Math.max(350, current?.text.length ?? 0))))}px` }}><FormattedText text={current?.text ?? ''} formats={current?.formats}/></p></div></div>
      </div>
      <div className="builder-arrange"><div className="builder-label">{sermon ? 'SERMON SLIDES' : 'SONG ARRANGEMENT'} <span>{sermon ? `${sections.length} slides` : `${sections.filter(section => !section.chorus).length} verses · ${sections.filter(section => section.chorus).length} choruses`}</span></div>
        {sections.length ? <><div className="verse-tabs" role="tablist" aria-label="Song sections">{sections.map((section, index) => <div key={index} draggable onDragStart={() => setDraggingSection(index)} onDragOver={event => event.preventDefault()} onDrop={() => { if (draggingSection !== null) moveSection(draggingSection, index); setDraggingSection(null); }} onDragEnd={() => setDraggingSection(null)} className={`builder-section ${active === index ? 'selected' : ''} ${section.chorus ? 'is-chorus' : ''} ${draggingSection === index ? 'is-dragging' : ''}`}><Button variant="ghost" role="tab" aria-selected={active === index} aria-controls="song-section-panel" id={`song-section-${index}`} className="builder-section-tab" onClick={() => { setActive(index); setTextSelection(null); }}>{!sermon && <span>{headings[index]}</span>}<small>{section.text.split('\n')[0]}</small></Button>{!sermon && <label className="chorus-toggle"><span>Designate as Chorus</span><Switch aria-label={`Designate section ${index + 1} as Chorus`} checked={section.chorus} onCheckedChange={checked => { setSections(items => items.map((item, i) => i === index ? { ...item, chorus: checked } : item)); setApplied(false); }}/></label>}</div>)}</div>
        <SelectionEditor key={active} text={current?.text ?? ''} formats={current?.formats ?? []} defaultFont="font-montserrat" showTabs={false} onSelectionChange={setTextSelection} onChange={text => {const previousText = current?.text ?? ''; const next = sections.map((item,i) => i === active ? {...item,text,formats:rebaseFormatsAfterEdit(item.formats ?? [], previousText, text)} : item);setSections(next);setLyrics(next.map(item => item.text).join('\n\n'));setTextSelection(null);setApplied(false);}} onFormat={format => {setSections(items => items.map((item,i) => i === active ? {...item,formats:[...(item.formats ?? []),format]} : item));setApplied(false);}}/>
</> : <div className="builder-empty"><Music2 size={32}/><span>Your next song starts here.</span></div>}
      </div>
    </div>
    <footer className="builder-footer"><span role="status" className={error ? 'builder-error' : 'builder-status'}>{error || (applied ? 'Applied to preparation · not saved' : 'Session-only draft')}</span><div><Button variant="ghost" onClick={close}>Discard</Button><Button variant="outline" className={applied ? 'builder-apply-muted' : 'builder-apply-ready'} onClick={() => submit(false)}><Check size={14}/>Apply Changes</Button><Button onClick={() => submit(true)}><Save size={14}/>{sermon ? 'Save Sermon' : 'Save Song'}</Button></div></footer>
    {confirm && <div className="discard-overlay"><div role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-description" className="discard-dialog"><span className="discard-icon"><Music2 size={21}/></span><h3 id="discard-title">Discard this draft?</h3><p id="discard-description">Your unsaved song edits will be lost. Applied slides will remain in preparation.</p><div><Button autoFocus variant="outline" onClick={() => setConfirm(false)}>Keep editing</Button><Button variant="destructive" onClick={onClose}>Discard draft</Button></div></div></div>}
  </DialogContent></Dialog>;
}
