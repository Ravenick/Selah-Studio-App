import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Film, Music2, Save, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { parseSections, sectionHeadings, type SongSection } from '@/lib/studio-workflows';
import type { HeaderStyle, Song } from '@/lib/studio-data';
import { getBackgroundBlob, stashBackground } from '@/lib/local-workspace';
const mountain = { url: '/selah-atmosphere.svg' };
import { BackgroundPicker } from './background-picker';
import { SelectionEditor } from './selection-editor';
import { FormattedText } from './formatted-text';

const collections = [
  { title: 'Worship motion loops', source: 'Church Motion Graphics', href: 'https://www.churchmotiongraphics.com/', tone: 'tone-0' },
  { title: 'Atmosphere & light', source: 'Igniter Media', href: 'https://www.ignitermedia.com/', tone: 'tone-2' },
  { title: 'Slow horizons', source: 'Story Loop', href: 'https://www.storyloop.com/', tone: 'tone-3' },
];
const defaultHeaderStyle: HeaderStyle = { weight: '600', size: 100, color: 'white', font: 'font-dm' };

export function SongBuilder({ onClose, onApply, onSave, mode = 'song', initialSong }: { mode?: 'song' | 'sermon'; initialSong?: Song | undefined; onClose: () => void; onApply: (song: Song) => void; onSave: (song: Song) => void }) {
  const sermon = mode === 'sermon';
  const [title, setTitle] = useState(initialSong?.title ?? '');
  const [lyrics, setLyrics] = useState(initialSong?.sermonText ?? initialSong?.lyrics.join('\n\n') ?? '');
  const [sections, setSections] = useState<SongSection[]>(initialSong?.sections ?? parseSections(initialSong?.sermonText ?? initialSong?.lyrics.join('\n\n') ?? ''));
  const [headerStyle, setHeaderStyle] = useState<HeaderStyle>(initialSong?.headerStyle ?? defaultHeaderStyle);
  const baseline = useRef({
    title: initialSong?.title ?? '',
    lyrics: initialSong?.sermonText ?? initialSong?.lyrics.join('\n\n') ?? '',
    sections: JSON.stringify(initialSong?.sections ?? parseSections(initialSong?.sermonText ?? initialSong?.lyrics.join('\n\n') ?? '')),
    headerStyle: JSON.stringify(initialSong?.headerStyle ?? defaultHeaderStyle),
    backgroundId: initialSong?.background?.match(/^local-background:(.+)$/)?.[1] ?? '',
    background: initialSong?.background ?? '',
  });
  const [active, setActive] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [background, setBackground] = useState(initialSong?.background?.startsWith('local-background:') ? '' : initialSong?.background ?? '');
  const [backgroundId, setBackgroundId] = useState(initialSong?.background?.startsWith('local-background:') ? initialSong.background.slice('local-background:'.length) : '');
  const [backgroundType, setBackgroundType] = useState<'image' | 'video'>(initialSong?.backgroundType ?? 'image');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  // Applied object URLs remain usable by this session's slides after the dialog closes.
  const keepAssets = useRef(false);
  useEffect(() => () => { if (!keepAssets.current) urls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  useEffect(() => {
    const id = initialSong?.background?.match(/^local-background:(.+)$/)?.[1];
    if (!id) return;
    let alive = true;
    void getBackgroundBlob(id).then(blob => {
      if (!alive || !blob) return;
      const url = URL.createObjectURL(blob);
      urls.current.push(url);
      setBackground(url);
      setBackgroundType(initialSong?.backgroundType ?? 'image');
      setFileName(initialSong?.title ?? 'Saved background');
    });
    return () => { alive = false; };
  }, [initialSong]);
  const dirty = title !== baseline.current.title
    || lyrics !== baseline.current.lyrics
    || JSON.stringify(sections) !== baseline.current.sections
    || JSON.stringify(headerStyle) !== baseline.current.headerStyle
    || backgroundId !== baseline.current.backgroundId
    || (!baseline.current.backgroundId && background !== baseline.current.background);
  const headings = sectionHeadings(sections);
  const current = sections[active];
  function close() { if (dirty) setConfirm(true); else onClose(); }
  async function chooseFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/') && !['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type)) { setError('Choose an image, GIF, MP4, MOV, or WebM file.'); return; }
    try {
      const stored = await stashBackground(file);
      const url = URL.createObjectURL(file); urls.current.push(url);
      setBackground(url); setBackgroundId(stored.id); setBackgroundType(stored.type); setFileName(file.name); setError(''); setApplied(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not store this background locally.'); }
  }
  function draft(): Song { return { title: title.trim(), author: sermon ? 'Your sermon' : 'Your lyrics', tag: sermon ? 'Sermon' : 'Custom', kind: mode, lyrics: sections.map(section => section.text), sections: sections.map(section => ({ ...section, chorus: sermon ? false : section.chorus })), background: backgroundId ? `local-background:${backgroundId}` : background || undefined, backgroundType, ...(sermon ? { sermonText: lyrics, slideBreaks: sections.slice(0, -1).map((_, index) => index + 1) } : { headerStyle }) }; }
  function submit(save: boolean) {
    if (!title.trim() || !sections.length) { setError(sermon ? 'Add a sermon title and at least one section.' : 'Add a song title and at least one verse.'); return; }
    keepAssets.current = true;
    if (save) onSave(draft()); else { onApply(draft()); setApplied(true); setError(''); }
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="song-builder" onEscapeKeyDown={event => { event.preventDefault(); if (confirm) setConfirm(false); else close(); }}>
    <DialogHeader className="builder-heading"><div className="builder-eyebrow"><Music2 size={14}/> {sermon ? 'SERMON WORKSHOP' : 'SONG WORKSHOP'}</div><DialogTitle>{sermon ? 'New Sermon Builder' : initialSong ? 'Edit Song' : 'New Song Builder'}</DialogTitle><DialogDescription className="sr-only">Compose a song, arrange verses and choruses, and choose a background.</DialogDescription></DialogHeader>
    <div className="builder-body">
      <div className="builder-compose"><label className="builder-label" htmlFor="new-song-title">{sermon ? 'SERMON TITLE' : 'SONG TITLE'}</label><input id="new-song-title" placeholder={sermon ? 'Untitled sermon' : 'Untitled worship song'} value={title} onChange={event => { setTitle(event.target.value); setApplied(false); }}/>
        <label className="builder-label" htmlFor="new-song-lyrics">{sermon ? 'SERMON TEXT' : 'LYRICS'} <span>{sections.length} sections</span></label><textarea id="new-song-lyrics" placeholder={'Paste your lyrics…\n\nA blank line between each verse.'} value={lyrics} onChange={event => { const value = event.target.value; const next = parseSections(value, sections); setLyrics(value); setSections(next); setActive(index => Math.min(index, Math.max(0, next.length - 1))); setApplied(false); }}/>
        <div className="builder-label">BACKGROUND MEDIA <span>IMAGE · GIF · MP4</span></div><div className="builder-drop" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); chooseFile(event.dataTransfer.files[0]); }}>
           <input ref={fileInput} type="file" accept="image/*,video/mp4,video/quicktime,video/webm" className="sr-only" aria-label="Song background file" onChange={event => chooseFile(event.target.files?.[0])}/>
          <Button variant="ghost" className="builder-upload" onClick={() => fileInput.current?.click()}><Upload size={21}/><strong>{fileName || 'Drop background media here'}</strong><span>{fileName ? 'Choose another file' : 'or browse files'}</span></Button>
           {background && <div className="builder-asset">{backgroundType === 'video' ? <video src={background} muted autoPlay loop playsInline/> : <img src={background} alt="Selected song background"/>}<Button variant="secondary" size="icon" aria-label="Remove background" onClick={() => { setBackground(''); setBackgroundId(''); setFileName(''); setApplied(false); }}><X size={13}/></Button></div>}
        </div>
        <div className="builder-label">ONLINE MOTION COLLECTIONS <ExternalLink size={11}/></div><div className="motion-grid">{collections.map(collection => <a href={collection.href} target="_blank" rel="noopener noreferrer" key={collection.title} className="motion-card"><div><img src={mountain.url} alt="" className={collection.tone}/><Film size={17}/><ExternalLink size={12}/></div><strong>{collection.title}</strong><small>{collection.source}</small></a>)}</div>
         <BackgroundPicker presets={false} value={background} onChoose={(url,type,id) => {setBackground(url);setBackgroundId(id ?? '');setBackgroundType(type);setApplied(false);}}/>
      </div>
      <div className="builder-arrange"><div className="builder-label">{sermon ? 'SERMON SLIDES' : 'SONG ARRANGEMENT'} <span>{sermon ? `${sections.length} slides` : `${sections.filter(section => !section.chorus).length} verses · ${sections.filter(section => section.chorus).length} choruses`}</span></div>
        {!sermon && <details className="header-style-panel"><summary><span>GLOBAL VERSE HEADER STYLE</span><small>Apply to all numeric track markers</small></summary><div className="header-style-controls"><label>Weight<select aria-label="Global header weight" value={headerStyle.weight} onChange={event => setHeaderStyle(style => ({ ...style, weight: event.target.value as HeaderStyle['weight'] }))}><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option></select></label><label>Size <span>{headerStyle.size}%</span><input aria-label="Global header size" type="range" min="75" max="150" value={headerStyle.size} onChange={event => setHeaderStyle(style => ({ ...style, size: Number(event.target.value) }))}/></label><label>Color<select aria-label="Global header color" value={headerStyle.color} onChange={event => setHeaderStyle(style => ({ ...style, color: event.target.value as HeaderStyle['color'] }))}><option value="white">White</option><option value="teal">Teal</option><option value="gold">Gold</option><option value="rose">Rose</option></select></label><label>Font<select aria-label="Global header font" value={headerStyle.font} onChange={event => setHeaderStyle(style => ({ ...style, font: event.target.value as HeaderStyle['font'] }))}><option value="font-dm">DM Sans</option><option value="font-georgia">Georgia</option><option value="font-mono">Monospace</option></select></label></div></details>}
        {sections.length ? <><div className="verse-tabs" role="tablist" aria-label="Song sections">{sections.map((section, index) => <div className={`builder-section ${active === index ? 'selected' : ''} ${section.chorus ? 'is-chorus' : ''}`} key={index}><Button variant="ghost" role="tab" aria-selected={active === index} aria-controls="song-section-panel" id={`song-section-${index}`} className="builder-section-tab" onClick={() => setActive(index)}>{!sermon && <span>{headings[index]}</span>}<small>{section.text.split('\n')[0]}</small></Button>{!sermon && <label className="chorus-toggle"><span>Designate as Chorus</span><Switch aria-label={`Designate section ${index + 1} as Chorus`} checked={section.chorus} onCheckedChange={checked => { setSections(items => items.map((item, i) => i === index ? { ...item, chorus: checked } : item)); setApplied(false); }}/></label>}</div>)}</div>
        <SelectionEditor key={active} text={current?.text ?? ''} formats={current?.formats ?? []} onChange={text => {const next = sections.map((item,i) => i === active ? {...item,text,formats:[]} : item);setSections(next);setLyrics(next.map(item => item.text).join('\n\n'));setApplied(false);}} onFormat={format => {setSections(items => items.map((item,i) => i === active ? {...item,formats:[...(item.formats ?? []),format]} : item));setApplied(false);}}/>
        <div id="song-section-panel" role="tabpanel" aria-labelledby={`song-section-${active}`} className={`builder-slide-preview ${current?.chorus ? 'is-chorus' : ''}`}>{backgroundType === 'video' && background ? <video src={background} muted autoPlay loop playsInline/> : <img src={background || mountain.url} alt=""/>}<div>{!sermon && <strong>{headings[active]}</strong>}<p><FormattedText text={current?.text ?? ''} formats={current?.formats}/></p></div></div></> : <div className="builder-empty"><Music2 size={32}/><span>Your next song starts here.</span></div>}
      </div>
    </div>
    <footer className="builder-footer"><span role="status" className={error ? 'builder-error' : 'builder-status'}>{error || (applied ? 'Applied to preparation · not saved' : 'Session-only draft')}</span><div><Button variant="ghost" onClick={close}>Discard</Button><Button variant="outline" onClick={() => submit(false)}><Check size={14}/>Apply Changes</Button><Button onClick={() => submit(true)}><Save size={14}/>{sermon ? 'Save Sermon' : 'Save Song'}</Button></div></footer>
    {confirm && <div className="discard-overlay"><div role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-description" className="discard-dialog"><span className="discard-icon"><Music2 size={21}/></span><h3 id="discard-title">Discard this draft?</h3><p id="discard-description">Your unsaved song edits will be lost. Applied slides will remain in preparation.</p><div><Button autoFocus variant="outline" onClick={() => setConfirm(false)}>Keep editing</Button><Button variant="destructive" onClick={onClose}>Discard draft</Button></div></div></div>}
  </DialogContent></Dialog>;
}