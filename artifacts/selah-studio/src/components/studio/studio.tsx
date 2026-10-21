import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  chapters,
  initialTimeline,
  songs,
  songSlides,
  SCRIPTURE_BACKGROUNDS,
  MEDIA_BACKGROUNDS,
  type Slide,
  type Song,
  type MediaAsset,
} from '@/lib/studio-data';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cloud,
  Copy,
  Edit2,
  ExternalLink,
  GripVertical,
  Image as ImageIcon,
  Info,
  Keyboard,
  Layers,
  ListMusic,
  Maximize2,
  Mic,
  Monitor,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  TextCursorInput,
  Trash2,
  Upload,
  X,
  RotateCcw,
  Volume2,
  VolumeX,
  Link2,
} from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { getChapter, matchingBooks, resolveBook, validChapter, validNumber, getMaxChapters, getMaxVerses, bibleBooks } from '@/lib/studio-workflows';
import { SongBuilder } from './song-builder';
import { Switch } from '@/components/ui/switch';
import { BackgroundPicker } from './background-picker';
import { WorkflowModal } from './workflow-modal';
import { compileScripture, parseVerseRange, routePreview } from '@/lib/presentation';
import { SlideScreen, welcomeSlide, type OutputState } from './slide-screen';
import { useAppStore } from '@/lib/app-store';
import {
  cachePassage,
  getCachedPassage,
  readSavedSongs,
  readTheme,
  readWorkspacePreferences,
  removeLocalSong,
  saveLocalSong,
  saveTheme,
  saveWorkspacePreferences,
  stashBackground,
} from '@/lib/local-workspace';
import { getGetScriptureQueryKey, getScripture, useGetScripture } from '@workspace/api-client-react';
import { usePushToTalk } from '@/hooks/use-push-to-talk';
import { parseBibleContent } from '@/lib/scripture-content';
import {
  searchOfflineBible,
  fetchOfflinePassage,
  fetchChapterVersesSequence,
  getOfflineChapterVerses,
  type SearchVerseResult,
  type SequenceVerseItem,
} from '@/lib/offline-bible';
import { parseSpokenBibleReference, type ParsedSpokenReference } from '@/lib/spoken-bible-parser';
import { PRESENTATION_COLORS, saveScriptureAppearance, useScriptureAppearance } from '@/lib/scripture-appearance';

import { isTauri } from '@tauri-apps/api/core';
import { BaseDirectory } from '@tauri-apps/api/path';
import { mkdir, writeTextFile } from '@tauri-apps/plugin-fs';

const logo = { url: '/selah-logo.png' };
const DEFAULT_BIBLE_ID = import.meta.env.VITE_SCRIPTURE_BIBLE_ID || 'de4e12af7f28f599-01';

const BIBLE_TRANSLATIONS: Record<string, { label: string; id: string; isOffline?: boolean }> = {
  KJV: {
    label: 'KJV (Offline)',
    id: import.meta.env.VITE_BIBLE_ID_KJV || 'de4e12af7f28f599-01',
    isOffline: true,
  },
  NIV: {
    label: 'NIV',
    id: import.meta.env.VITE_BIBLE_ID_NIV || '78a9f6124f344018-01',
  },
  NKJV: {
    label: 'NKJV',
    id: import.meta.env.VITE_BIBLE_ID_NKJV || '63097d2a0a2f7db3-01',
  },
  NLT: {
    label: 'NLT',
    id: import.meta.env.VITE_BIBLE_ID_NLT || 'd6e14a625393b4da-01',
  },
};

function Action({ tip, children, ...props }: ButtonProps & { tip: string }) {
  const testId = `action-${tip.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button data-testid={testId} aria-label={tip} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

function SectionLabel({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="section-label">
      {icon}
      {children}
    </div>
  );
}

const defaultSong: Song = songs[0] ?? { title: 'Amazing Grace', author: 'John Newton', tag: 'Hymn', lyrics: [] };
const defaultSlide: Slide = { ...(songSlides(defaultSong)[0] ?? welcomeSlide), background: '/backgrounds/motion/Blue Particles.mp4', backgroundType: 'video' };
const psalmVerses = chapters['Psalms']?.verses ?? [];
const accents: [string, string][] = [
  ['teal', 'Neon Teal'],
  ['gold', 'Holy Gold'],
  ['purple', 'Deep Purple'],
];


const initialScripture: Slide = {
  id: 'ps23-1',
  title: 'Psalm 23:1',
  label: 'Verse 1',
  text: psalmVerses[0] ?? 'The LORD is my shepherd; I shall not want.',
  kind: 'scripture',
};

function compileMappedScripture(book: string, chapter: string, verses: string[], numbers: number[]): Slide[] {
  const canonicalBook = book === 'Psalms' ? 'Psalm' : book;
  const abbreviation = (bibleCodes[book] ?? book.slice(0, 3)).replace(/^(.)(.*)$/, (_, first, rest) => first + rest.toLowerCase());
  return verses.map((verseText, index) => {
    const verseNum = numbers[index] ?? (index + 1);
    return {
      id: `${book}-${chapter}-${verseNum}`,
      title: `${canonicalBook} ${chapter}:${verseNum}`,
      label: `${abbreviation} ${chapter}:${verseNum}`,
      kind: 'scripture',
      text: verseText,
      verses: [{ number: verseNum, text: verseText }],
    };
  });
}

const bibleCodes: Record<string, string> = {
  Genesis: 'GEN', Exodus: 'EXO', Leviticus: 'LEV', Numbers: 'NUM', Deuteronomy: 'DEU',
  Joshua: 'JOS', Judges: 'JDG', Ruth: 'RUT', '1 Samuel': '1SA', '2 Samuel': '2SA',
  '1 Kings': '1KI', '2 Kings': '2KI', '1 Chronicles': '1CH', '2 Chronicles': '2CH',
  Ezra: 'EZR', Nehemiah: 'NEH', Esther: 'EST', Job: 'JOB', Psalms: 'PSA',
  Proverbs: 'PRO', Ecclesiastes: 'ECC', 'Song of Solomon': 'SNG', Isaiah: 'ISA',
  Jeremiah: 'JER', Lamentations: 'LAM', Ezekiel: 'EZK', Daniel: 'DAN', Hosea: 'HOS',
  Joel: 'JOL', Amos: 'AMO', Obadiah: 'OBA', Jonah: 'JON', Micah: 'MIC',
  Nahum: 'NAM', Habakkuk: 'HAB', Zephaniah: 'ZEP', Haggai: 'HAG', Zechariah: 'ZEC',
  Malachi: 'MAL', Matthew: 'MAT', Mark: 'MRK', Luke: 'LUK', John: 'JHN',
  Acts: 'ACT', Romans: 'ROM', '1 Corinthians': '1CO', '2 Corinthians': '2CO',
  Galatians: 'GAL', Ephesians: 'EPH', Philippians: 'PHP', Colossians: 'COL',
  '1 Thessalonians': '1TH', '2 Thessalonians': '2TH', '1 Timothy': '1TI',
  '2 Timothy': '2TI', Titus: 'TIT', Philemon: 'PHM', Hebrews: 'HEB',
  James: 'JAS', '1 Peter': '1PE', '2 Peter': '2PE', '1 John': '1JN',
  '2 John': '2JN', '3 John': '3JN', Jude: 'JUD', Revelation: 'REV',
};

function scriptureParams(book: string, chapter: string, range: string, translationKey = 'KJV') {
  const bibleId = BIBLE_TRANSLATIONS[translationKey]?.id || DEFAULT_BIBLE_ID;
  const code = bibleCodes[book] ?? book.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  const [start, end] = range.split('-').map((value) => value.trim());
  const passageId = `${code}.${chapter}.${start}${end ? `-${code}.${chapter}.${end}` : ''}`;
  return { bibleId, passageId };
}

const guideSteps = [
  { title: 'Make room for the moment.', copy: 'Start in your resource library. Pick a song, find a scripture, or paste your own lyrics.', icon: Music2 },
  { title: 'Prepare with confidence.', copy: 'Dual monitors keep you grounded: Preview on the left, live output on the right.', icon: Layers },
  { title: 'You’re ready to go live.', copy: 'Press Enter to project live. Use F1 (Blackout), F2 (Clear Text), or F3 (Logo) for instant control.', icon: Radio },
];

export function Studio() {
  // Hidden Upload Input Refs
  const [transitionMode, setTransitionMode] = useState<'cold' | 'fade'>('fade');
  const scriptureMotionInputRef = useRef<HTMLInputElement>(null);
  const scriptureStillInputRef = useRef<HTMLInputElement>(null);
  const mediaMotionInputRef = useRef<HTMLInputElement>(null);
  const mediaStillInputRef = useRef<HTMLInputElement>(null);
  const standaloneMediaInputRef = useRef<HTMLInputElement>(null);
  const [youtubeMediaUrl, setYoutubeMediaUrl] = useState('');
  // Custom uploaded backgrounds state
  const [customScriptureBgs, setCustomScriptureBgs] = useState<MediaAsset[]>([]);
  const [customMediaBgs, setCustomMediaBgs] = useState<MediaAsset[]>([]);
  const availableBackgrounds = Array.from(new Map(
    [...customScriptureBgs, ...customMediaBgs, ...SCRIPTURE_BACKGROUNDS, ...MEDIA_BACKGROUNDS]
      .map((asset) => [asset.url, asset] as const),
  ).values());
  // Media Explorer Modal State
  const [isMediaExplorerOpen, setIsMediaExplorerOpen] = useState(false);
  const [mediaBackground, setMediaBackground] = useState('/backgrounds/motion/Blue Particles.mp4');
  const [mediaBackgroundType, setMediaBackgroundType] = useState<'image' | 'video'>('video');
  // Handle Custom Uploads for Scripture
  function handleUploadScriptureAsset(e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'video') {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileUrl = URL.createObjectURL(file);
    const newAsset: MediaAsset = {
      id: `custom-scrip-${Date.now()}`,
      title: file.name.replace(/\.[^/.]+$/, ''),
      url: fileUrl,
      type,
      target: 'scripture',
    };

    setCustomScriptureBgs((prev) => [newAsset, ...prev]);
    chooseScriptureBackground(newAsset);
    setNotice(`Uploaded custom scripture ${type === 'video' ? 'motion loop' : 'still'}.`);
  }

  // Handle Custom Uploads for Songs/Sermons
  function handleUploadMediaAsset(e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'video') {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileUrl = URL.createObjectURL(file);
    const newAsset: MediaAsset = {
      id: `custom-media-${Date.now()}`,
      title: file.name.replace(/\.[^/.]+$/, ''),
      url: fileUrl,
      type,
      target: 'media',
    };

    setCustomMediaBgs((prev) => [newAsset, ...prev]);
    chooseMediaBackground(newAsset);
    setNotice(`Uploaded custom song/sermon ${type === 'video' ? 'motion loop' : 'still'}.`);
  }

  // Standalone media is a deck item, not a background applied behind lyrics.
  async function handleStandaloneMediaUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) {
      setNotice('Media files must be 200 MB or smaller.');
      return;
    }
    const isVideo = file.type.startsWith('video/');
    if (!file.type.startsWith('image/') && !isVideo) {
      setNotice('Choose an image, GIF, MP4, MOV, or WebM file.');
      return;
    }
    try {
      const stored = await stashBackground(file);
      const mediaSlide: Slide = {
        id: `media-${stored.id}`,
        title: file.name,
        label: isVideo ? 'Video' : 'Image',
        text: '',
        kind: 'media',
        mediaUrl: `local-background:${stored.id}`,
        mediaType: isVideo ? 'video' : 'image',
        audioMuted: true,
      };
      const mediaOnlyDeck = mediaDeckSlides.filter((item) => item.kind === 'media' && Boolean(item.mediaUrl));
      const nextDeck = [...mediaOnlyDeck, mediaSlide];
      const itemIndex = nextDeck.length - 1;
      setSlides(nextDeck);
      setMediaDeckSlides(nextDeck);
      setSelected(itemIndex);
      setSelectedMediaDeckIdx(itemIndex);
      loadPreview(mediaSlide);
      if (autoPush) broadcast(mediaSlide);
      setIsDirty(true);
      setNotice(`Added ${isVideo ? 'video' : 'image'} to the presentation deck.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save this media file.');
    }
  }

  function youtubeEmbedUrl(input: string): string | null {
    try {
      const parsed = new URL(input.trim());
      let id = '';
      if (parsed.hostname === 'youtu.be' || parsed.hostname.endsWith('.youtu.be')) id = parsed.pathname.split('/').filter(Boolean)[0] || '';
      else if (parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtube-nocookie.com')) {
        if (parsed.pathname === '/watch') id = parsed.searchParams.get('v') || '';
        else if (/^\/(embed|shorts|live)\//.test(parsed.pathname)) id = parsed.pathname.split('/')[2] || '';
      }
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
      return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`;
    } catch {
      return null;
    }
  }

  function toggleSelectedMediaAudio() {
    const index = selectedMediaDeckIdx ?? selected;
    const current = mediaDeckSlides[index];
    if (!current || !current.mediaUrl || (current.mediaType !== 'video' && current.mediaType !== 'youtube')) return;
    const updated = { ...current, audioMuted: !(current.audioMuted ?? true) };
    setSlides((prev) => prev.map((item) => item.id === updated.id ? updated : item));
    setMediaDeckSlides((prev) => prev.map((item) => item.id === updated.id ? updated : item));
    loadPreview(updated);
    if (autoPush || output.slide.id === current.id) broadcast(updated);
    setIsDirty(true);
  }

  function removeDeckMedia(index: number) {
    const item = mediaDeckSlides[index];
    if (!item) return;
    const nextDeck = mediaDeckSlides.filter((_, i) => i !== index);
    const nextSlides = slides.filter((slide) => slide.id !== item.id);
    setMediaDeckSlides(nextDeck);
    setSlides(nextSlides);
    const nextIndex = Math.max(0, Math.min(index, nextDeck.length - 1));
    setSelectedMediaDeckIdx(nextDeck.length ? nextIndex : null);
    setSelected(nextIndex);
    if (nextDeck[nextIndex]) loadPreview(nextDeck[nextIndex]);
    setEditingSlideIdx(null);
    setIsDirty(true);
    setNotice(`Removed “${item.title}” from the presentation deck.`);
  }

  function addYoutubeMedia() {
    const embedUrl = youtubeEmbedUrl(youtubeMediaUrl);
    if (!embedUrl) {
      setNotice('Paste a valid YouTube video, Shorts, or live URL.');
      return;
    }
    const mediaSlide: Slide = {
      id: `youtube-${Date.now()}`,
      title: 'YouTube video',
      label: 'YouTube',
      text: '',
      kind: 'media',
      mediaUrl: embedUrl,
      mediaType: 'youtube',
      youtubeUrl: youtubeMediaUrl.trim(),
      audioMuted: true,
    };
    const mediaOnlyDeck = mediaDeckSlides.filter((item) => item.kind === 'media' && Boolean(item.mediaUrl));
    const nextDeck = [...mediaOnlyDeck, mediaSlide];
    const itemIndex = nextDeck.length - 1;
    setSlides(nextDeck);
    setMediaDeckSlides(nextDeck);
    setSelected(itemIndex);
    setSelectedMediaDeckIdx(itemIndex);
    loadPreview(mediaSlide);
    if (autoPush) broadcast(mediaSlide);
    setYoutubeMediaUrl('');
    setIsDirty(true);
    setNotice('YouTube media added to the presentation deck.');
  }
  const [builderOpen, setBuilderOpen] = useState(false);
  const [deleteTargetSong, setDeleteTargetSong] = useState<Song | null>(null);
  const [autoPush, setAutoPush] = useState(false);
  const setStoreAuto = useAppStore((state) => state.setAutoLiveSync);
  const setStorePreview = useAppStore((state) => state.setPreview);
  const setStoreLive = useAppStore((state) => state.setLive);
  const setStoreCanvas = useAppStore((state) => state.setCanvas);

  const [lookupParams, setLookupParams] = useState<{ bibleId: string; passageId: string } | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [savedState, setSavedState] = useState<'saving' | 'saved' | 'error'>('saved');
  const [themeLoaded, setThemeLoaded] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [workflow, setWorkflow] = useState(false);
  const [builderMode, setBuilderMode] = useState<'song' | 'sermon'>('song');
  const [builderSong, setBuilderSong] = useState<Song | undefined>();
  // Schedule state & dirty tracking
  const [isDirty, setIsDirty] = useState(false);
  const [currentScheduleName, setCurrentScheduleName] = useState('Sunday_Worship_Service');
  const [recentSchedules, setRecentSchedules] = useState<
    Array<{ id: string; name: string; savedAt: string; payload: any }>
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load recent schedules from local storage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('selah-recent-schedules');
      if (stored) setRecentSchedules(JSON.parse(stored));
    } catch {
      // Fallback
    }
  }, []);

  function rememberSchedule(payload: any) {
    const entry = {
      id: `${payload.name || 'Service Schedule'}-${payload.timestamp || Date.now()}`,
      name: payload.name || 'Service Schedule',
      savedAt: new Date(payload.timestamp || Date.now()).toLocaleString(),
      payload,
    };
    setRecentSchedules((current) => {
      const next = [entry, ...current.filter((item) => item.name !== entry.name)].slice(0, 12);
      try { localStorage.setItem('selah-recent-schedules', JSON.stringify(next)); } catch { /* Storage may be unavailable in a restricted webview. */ }
      return next;
    });
  }

  // Save Schedule to computer (.selah JSON)
  async function handleSaveSchedule() {
    const payload = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      name: currentScheduleName,
      slides: slides.filter((slide) => slide.kind !== 'media' || slide.mediaType === 'youtube'),
      mediaDeckSlides: mediaDeckSlides.filter((slide) => slide.kind !== 'media' || slide.mediaType === 'youtube'),
      song,
      scriptureBackground,
      mediaBackground,
      mediaBackgroundType,
      scriptureBackgroundType,
    };

    const jsonString = JSON.stringify(payload, null, 2);

    if (isTauri()) {
      try {
        const safeName = currentScheduleName.trim().replace(/[<>:"/\\|?*]/g, '-').replace(/\.+$/g, '') || 'Service Schedule';
        const folder = 'SelahStudio/Schedules';
        await mkdir(folder, { baseDir: BaseDirectory.Document, recursive: true });
        await writeTextFile(`${folder}/${safeName}.selah`, jsonString, { baseDir: BaseDirectory.Document });
        rememberSchedule(payload);
        setIsDirty(false);
        setNotice(`Schedule saved to Documents/${folder}/${safeName}.selah.`);
      } catch (error) {
        console.error('Could not save schedule to the Selah Studio schedules folder.', error);
        setNotice('Could not save the schedule in Documents/SelahStudio/Schedules.');
      }
      return;
    }

    // Native OS File Save Dialog (Tauri & Web File System API)
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: `${currentScheduleName}.selah`,
          types: [
            {
              description: 'Selah Studio Schedule (*.selah)',
              accept: { 'application/json': ['.selah'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(jsonString);
        await writable.close();

        rememberSchedule(payload);

        setIsDirty(false);
        setNotice(`Schedule saved successfully.`);
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return; // User cancelled save
      }
    }

    // Fallback standard browser download
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentScheduleName}.selah`;
    a.click();
    URL.revokeObjectURL(url);
    rememberSchedule(payload);
    setIsDirty(false);
  }

  // Load schedule from computer file or recent drawer
  function applySchedulePayload(payload: any) {
    if (payload.slides) setSlides(payload.slides);
    if (payload.mediaDeckSlides) setMediaDeckSlides(payload.mediaDeckSlides);
    if (payload.song) setSong(payload.song);
    if (payload.scriptureBackground) setScriptureBackground(payload.scriptureBackground);
    if (payload.scriptureBackgroundType) setScriptureBackgroundType(payload.scriptureBackgroundType);
    if (payload.mediaBackground) setMediaBackground(payload.mediaBackground);
    if (payload.mediaBackgroundType) setMediaBackgroundType(payload.mediaBackgroundType);
    if (payload.name) setCurrentScheduleName(payload.name);

    setSelected(0);
    setSelectedMediaDeckIdx(0);
    setIsDirty(false);
    rememberSchedule(payload);
    setNotice(`Loaded schedule "${payload.name}"`);
  }

  function handleImportSchedule(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const payload = JSON.parse(event.target?.result as string);
        applySchedulePayload(payload);
      } catch {
        setNotice('Invalid .selah schedule file.');
      }
    };
    reader.readAsText(file);
  }

  // Background Selection
  // Default Constant Backgrounds
  const [scriptureBackground, setScriptureBackground] = useState('/backgrounds/stills/Echo Spheres Party - 16x9.jpg');
  const [scriptureBackgroundType, setScriptureBackgroundType] = useState<'image' | 'video'>('image');


  // Scripture Keyword & Full-text Search
  const [scriptureSearchQuery, setScriptureSearchQuery] = useState('');
  const [scriptureSearchResults, setScriptureSearchResults] = useState<SearchVerseResult[]>([]);
  const [isSearchingScripture, setIsSearchingScripture] = useState(false);
  const [scriptureSearchOpen, setScriptureSearchOpen] = useState(false);
  const [activeSearchResult, setActiveSearchResult] = useState(0);
  const scriptureSearchInputRef = useRef<HTMLInputElement>(null);
  const scriptureSearchRequest = useRef(0);
  const [selectedTranslation, setSelectedTranslation] = useState<string>('KJV');
  const scriptureAppearance = useScriptureAppearance();
  const scriptureRequestId = useRef(0);
  const sequenceRequestId = useRef(0);

  useEffect(() => {
    const query = scriptureSearchQuery.trim();
    const requestId = ++scriptureSearchRequest.current;
    if (query.length < 2) {
      setScriptureSearchResults([]);
      setIsSearchingScripture(false);
      return;
    }
    setIsSearchingScripture(true);
    const timer = window.setTimeout(() => {
      void searchOfflineBible(query, 100).then((results) => {
        if (requestId !== scriptureSearchRequest.current) return;
        setScriptureSearchResults(results);
        setActiveSearchResult(0);
        setIsSearchingScripture(false);
      }).catch(() => {
        if (requestId !== scriptureSearchRequest.current) return;
        setScriptureSearchResults([]);
        setIsSearchingScripture(false);
      });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [scriptureSearchQuery]);

  useEffect(() => {
    const dismissSearch = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target === scriptureSearchInputRef.current || target.closest('.scripture-results-dropdown')) return;
      setScriptureSearchOpen(false);
    };
    document.addEventListener('pointerdown', dismissSearch);
    return () => document.removeEventListener('pointerdown', dismissSearch);
  }, []);

  useEffect(() => {
    if (!scriptureSearchOpen || scriptureSearchResults.length === 0) return;
    document.getElementById(`scripture-search-result-${activeSearchResult}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeSearchResult, scriptureSearchOpen, scriptureSearchResults.length]);

  // Surrounding Sequence Engine
  const [sequenceVerses, setSequenceVerses] = useState<SequenceVerseItem[]>([]);
  const [highlightedVerses, setHighlightedVerses] = useState<number[]>([1]);

  // Exclusive Focus Partitioning: 'preview' | 'live' | 'deck'
  const [activeFocus, setActiveFocus] = useState<'preview' | 'live' | 'deck'>('deck');

  // Spoken Bible Voice Feedback
  const [voiceFeedback, setVoiceFeedback] = useState<{
    transcript: string;
    parsed: ParsedSpokenReference | null;
  } | null>(null);

  // Mid-service Fast Typo Editing
  const [editingSlideIdx, setEditingSlideIdx] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');

  const searchInput = useRef<HTMLInputElement>(null);
  const timelineSlides = useRef<Record<string, Slide[]>>({});
  const restoredCanvas = useRef<Slide[] | null>(null);
  const deckCardsRef = useRef<(HTMLDivElement | null)[]>([]);
  const [librarySongs, setLibrarySongs] = useState<Song[]>([]);
  const [pendingLibrarySong, setPendingLibrarySong] = useState<Song | null>(null);
  const [bookFocused, setBookFocused] = useState(false);
  const [invalidField, setInvalidField] = useState('');
  const bookInput = useRef<HTMLInputElement>(null);
  const [theme, setTheme] = useState('teal');
  const [tab, setTab] = useState('Songs');
  const [search, setSearch] = useState('');
  const [song, setSong] = useState<Song>(defaultSong);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [selected, setSelected] = useState(0);

  // Dedicated Media Presentation Deck states
  const [mediaDeckSlides, setMediaDeckSlides] = useState<Slide[]>([]);
  const [selectedMediaDeckIdx, setSelectedMediaDeckIdx] = useState<number | null>(null);
  const [output, setOutput] = useState<OutputState>(() => {
    try {
      const cached = localStorage.getItem('selah-projector-latest');
      if (cached) return JSON.parse(cached) as OutputState;
    } catch {
      // Clean start
    }
    return { slide: defaultSlide, mode: 'normal' };
  });

  const [lyrics, setLyrics] = useState('');
  const [settings, setSettings] = useState(false);
  const [guide, setGuide] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [timeline, setTimeline] = useState(initialTimeline);
  const [book, setBook] = useState('Psalms');
  const [chapter, setChapter] = useState('23');
  const [verse, setVerse] = useState('1');
  const [notice, setNotice] = useState('');
  const [outputName, setOutputName] = useState('Main sanctuary');
  const channel = useRef<BroadcastChannel | null>(null);
  const outputRef = useRef(output);
  const chapterInput = useRef<HTMLInputElement>(null);
  const verseInput = useRef<HTMLInputElement>(null);

  const scriptureQuery = useGetScripture(
    lookupParams ?? { bibleId: DEFAULT_BIBLE_ID, passageId: 'GEN.1.1' },
    {
      query: {
        enabled: !!lookupParams,
        queryKey: getGetScriptureQueryKey(lookupParams ?? { bibleId: '', passageId: '' }),
        retry: 0,
      },
    },
  );

  const voice = usePushToTalk((text) => {
    const parsed = parseSpokenBibleReference(text);
    setVoiceFeedback({ transcript: text, parsed });
  });
  const listening = voice.listening;
  const activeSlide = mediaDeckSlides[selectedMediaDeckIdx ?? selected] || slides[selected] || slides[0] || welcomeSlide;
  const bookMatches = matchingBooks(book);

  // Take slide live directly
  const broadcast = useCallback((slide: Slide) => {
    setOutput({ slide, mode: 'normal', transitionMode });
  }, [transitionMode]);
  // Auto-fallback: Switch away from word blur if active slide is scripture

  // Sync active presentation deck card scroll into view smoothly
  useEffect(() => {
    const activeIdx = selectedMediaDeckIdx ?? selected;
    if (activeIdx !== null && deckCardsRef.current[activeIdx]) {
      deckCardsRef.current[activeIdx]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [selectedMediaDeckIdx, selected]);

  // Sync output to BroadcastChannel & LocalStorage
  useEffect(() => {
    outputRef.current = output;
    setStoreLive(output.slide);
    channel.current?.postMessage({ type: 'output', output });
    try {
      localStorage.setItem('selah-projector-latest', JSON.stringify(output));
    } catch {
      // fallback
    }
  }, [output, setStoreLive]);

  useEffect(() => {
    const bc = new BroadcastChannel('selah_projector_channel');
    channel.current = bc;
    bc.onmessage = (event) => {
      if (event.data?.type === 'request') {
        bc.postMessage({ type: 'output', output: outputRef.current });
      }
    };
    return () => {
      bc.close();
    };
  }, []);

  // Initialize workspace from local storage & preferences
  useEffect(() => {
    let cancelled = false;
    Promise.all([readSavedSongs(), readTheme(), readWorkspacePreferences()])
      .then(([saved, accent, preferences]) => {
        if (cancelled) return;
        setLibrarySongs([
          ...songs,
          ...saved.filter((item) => !songs.some((seed) => seed.title === item.title && seed.kind === item.kind)),
        ]);
        setTheme(accent);
        if (preferences.autoPush !== undefined) setAutoPush(preferences.autoPush);
        if (preferences.scriptureBackground) setScriptureBackground(preferences.scriptureBackground);
        if (preferences.scriptureBackgroundType) setScriptureBackgroundType(preferences.scriptureBackgroundType);
        if (preferences.mediaBackground) setMediaBackground(preferences.mediaBackground);
        if (preferences.mediaBackgroundType) setMediaBackgroundType(preferences.mediaBackgroundType);
        if (preferences.outputName) setOutputName(preferences.outputName);
        setThemeLoaded(true);
        setPreferencesLoaded(true);
        const savedSong = [...songs, ...saved].find((item) => item.title === restoredCanvas.current?.[0]?.title);
        if (savedSong) {
          setSong(savedSong);
          const generatedSlides = songSlides(savedSong);
          setMediaDeckSlides(generatedSlides);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSavedState('error');
          setThemeLoaded(true);
          setPreferencesLoaded(true);
        }
      });

    try {
      const savedTimeline = localStorage.getItem('selah-service-timeline');
      if (savedTimeline) setTimeline(JSON.parse(savedTimeline));
      const savedSlides = localStorage.getItem('selah-service-slides');
      if (savedSlides) timelineSlides.current = JSON.parse(savedSlides) as Record<string, Slide[]>;
      const savedOutputName = localStorage.getItem('selah-output-name');
      if (savedOutputName) setOutputName(savedOutputName);
      const savedCanvas = localStorage.getItem('selah-current-canvas');
      if (savedCanvas) {
        const canvas = JSON.parse(savedCanvas) as Slide[];
        if (canvas.length) {
          restoredCanvas.current = canvas;
          setSlides(canvas);
          const savedIndex = Number(localStorage.getItem('selah-selected-slide') ?? '0');
          const nextIndex = Math.min(Math.max(savedIndex, 0), canvas.length - 1);
          setSelected(nextIndex);
          setStorePreview(canvas[nextIndex] ?? canvas[0] ?? null);
        }
      }
    } catch {
      // Local fallback
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setStoreAuto(autoPush);
    setStoreCanvas(slides.some((slide) => slide.kind === 'scripture') ? 'scripture' : 'media');
    try {
      localStorage.setItem('selah-current-canvas', JSON.stringify(slides));
      localStorage.setItem('selah-selected-slide', String(selected));
    } catch {
      setSavedState('error');
    }
  }, [autoPush, slides, selected, setStoreAuto, setStoreCanvas]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(id);
  }, [notice]);

  function loadPreview(slide: Slide) {
    const routed = routePreview(slide, autoPush);
    setStorePreview(routed.preview);
    if (routed.live) broadcast(routed.live);
  }

  function selectSlide(index: number) {
    const slide = slides[index];
    if (!slide) return;
    setSelected(index);
    setSelectedMediaDeckIdx(index);
    loadPreview(slide);
  }

  // Navigation specifically for Presentation Deck
  function stepDeck(direction: number) {
    if (!mediaDeckSlides.length) return;
    const current = selectedMediaDeckIdx ?? selected ?? 0;
    const nextIdx = Math.max(0, Math.min(mediaDeckSlides.length - 1, current + direction));
    setSelectedMediaDeckIdx(nextIdx);
    setSelected(nextIdx);
    const target = mediaDeckSlides[nextIdx];
    if (target) {
      loadPreview(target);
      if (autoPush) broadcast(target);
    }
  }

  // Navigation for Staged Preview
  function stepPreview(direction: number) {
    if (!slides.length) return;
    const nextIdx = Math.max(0, Math.min(slides.length - 1, selected + direction));
    selectSlide(nextIdx);
  }

  // Navigation for Live Output
  function stepLive(direction: number) {
    if (!slides.length) return;
    const nextIdx = Math.max(0, Math.min(slides.length - 1, selected + direction));
    setSelected(nextIdx);
    setSelectedMediaDeckIdx(nextIdx);
    const targetSlide = slides[nextIdx];
    if (targetSlide) {
      loadPreview(targetSlide);
      broadcast(targetSlide);
    }
  }

  async function displaySearchResult(result: SearchVerseResult, goLive = true) {
    setBook(result.book);
    setChapter(String(result.chapter));
    setVerse(String(result.verse));
    setScriptureSearchQuery('');
    setScriptureSearchResults([]);
    setScriptureSearchOpen(false);

    let title = result.reference;
    let text = result.text;
    const requestId = ++scriptureRequestId.current;
    if (selectedTranslation !== 'KJV') {
      try {
        const passage = await getScripture(scriptureParams(result.book, String(result.chapter), String(result.verse), selectedTranslation));
        if (requestId !== scriptureRequestId.current) return;
        const parsed = parseBibleContent(passage.content);
        if (!parsed.verses[0]) throw new Error(`No verse was returned for ${passage.reference}.`);
        title = passage.reference;
        text = parsed.verses[0];
      } catch (error) {
        if (requestId !== scriptureRequestId.current) return;
        const message = error instanceof Error ? error.message : `Could not load ${selectedTranslation}.`;
        setLookupError(message);
        setNotice(message);
        return;
      }
    }

    const slide: Slide = {
      id: `${result.book}-${result.chapter}-${result.verse}`,
      title,
      label: `Verse ${result.verse}`,
      text,
      kind: 'scripture',
      background: scriptureBackground,
      backgroundType: scriptureBackgroundType,
    };

    setSlides([slide]);
    setMediaDeckSlides([slide]);
    setSelected(0);
    setSelectedMediaDeckIdx(0);
    loadPreview(slide);

    if (goLive) {
      broadcast(slide);
      setNotice(`Displayed ${title} (${selectedTranslation}) live`);
    }
  }

  // Exclusive Keyboard Handling by Focused Partition
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (editingSlideIdx !== null) return;

      if (voiceFeedback) {
        if (e.key.toLowerCase() === 'a' || e.key === 'Enter') {
          e.preventDefault();
          if (voiceFeedback.parsed) {
            acceptVoiceFeedback(voiceFeedback.parsed);
          } else {
            setVoiceFeedback(null);
          }
          return;
        }
        if (e.key.toLowerCase() === 'r') {
          e.preventDefault();
          setVoiceFeedback(null);
          voice.start();
          return;
        }
        if (e.key === 'Escape' || e.key.toLowerCase() === 'c') {
          e.preventDefault();
          setVoiceFeedback(null);
          return;
        }
      }

      const isInput =
        e.target instanceof HTMLElement &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable);

      if (!voiceFeedback && !voice.transcribing) {
        if (e.key.toLowerCase() === 'v' && !isInput && !e.repeat && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          voice.start();
          return;
        }
        if (e.code === 'Space' && !isInput && !e.repeat) {
          e.preventDefault();
          voice.start();
          return;
        }
      }

      if (isInput) return;
      if (settings || guide || builderOpen || workflow) return;

      // Panic Functions
      if (e.key === 'F1') {
        e.preventDefault();
        setOutput((o) => ({ ...o, mode: o.mode === 'blackout' ? 'normal' : 'blackout' }));
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        setOutput((o) => ({ ...o, mode: o.mode === 'clear' ? 'normal' : 'clear' }));
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        setOutput((o) => ({ ...o, mode: o.mode === 'logo' ? 'normal' : 'logo' }));
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setTab('Songs');
        requestAnimationFrame(() => searchInput.current?.focus());
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        setTab('Scriptures');
        requestAnimationFrame(() => {
          bookInput.current?.focus();
          bookInput.current?.select();
        });
        return;
      }

      // Enter key pushes current slide live
      if (e.key === 'Enter') {
        e.preventDefault();
        if (tab !== 'Scriptures' && pendingLibrarySong) {
          loadSong(pendingLibrarySong);
          return;
        }
        if (tab === 'Scriptures' && highlightedVerses.length > 0) {
          displayHighlightedVerses(autoPush);
          return;
        }
        const deckIndex = selectedMediaDeckIdx ?? selected;
        const selectedItem = mediaDeckSlides[deckIndex] ?? slides[selected];
        if (selectedItem) {
          loadPreview(selectedItem);
          if (autoPush) broadcast(selectedItem);
          setNotice(autoPush ? `Projected ${selectedItem.title || 'Slide'} Live` : `Loaded ${selectedItem.title || 'Slide'} into Preview`);
        }
        return;
      }

      // Partitioned Arrow Navigation
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (activeFocus === 'deck') {
          stepDeck(1);
        } else if (activeFocus === 'live') {
          stepLive(1);
        } else {
          stepPreview(1);
        }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (activeFocus === 'deck') {
          stepDeck(-1);
        } else if (activeFocus === 'live') {
          stepLive(-1);
        } else {
          stepPreview(-1);
        }
        return;
      }
    };

    const onUp = (e: KeyboardEvent) => {
      if (voice.listening && (e.key.toLowerCase() === 'v' || e.code === 'Space')) {
        voice.stop();
      }
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  });

  // Load song into presentation deck
  function loadSong(item: Song) {
    // Attach active mediaBackground constant to every generated slide
    const generatedSlides = songSlides(item).map((s) => ({
      ...s,
      background: mediaBackground,
      backgroundType: mediaBackgroundType,
    }));

    setSong(item);
    setPendingLibrarySong(null);
    setSlides(generatedSlides);
    setMediaDeckSlides(generatedSlides);
    setSelectedMediaDeckIdx(0);
    setSelected(0);
    loadPreview(generatedSlides[0]);
    if (autoPush) broadcast(generatedSlides[0]);

    setIsDirty(true);
    setNotice(`Loaded "${item.title}" with persistent background.`);
  }

  // Delete song permanently from library
  function handleDeleteSong(targetSong: Song, e: React.MouseEvent) {
    e.stopPropagation();
    setDeleteTargetSong(targetSong);
  }

  function confirmDeleteSong() {
    if (!deleteTargetSong) return;
    const targetSong = deleteTargetSong;
    setLibrarySongs((prev) => prev.filter((song) => !(song.title === targetSong.title && song.kind === targetSong.kind)));
    try {
      const saved = JSON.parse(localStorage.getItem('selah-local-songs') || '[]') as Song[];
      localStorage.setItem('selah-local-songs', JSON.stringify(saved.filter((song) => !(song.title === targetSong.title && song.kind === targetSong.kind))));
    } catch {
      // Dexie remains the canonical storage for saved songs.
    }
    void removeLocalSong(targetSong);
    setNotice(`Deleted "${targetSong.title}"`);
    setDeleteTargetSong(null);
  }

  function handleEditSong(targetSong: Song, e: React.MouseEvent) {
    e.stopPropagation();
    setBuilderMode('song');
    setBuilderSong(targetSong);
    setBuilderOpen(true);
  }

  // Live Typo Editing: Updates active slide, deck, global song, and local storage
  function saveSlideTypoFix() {
    if (editingSlideIdx === null) return;
    const updatedSlides = [...mediaDeckSlides];
    const targetSlide = updatedSlides[editingSlideIdx];

    if (targetSlide && targetSlide.kind !== 'scripture') {
      const fixedSlide = { ...targetSlide, text: editingText };
      updatedSlides[editingSlideIdx] = fixedSlide;
      setMediaDeckSlides(updatedSlides);
      setSlides(updatedSlides);

      if (song) {
        const updatedLyrics = [...song.lyrics];
        updatedLyrics[editingSlideIdx] = editingText;
        const updatedSong = { ...song, lyrics: updatedLyrics };

        setSong(updatedSong);
        setLibrarySongs((prev) => prev.map((s) => (s.title === updatedSong.title ? updatedSong : s)));

        try {
          const saved = JSON.parse(localStorage.getItem('selah-local-songs') || '[]') as Song[];
          const filtered = saved.filter((s) => s.title !== updatedSong.title);
          localStorage.setItem('selah-local-songs', JSON.stringify([...filtered, updatedSong]));
        } catch {
          // Fallback
        }
      }

      if (selectedMediaDeckIdx === editingSlideIdx || selected === editingSlideIdx) {
        loadPreview(fixedSlide);
        if (autoPush) broadcast(fixedSlide);
      }

      setIsDirty(true); // <-- Added dirty flag
      setNotice('Verse updated globally and live!');
    }
    setEditingSlideIdx(null);
  }

  function parseLyrics(value: string) {
    setLyrics(value);
    const chunks = value.trim().split(/\n\s*\n/).filter(Boolean);
    if (!chunks.length) return;
    const customSong = { title: 'Untitled worship song', author: 'Your lyrics', tag: 'Custom', lyrics: chunks };
    setSong(customSong);
    const next = songSlides(customSong);
    setSlides(next);
    setMediaDeckSlides(next);
    setSelectedMediaDeckIdx(0);
    setSelected(0);
    setIsDirty(true); // <-- Added dirty flag
  }

  function pickBook(value: string) {
    const match = resolveBook(value);
    if (!match) {
      shakeField('book');
      return false;
    }
    setBook(match);
    setChapter(String(chapters[match]?.chapter ?? 1));
    setVerse('1');
    setInvalidField('');
    setBookFocused(false);
    return true;
  }

  function focusAndSelect(input: HTMLInputElement | null) {
    if (!input) return;
    input.focus();
    window.requestAnimationFrame(() => input.select());
  }

  function shakeField(field: string) {
    setInvalidField(field);
    window.setTimeout(() => setInvalidField((current) => current === field ? '' : current), 600);
  }

  const loadSequence = useCallback((b: string, c: string | number, highlightRange?: number[]) => {
    const requestId = ++sequenceRequestId.current;
    if (selectedTranslation === 'KJV') {
      void fetchChapterVersesSequence(b, c).then((seq) => {
        if (requestId !== sequenceRequestId.current || !seq.length) return;
        setSequenceVerses(seq);
        if (highlightRange?.length) setHighlightedVerses(highlightRange);
      });
      return;
    }

    const canonicalBook = resolveBook(b) ?? b;
    const code = bibleCodes[canonicalBook] ?? canonicalBook.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    const bibleId = BIBLE_TRANSLATIONS[selectedTranslation]?.id ?? DEFAULT_BIBLE_ID;
    void getScripture({ bibleId, passageId: `${code}.${c}` }).then((passage) => {
      if (requestId !== sequenceRequestId.current) return;
      const parsed = parseBibleContent(passage.content);
      const numbers = parsed.verseNumbers.length === parsed.verses.length
        ? parsed.verseNumbers
        : parsed.verses.map((_, index) => index + 1);
      const sequence = parsed.verses.map((text, index) => ({
        verseNumber: numbers[index] ?? index + 1,
        text,
        reference: `${canonicalBook} ${c}:${numbers[index] ?? index + 1}`,
      }));
      if (!sequence.length) throw new Error('The translation returned no verses for this chapter.');
      setSequenceVerses(sequence);
      if (highlightRange?.length) setHighlightedVerses(highlightRange);
      setLookupError('');
    }).catch((error: unknown) => {
      if (requestId !== sequenceRequestId.current) return;
      if (error instanceof TypeError) {
        setLookupError(isTauri() && !import.meta.env.DEV
          ? 'Could not reach the scripture API service. Set VITE_TAURI_API_BASE_URL to your deployed API service when building the desktop app.'
          : 'Could not reach the scripture API server. Start it with “pnpm dev:all” and check VITE_API_BASE_URL.');
      } else {
        setLookupError(error instanceof Error ? error.message : `Could not load ${selectedTranslation}.`);
      }
    });
  }, [selectedTranslation]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadSequence(book, chapter), selectedTranslation === 'KJV' ? 0 : 300);
    return () => window.clearTimeout(timer);
  }, [book, chapter, loadSequence, selectedTranslation]);

  // Out-of-Sequence Verse Selector & Custom Formatter (e.g. 1-3,5)
  function toggleSequenceVerse(vNum: number) {
    setHighlightedVerses((prev) => {
      const exists = prev.includes(vNum);
      const updated = exists ? prev.filter((n) => n !== vNum) : [...prev, vNum].sort((a, b) => a - b);

      if (updated.length) {
        const customString = updated.reduce((acc, current, idx, arr) => {
          if (idx === 0) return `${current}`;
          if (current === arr[idx - 1] + 1) {
            if (idx === arr.length - 1 || arr[idx + 1] !== current + 1) {
              return acc.endsWith('-') ? `${acc}${current}` : `${acc}-${current}`;
            }
            return acc.endsWith('-') ? acc : `${acc}-`;
          }
          return acc.endsWith('-') ? `${acc.slice(0, -1)},${current}` : `${acc},${current}`;
        }, '');

        setVerse(customString);
      } else {
        setVerse('');
      }
      return updated;
    });
  }

  // Display Out-of-sequence Verses (e.g. 1-3,5 skips verse 4)
  async function displayHighlightedVerses(takeLive = autoPush, translationKey = selectedTranslation) {
    if (!highlightedVerses.length) {
      setNotice('Highlight at least one verse to display.');
      return;
    }

    const numbers = [...highlightedVerses].sort((a, b) => a - b);
    const requestId = ++scriptureRequestId.current;

    try {
      let verses: string[];
      let verseNumbers: number[];
      if (translationKey === 'KJV') {
        const passage = await fetchOfflinePassage(book, Number(chapter), numbers);
        if (!passage?.verses.length) throw new Error('Could not process passage sequence.');
        verses = passage.verses;
        verseNumbers = passage.verseNumbers;
      } else {
        const ranges: number[][] = [];
        for (const number of numbers) {
          const current = ranges[ranges.length - 1];
          if (current && number === current[current.length - 1] + 1) current.push(number);
          else ranges.push([number]);
        }
        const passages = await Promise.all(ranges.map(([start, ...rest]) => {
          const end = rest[rest.length - 1];
          return getScripture(scriptureParams(book, chapter, end ? `${start}-${end}` : String(start), translationKey));
        }));
        const parsedRanges = passages.map((passage) => parseBibleContent(passage.content));
        verses = parsedRanges.flatMap((parsed) => parsed.verses);
        verseNumbers = parsedRanges.flatMap((parsed, index) => parsed.verseNumbers.length === parsed.verses.length
          ? parsed.verseNumbers
          : ranges[index].slice(0, parsed.verses.length));
        if (!verses.length) throw new Error('The selected translation returned no verses.');
      }

      if (requestId !== scriptureRequestId.current) return;
      const next = compileMappedScripture(book, chapter, verses, verseNumbers).map((slide) => ({
        ...slide,
        background: scriptureBackground,
        backgroundType: scriptureBackgroundType,
      }));

      setLookupError('');
      setSlides(next);
      setMediaDeckSlides(next);
      setSelectedMediaDeckIdx(0);
      setSelected(0);

      const firstSelectedSlide = next[0];
      if (firstSelectedSlide) {
        setStorePreview(firstSelectedSlide);
        if (takeLive) {
          setOutput({ slide: firstSelectedSlide, mode: 'normal', transitionMode });
          setStoreLive(firstSelectedSlide);
          setNotice(`Projected ${translationKey} selection live`);
        } else {
          const routed = routePreview(firstSelectedSlide, false);
          setStorePreview(routed.preview);
          setNotice(`Staged ${translationKey} selection in preview`);
        }
      }
    } catch (error) {
      if (requestId !== scriptureRequestId.current) return;
      const message = error instanceof Error ? error.message : `Could not load ${translationKey}.`;
      setLookupError(message);
      setNotice(message);
    }
  }

  function previewVerse(takeLiveNow = false) {
    const maxCh = getMaxChapters(book);
    if (!validNumber(chapter, maxCh)) {
      setInvalidField('chapter');
      setTimeout(() => setInvalidField(''), 600);
      return;
    }
    const maxVerse = getMaxVerses(book, chapter || '1');
    const indexes = parseVerseRange(verse, maxVerse);
    if (!indexes) {
      setInvalidField('verse');
      setTimeout(() => setInvalidField(''), 600);
      return;
    }

    setInvalidField('');
    setLookupError('');

    const targetNumbers = indexes.map((index) => index + 1);
    setHighlightedVerses(targetNumbers);
    loadSequence(book, chapter, targetNumbers);

    setTimeout(() => {
      displayHighlightedVerses(takeLiveNow);
    }, 10);
  }

  function persistBackgroundChoices(nextScripture = scriptureBackground, nextScriptureType = scriptureBackgroundType, nextMedia = mediaBackground, nextMediaType = mediaBackgroundType) {
    void saveWorkspacePreferences({
      autoPush,
      scriptureBackground: nextScripture,
      scriptureBackgroundType: nextScriptureType,
      mediaBackground: nextMedia,
      mediaBackgroundType: nextMediaType,
      outputName,
    });
  }

  function chooseScriptureBackground(asset: MediaAsset) {
    setScriptureBackground(asset.url);
    setScriptureBackgroundType(asset.type);
    setSlides((items) => items.map((slide) => slide.kind === 'scripture' ? { ...slide, background: asset.url, backgroundType: asset.type } : slide));
    setMediaDeckSlides((items) => items.map((slide) => slide.kind === 'scripture' ? { ...slide, background: asset.url, backgroundType: asset.type } : slide));
    setOutput((current) => current.slide.kind === 'scripture' ? { ...current, slide: { ...current.slide, background: asset.url, backgroundType: asset.type } } : current);
    if (slides[selected]?.kind === 'scripture') {
      const updated = { ...slides[selected]!, background: asset.url, backgroundType: asset.type };
      loadPreview(updated);
      if (autoPush) broadcast(updated);
    }
    persistBackgroundChoices(asset.url, asset.type);
    setIsDirty(true);
    setNotice(`Scripture background set to ${asset.title}.`);
  }

  // Set Song / Sermon Background
  function chooseMediaBackground(asset: MediaAsset) {
    setMediaBackground(asset.url);
    setMediaBackgroundType(asset.type);

    // Dynamically re-bind active song/sermon slides with this background
    setSlides((prev) =>
      prev.map((slide) =>
        slide.kind === 'song' || slide.kind === 'sermon'
          ? { ...slide, background: asset.url, backgroundType: asset.type }
          : slide
      )
    );
    setMediaDeckSlides((prev) =>
      prev.map((slide) =>
        slide.kind === 'song' || slide.kind === 'sermon'
          ? { ...slide, background: asset.url, backgroundType: asset.type }
          : slide
      )
    );
    setOutput((current) => current.slide.kind === 'song' || current.slide.kind === 'sermon'
      ? { ...current, slide: { ...current.slide, background: asset.url, backgroundType: asset.type } }
      : current);
    if (slides[selected] && (slides[selected]!.kind === 'song' || slides[selected]!.kind === 'sermon')) {
      const updated = { ...slides[selected]!, background: asset.url, backgroundType: asset.type };
      loadPreview(updated);
      if (autoPush) broadcast(updated);
    }
    persistBackgroundChoices(scriptureBackground, scriptureBackgroundType, asset.url, asset.type);
    setIsDirty(true);
    setNotice(`Song and sermon background set to ${asset.title}.`);
  }

  function renderBackgroundCard(asset: MediaAsset) {
    const isScripture = scriptureBackground === asset.url;
    const isSong = mediaBackground === asset.url;
    return <article className="background-library-card" key={asset.id}>
      <div className="background-library-thumb">{asset.type === 'video' ? <video src={asset.url} muted autoPlay loop playsInline /> : <img src={asset.url} alt="" />}</div>
      <strong title={asset.title}>{asset.title}</strong>
      <div className="background-targets" role="group" aria-label={`Assign ${asset.title} background`}>
        <button type="button" className={isScripture ? 'active' : ''} aria-pressed={isScripture} onClick={() => chooseScriptureBackground(asset)}><span className="target-radio"/>Scripture</button>
        <button type="button" className={isSong ? 'active' : ''} aria-pressed={isSong} onClick={() => chooseMediaBackground(asset)}><span className="target-radio"/>Song / Sermon</button>
      </div>
    </article>;
  }

  function acceptVoiceFeedback(parsed: ParsedSpokenReference) {
    setBook(parsed.book);
    setChapter(parsed.chapter);
    setVerse(parsed.verse);
    setTab('Scriptures');
    setVoiceFeedback(null);

    const maxV = getMaxVerses(parsed.book, parsed.chapter);
    const indexes = parseVerseRange(parsed.verse, maxV) || [0];
    const requestedNumbers = indexes.map((i) => i + 1);

    loadSequence(parsed.book, parsed.chapter, requestedNumbers);

    void fetchOfflinePassage(parsed.book, Number(parsed.chapter), requestedNumbers).then((offlinePassage) => {
      if (offlinePassage?.verses.length) {
        const next = compileMappedScripture(
          parsed.book,
          parsed.chapter,
          offlinePassage.verses,
          offlinePassage.verseNumbers,
        ).map((slide) => ({
          ...slide,
          background: scriptureBackground,
          backgroundType: scriptureBackgroundType,
        }));
        if (next[0]) {
          setSlides(next);
          setMediaDeckSlides(next);
          setSelected(0);
          setSelectedMediaDeckIdx(0);
          loadPreview(next[0]);
          broadcast(next[0]);
          setNotice(`Voice Live: ${parsed.reference}`);
        }
      } else {
        setLookupParams(scriptureParams(parsed.book, parsed.chapter, parsed.verse, selectedTranslation));
      }
    });
  }

  function addTimeline() {
    const id = `item-${Date.now()}`;
    timelineSlides.current[id] = slides.map((slide) => ({ ...slide }));
    setTimeline((items) => [
      ...items,
      { id, title: activeSlide.title, subtitle: `${slides.length} slides`, kind: activeSlide.kind },
    ]);
    setNotice('Added to service timeline');
  }

  function loadTimeline(id: string) {
    const item = timeline.find((t) => t.id === id);
    if (!item) return;
    if (item.kind === 'song' || item.kind === 'sermon') {
      const libraryItem = librarySongs.find((entry) => entry.title === item.title);
      if (libraryItem) {
        setPendingLibrarySong(libraryItem);
        setNotice(`Selected “${libraryItem.title}”. Press Enter to load it into the deck.`);
      } else {
        setNotice(`“${item.title}” is not in the song and sermon library.`);
      }
      return;
    }
    const saved = timelineSlides.current[id];
    if (saved?.[0]) {
      setSlides(saved);
      setMediaDeckSlides(saved);
      setSelected(0);
      setSelectedMediaDeckIdx(0);
      loadPreview(saved[0]);
      return;
    }
    if (item.kind === 'song' || item.kind === 'sermon') {
      loadSong(librarySongs.find((s) => s.title === item.title) || song);
    } else if (item.kind === 'scripture') {
      setTab('Scriptures');
      const next = psalmVerses.map(
        (text, i): Slide => ({
          id: `ps-${i}`,
          text,
          label: `Verse ${i + 1}`,
          title: `Psalm 23:${i + 1}`,
          kind: 'scripture',
        }),
      );
      setSlides(next);
      setMediaDeckSlides(next);
      setSelected(0);
      setSelectedMediaDeckIdx(0);
      loadPreview(next[0] ?? initialScripture);
    }
  }

  function launchProjector() {
    const win = window.open('/projector', 'selah-projector', 'popup=yes,width=1280,height=720');
    if (!win) setNotice('Allow pop-up windows to open your projector');
    else setNotice('Projector window opened. Move to external display.');
  }

  const isLive = output.mode === 'normal';

  return (
    <TooltipProvider delayDuration={200}>
      <div className={`studio theme-${theme}`}>
        {/* Top Header Bar */}
        <header className="app-header">
          <div className="flex items-center gap-3">
            <a href="/" className="brand">
              <img src={logo.url} width={38} height={38} alt="Selah mark" />
              <span>
                Selah <b>Studio</b>
                <small>SANCTUARY WORKSPACE</small>
              </span>
            </a>
          </div>

          <div className="flex items-center gap-3">
            <div className={`air-status-badge ${autoPush ? 'is-live' : 'is-off'}`}>
              <span className="status-dot" />
              <span>{autoPush ? 'ON AIR' : 'OFF AIR'}</span>
            </div>

            <div className="prominent-voice-bar">
              <button
                type="button"
                className={`voice-pulse-btn ${listening ? 'listening' : ''}`}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  voice.start();
                }}
                onPointerUp={voice.stop}
                onPointerCancel={voice.stop}
                title="Hold Space or click to speak Bible verse"
              >
                <Mic size={14} />
                <span>{voice.status || (voice.transcribing ? 'Preparing…' : listening ? 'Listening…' : 'Push to Talk')}</span>
              </button>
              <div className="ml-2 flex items-center rounded-full border border-white/10 bg-black/20 p-0.5" aria-label="Speech recognition mode">
                {(['offline', 'online'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={voice.mode === mode}
                    onClick={() => voice.setMode(mode)}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize transition-colors ${voice.mode === mode ? 'bg-primary/20 text-primary' : 'text-slate-400 hover:text-white'}`}
                    title={mode === 'offline' ? 'Runs Whisper on this device; downloads its model once' : 'Uses the configured transcription API'}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              {voice.error && <span role="alert" className="ml-2 max-w-56 text-[11px] text-rose-300">{voice.error}</span>}
            </div>
          </div>

          {voiceFeedback && (
            <div className="voice-result-popover">
              <h4>
                <Sparkles size={14} className="text-primary" />
                <span>Voice Reference Recognition</span>
              </h4>
              {voiceFeedback.parsed ? (
                <div className="space-y-1 my-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Detected:</span>
                    <strong className="text-sm text-primary font-bold">{voiceFeedback.parsed.reference}</strong>
                  </div>
                  <p className="text-[11px] text-slate-400 italic">“{voiceFeedback.transcript}”</p>
                </div>
              ) : (
                <div className="my-2">
                  <p className="text-xs text-slate-300">Heard: “{voiceFeedback.transcript}”</p>
                  <p className="text-[10px] text-amber-400 mt-1">No book/chapter detected. Try: “John 3:16” or “Psalm 23”.</p>
                </div>
              )}
              <div className="voice-action-row">
                <Button size="sm" variant="ghost" onClick={() => setVoiceFeedback(null)}>
                  Cancel (Esc)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setVoiceFeedback(null);
                    voice.start();
                  }}
                >
                  <RotateCcw size={12} className="mr-1" /> Retry (R)
                </Button>
                {voiceFeedback.parsed && (
                  <Button
                    size="sm"
                    className="bg-primary text-black font-semibold"
                    onClick={() => acceptVoiceFeedback(voiceFeedback.parsed!)}
                  >
                    <Check size={13} className="mr-1" />Enter ↵
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="header-actions">
            <div className="theme-picker" aria-label="Accent color">
              {accents.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-label={label}
                  title={label}
                  className={`theme-swatch swatch-${value} ${theme === value ? 'chosen' : ''}`}
                  onClick={() => setTheme(value)}
                >
                  {theme === value && <Check size={11} />}
                </button>
              ))}
            </div>
            <span className="header-divider" />
            <Action tip="Shortcuts & Workflow" variant="ghost" size="icon" onClick={() => setWorkflow(true)}>
              <Info />
            </Action>
            <Action
              tip="Guide"
              variant="ghost"
              size="icon"
              onClick={() => {
                setGuideStep(0);
                setGuide(true);
              }}
            >
              <CircleHelp />
            </Action>
            <Action tip="Workspace Settings" variant="ghost" size="icon" onClick={() => setSettings(true)}>
              <Settings2 />
            </Action>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 ml-2" onClick={launchProjector}>
              <ExternalLink size={12} /> Projector
            </Button>
          </div>
        </header>

        {/* Quick Service Controls Bar */}
        <div className="service-bar">
          <div className="flex items-center gap-2">
            <span className="service-icon">
              <ListMusic size={16} />
            </span>
            <strong>Sunday Worship Service</strong>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".selah,.json"
                className="hidden"
                onChange={handleImportSchedule}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1 bg-white/5 border-white/10 hover:bg-white/10"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={12} /> Load Schedule
              </Button>
              <Button
                size="sm"
                className={`h-7 text-xs font-bold gap-1 transition-all ${isDirty
                  ? 'bg-primary text-black opacity-100 shadow-[0_0_10px_rgba(0,242,254,0.4)]'
                  : 'bg-white/10 text-slate-300 opacity-50'
                  }`}
                onClick={handleSaveSchedule}
              >
                <CheckCheck size={12} /> Save Schedule {isDirty && '•'}
              </Button>
            </div>
          </div>
          {/* Insert inside the service-bar controls around line 810 */}
          <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/10">
            <button
              type="button"
              className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${transitionMode === 'cold' ? 'bg-primary text-black' : 'text-slate-400 hover:text-white'
                }`}
              onClick={() => setTransitionMode('cold')}
            >
              Cold Cut
            </button>
            <button
              type="button"
              className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${transitionMode === 'fade' ? 'bg-primary text-black' : 'text-slate-400 hover:text-white'
                }`}
              onClick={() => setTransitionMode('fade')}
            >
              Fade
            </button>
          </div>
          <div className="panic-controls">
            <span>PANIC CONTROLS:</span>
            <Action
              tip="Cut projector to Black (F1)"
              variant="ghost"
              className={output.mode === 'blackout' ? 'panic-active' : ''}
              onClick={() => setOutput((o) => ({ ...o, mode: o.mode === 'blackout' ? 'normal' : 'blackout' }))}
            >
              <Square size={13} /> Blackout [F1]
            </Action>
            <Action
              tip="Clear text, keep video background (F2)"
              variant="ghost"
              className={output.mode === 'clear' ? 'panic-active' : ''}
              onClick={() => setOutput((o) => ({ ...o, mode: o.mode === 'clear' ? 'normal' : 'clear' }))}
            >
              <TextCursorInput size={14} /> Clear Text [F2]
            </Action>
            <Action
              tip="Show church logo screen (F3)"
              variant="ghost"
              className={output.mode === 'logo' ? 'panic-active' : ''}
              onClick={() => setOutput((o) => ({ ...o, mode: o.mode === 'logo' ? 'normal' : 'logo' }))}
            >
              <img src={logo.url} alt="" /> Logo [F3]
            </Action>
          </div>
        </div>

        {/* Main Workstation */}
        <main className="workspace flex gap-3 p-3 items-start min-h-[calc(100vh-110px)] w-full overflow-hidden">
          {/* Left Sidebar: Resource Library */}
          <aside className="library-panel w-80 shrink-0 flex flex-col gap-3">
            <div className="panel-heading">
              <div>
                <Layers size={17} />
                <h2>Resource Library</h2>
              </div>
              <span className="count-badge">
                {tab === 'Songs' ? String(librarySongs.length).padStart(2, '0') : 'KJV'}
              </span>
            </div>

            <nav className="library-tabs">
              {[
                { label: 'Songs', icon: Music2 },
                { label: 'Scriptures', icon: BookOpen },
                { label: 'Media', icon: ImageIcon },
                { label: 'Schedules', icon: ListMusic },
              ].map((item) => (
                <Button
                  key={item.label}
                  variant="ghost"
                  onClick={() => {
                    setTab(item.label);
                    setSearch('');
                  }}
                  className={tab === item.label ? 'active' : ''}
                >
                  <item.icon size={15} />
                  <span>{item.label}</span>
                </Button>
              ))}
            </nav>

            <div className="library-content">
              {tab === 'Songs' && (
                <>
                  <label className="search-input">
                    <Search size={15} />
                    <input
                      ref={searchInput}
                      aria-label="Search songs"
                      placeholder="Find song or hymn…"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                    <kbd>⌘ K</kbd>
                  </label>

                  <div className="subsection-title">
                    <span>YOUR SONGS</span>
                    <Button
                      className="new-song-button"
                      size="sm"
                      onClick={() => {
                        setBuilderMode('song');
                        setBuilderSong(undefined);
                        setBuilderOpen(true);
                      }}
                    >
                      <Plus size={14} /> New Song
                    </Button>
                  </div>

                  <div className="library-builder-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setBuilderMode('sermon');
                        setBuilderSong(undefined);
                        setBuilderOpen(true);
                      }}
                    >
                      <Plus size={13} /> New Sermon
                    </Button>
                  </div>

                  <div className="song-list flex flex-col gap-1.5 overflow-y-auto max-h-[320px]">
                    {librarySongs
                      .filter((item) => `${item.title} ${item.author}`.toLowerCase().includes(search.toLowerCase()))
                      .map((item) => (
                        <div
                          key={`${item.kind ?? 'song'}:${item.title}`}
                          className={`song-row flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${pendingLibrarySong?.title === item.title ? 'bg-primary/10 border border-primary/40' : 'hover:bg-white/5 border border-transparent'
                            }`}
                          role="button"
                          tabIndex={0}
                          aria-label={`Select ${item.kind === 'sermon' ? 'sermon' : 'song'} ${item.title}; press Enter to load`}
                          onClick={() => setPendingLibrarySong(item)}
                          onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); loadSong(item); } }}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <span className="song-icon text-primary">
                              <Music2 size={16} />
                            </span>
                            <div className="song-info flex flex-col truncate">
                              <strong className="text-xs text-slate-100 truncate">{item.title}</strong>
                              <small className="text-[10px] text-slate-400 truncate">{item.author}</small>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              className="p-1 hover:text-primary text-slate-400 transition-colors"
                              title="Edit Song"
                              onClick={(e) => handleEditSong(item, e)}
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              type="button"
                              className="p-1 hover:text-red-400 text-slate-400 transition-colors"
                              title="Delete Song"
                              onClick={(e) => handleDeleteSong(item, e)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>


                </>
              )}

              {tab === 'Scriptures' && (
                <>
                  <div className="subsection-title flex items-center justify-between">
                    <span>KEYWORD / PASSAGE SEARCH</span>
                    <div className="bible-version-switcher" role="group" aria-label="Bible translation">
                      {Object.entries(BIBLE_TRANSLATIONS).map(([key, trans]) => (
                        <button
                          key={key}
                          type="button"
                          className={`bible-version-button ${selectedTranslation === key ? 'active' : ''}`}
                          aria-pressed={selectedTranslation === key}
                          onClick={() => {
                            setSelectedTranslation(key);
                            setNotice(`${trans.label} selected; loading the current passage.`);
                            if (validNumber(chapter, getMaxChapters(book)) && highlightedVerses.length) {
                              void displayHighlightedVerses(autoPush, key);
                            }
                          }}
                          title={trans.isOffline ? 'King James Version (available offline)' : `Load ${trans.label} from API.Bible`}
                        >
                          <span>{key}</span>
                          {trans.isOffline && <small>OFFLINE</small>}
                        </button>
                      ))}
                    </div>
                  </div>

                  <details className="scripture-appearance-panel">
                    <summary>Scripture text style</summary>
                    <div className="scripture-appearance-controls">
                      <label>
                        Font
                        <select
                          value={scriptureAppearance.font}
                          onChange={(event) => saveScriptureAppearance({ ...scriptureAppearance, font: event.target.value as typeof scriptureAppearance.font })}
                        >
                          <option value="font-montserrat">Montserrat</option>
                          <option value="font-bebas-neue">Bebas Neue</option>
                          <option value="font-dm">DM Sans</option>
                          <option value="font-georgia">Georgia</option>
                          <option value="font-mono">Monospace</option>
                        </select>
                      </label>
                      <label>
                        Verse color
                        <div className="scripture-color-grid" role="group" aria-label="Scripture text color palette">
                          {PRESENTATION_COLORS.map((color) => <button key={color} type="button" className={scriptureAppearance.textColor.toLowerCase() === color ? 'selected' : ''} style={{ backgroundColor: color }} aria-label={`Scripture text color ${color}`} aria-pressed={scriptureAppearance.textColor.toLowerCase() === color} title={color} onClick={() => saveScriptureAppearance({ ...scriptureAppearance, textColor: color })} />)}
                        </div>
                      </label>
                    </div>
                  </details>
                  {lookupError && <p className="scripture-appearance-error" role="alert">{lookupError}</p>}

                  <div className="scripture-search-wrap">
                    <label className="search-input">
                      <Search size={15} />
                      <input
                        ref={scriptureSearchInputRef}
                        aria-label="Search scripture keywords or references"
                        placeholder="e.g. for god so loved, or John 3:16"
                        value={scriptureSearchQuery}
                        onFocus={() => setScriptureSearchOpen(true)}
                        onChange={(e) => { setScriptureSearchQuery(e.target.value); setScriptureSearchOpen(true); setActiveSearchResult(0); }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown' && scriptureSearchResults.length) {
                            e.preventDefault();
                            setActiveSearchResult((index) => (index + 1) % scriptureSearchResults.length);
                          } else if (e.key === 'ArrowUp' && scriptureSearchResults.length) {
                            e.preventDefault();
                            setActiveSearchResult((index) => (index - 1 + scriptureSearchResults.length) % scriptureSearchResults.length);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setScriptureSearchOpen(false);
                          } else if (e.key === 'Enter' && scriptureSearchResults[activeSearchResult]) {
                            e.preventDefault();
                            displaySearchResult(scriptureSearchResults[activeSearchResult]!, true);
                          }
                        }}
                      />
                    </label>

                    {scriptureSearchOpen && isSearchingScripture && (
                      <div className="scripture-results-dropdown" role="status">Searching all 66 Bible books…</div>
                    )}
                    {scriptureSearchOpen && !isSearchingScripture && scriptureSearchQuery.trim().length >= 2 && scriptureSearchResults.length === 0 && (
                      <div className="scripture-results-dropdown" role="status">No matching verses found.</div>
                    )}
                    {scriptureSearchOpen && scriptureSearchResults.length > 0 && (
                      <div className="scripture-results-dropdown" role="listbox" aria-label="Bible verse search results">
                        {scriptureSearchResults.map((res, index) => (
                          <button
                            id={`scripture-search-result-${index}`}
                            key={res.reference}
                            type="button"
                            role="option"
                            aria-selected={activeSearchResult === index}
                            className={`scripture-result-item ${activeSearchResult === index ? 'highlighted' : ''}`}
                            onMouseEnter={() => setActiveSearchResult(index)}
                            onClick={() => displaySearchResult(res, true)}
                          >
                            <strong>{res.reference}</strong>
                            <p>{res.text}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="scripture-entry">
                    <div className="book-entry relative">
                      <input
                        data-testid="input-bible-book"
                        ref={bookInput}
                        aria-label="Bible book"
                        autoComplete="off"
                        className={invalidField === 'book' ? 'field-shake' : ''}
                        value={book}
                        onFocus={(event) => {
                          event.target.select();
                          setBookFocused(true);
                        }}
                        onClick={(event) => {
                          (event.target as HTMLInputElement).select();
                        }}
                        onBlur={() => setTimeout(() => setBookFocused(false), 200)}
                        onChange={(event) => {
                          const val = event.target.value;
                          setBook(val);
                          setBookFocused(true);
                          if (val.trim() && matchingBooks(val).length === 0) shakeField('book');
                          else setInvalidField('');
                        }}
                        onKeyDown={(event) => {
                          if (['Enter', 'Tab', 'ArrowRight'].includes(event.key)) {
                            const matches = matchingBooks(book);
                            const resolved = book.trim() ? resolveBook(book) || matches[0] : undefined;
                            if (!resolved) {
                              event.preventDefault();
                              shakeField('book');
                              return;
                            }
                            event.preventDefault();
                            if (pickBook(resolved)) focusAndSelect(chapterInput.current);
                          }
                        }}
                      />
                      {bookFocused && matchingBooks(book).length > 0 && matchingBooks(book)[0]?.toLowerCase() !== book.toLowerCase() && (
                        <span className="book-autocomplete-ghost">
                          ↵ {matchingBooks(book)[0]}
                        </span>
                      )}
                      {bookFocused && bookMatches.length > 0 && (
                        <div className="book-matches">
                          {bookMatches.map((name) => (
                            <Button
                              key={name}
                              variant="ghost"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setBook(name);
                                if (pickBook(name)) focusAndSelect(chapterInput.current);
                              }}
                            >
                              {name}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>

                    <input
                      data-testid="input-bible-chapter"
                      ref={chapterInput}
                      aria-label="Chapter"
                      value={chapter}
                      className={invalidField === 'chapter' ? 'field-shake' : ''}
                      onFocus={(e) => e.target.select()}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '') {
                          setChapter('');
                          return;
                        }
                        if (!/^\d+$/.test(val)) return;
                        const maxCh = getMaxChapters(book);
                        const num = Number(val);
                        if (num < 1 || num > maxCh) {
                          shakeField('chapter');
                          return;
                        }
                        setInvalidField('');
                        setChapter(val);
                      }}
                      onKeyDown={(e) => {
                        if (['Enter', 'Tab', 'ArrowRight'].includes(e.key)) {
                          if (!validChapter(book, chapter)) {
                            e.preventDefault();
                            shakeField('chapter');
                            return;
                          }
                          e.preventDefault();
                          focusAndSelect(verseInput.current);
                        } else if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0) {
                          e.preventDefault();
                          focusAndSelect(bookInput.current);
                        }
                      }}
                    />
                    <span>:</span>
                    <input
                      data-testid="input-bible-verse-range"
                      ref={verseInput}
                      aria-label="Verse or range"
                      placeholder="1-3,5"
                      value={verse}
                      className={invalidField === 'verse' ? 'field-shake' : ''}
                      onFocus={(e) => e.target.select()}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '') {
                          setVerse('');
                          return;
                        }
                        if (!/^[\d,-]+$/.test(val)) return;
                        setVerse(val);

                        const maxV = getMaxVerses(book, chapter || '1');
                        const inlineIndices = parseVerseRange(val, maxV);
                        if (inlineIndices) {
                          setHighlightedVerses(inlineIndices.map(i => i + 1));
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (highlightedVerses.length > 0) {
                            displayHighlightedVerses(autoPush);
                          } else if (slides[selected]) {
                            broadcast(slides[selected]!);
                          }
                          return;
                        }
                        else if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0) {
                          e.preventDefault();
                          focusAndSelect(chapterInput.current);
                        }
                      }}
                    />
                  </div>

                  <div className="surrounding-sequence-panel">
                    <div className="sequence-panel-header">
                      <h4>
                        <BookOpen size={13} className="text-primary" />
                        <span>{book} {chapter} SEQUENCE</span>
                        <span className="text-muted-foreground font-normal text-[9px]">
                          ({highlightedVerses.length} selected)
                        </span>
                      </h4>
                      <div className="sequence-panel-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
                          onClick={() => setHighlightedVerses([])}
                        >
                          Clear
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2 text-primary"
                          onClick={() => setHighlightedVerses(sequenceVerses.map((v) => v.verseNumber))}
                        >
                          All
                        </Button>
                        <Button
                          size="sm"
                          className="h-6 text-[10px] px-2.5 bg-primary text-black font-semibold"
                          disabled={!highlightedVerses.length}
                          onClick={() => displayHighlightedVerses(autoPush)}
                        >
                          Display [↵]
                        </Button>
                      </div>
                    </div>

                    <div className="sequence-verse-list">
                      {sequenceVerses.length === 0 ? (
                        <div className="p-3 text-center text-muted-foreground text-xs">
                          Loading chapter sequence...
                        </div>
                      ) : (
                        sequenceVerses.map((item) => {
                          const isHighlighted = highlightedVerses.includes(item.verseNumber);
                          return (
                            <button
                              key={item.verseNumber}
                              type="button"
                              className={`sequence-verse-row ${isHighlighted ? 'highlighted' : ''}`}
                              aria-pressed={isHighlighted}
                              onClick={() => toggleSequenceVerse(item.verseNumber)}
                            >
                              <span className="sequence-verse-badge">v{item.verseNumber}</span>
                              <span className="sequence-verse-text">{item.text}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>



                </>
              )}

              {tab === 'Media' && (
                <div className="flex flex-col gap-3">
                  <div className="active-backgrounds-grid">
                    <div className="active-background-card">
                      {scriptureBackgroundType === 'video' ? <video src={scriptureBackground} autoPlay loop muted playsInline /> : <img src={scriptureBackground} alt="" />}
                      <div><span>ACTIVE SCRIPTURE BACKGROUND</span><strong>{scriptureBackground.split('/').pop()}</strong></div>
                    </div>
                    <div className="active-background-card">
                      {mediaBackgroundType === 'video' ? <video src={mediaBackground} autoPlay loop muted playsInline /> : <img src={mediaBackground} alt="" />}
                      <div><span>ACTIVE SONG / SERMON BACKGROUND</span><strong>{mediaBackground.split('/').pop()}</strong></div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex flex-col gap-2">
                    <SectionLabel icon={<ImageIcon size={14} />}>ADD STANDALONE MEDIA</SectionLabel>
                    <p className="text-[11px] text-slate-400">Images and videos become their own deck slides. Video uploads are limited to 200 MB.</p>
                    <input ref={standaloneMediaInputRef} type="file" accept="image/*,video/mp4,video/quicktime,video/webm" className="hidden" onChange={handleStandaloneMediaUpload} />
                    <Button className="w-full h-9 bg-primary text-black font-bold text-xs" onClick={() => standaloneMediaInputRef.current?.click()}>
                      <Upload size={14} className="mr-1.5" /> Upload Image or Video
                    </Button>
                    <div className="flex gap-2">
                      <input aria-label="YouTube URL" value={youtubeMediaUrl} onChange={(e) => setYoutubeMediaUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addYoutubeMedia(); } }} placeholder="Paste YouTube / live URL" className="min-w-0 flex-1 h-9 rounded-md border border-white/15 bg-black/40 px-2 text-xs text-white outline-none focus:border-primary" />
                      <Button aria-label="Add YouTube media" title="Add YouTube media" className="h-9 px-3" onClick={addYoutubeMedia}><Link2 size={14} /></Button>
                    </div>
                    <div className="text-[10px] text-slate-400">{mediaDeckSlides.filter((item) => item.kind === 'media' && item.mediaUrl).length} standalone media item(s) in deck</div>
                    <Button variant="outline" className="w-full h-9 text-xs" onClick={() => setIsMediaExplorerOpen(true)}>
                      <ImageIcon size={14} className="mr-1.5" /> Choose Local Stills & Motion Loops
                    </Button>
                    {(() => {
                      const selectedMedia = mediaDeckSlides[selectedMediaDeckIdx ?? selected]; return selectedMedia?.mediaUrl && (selectedMedia.mediaType === 'video' || selectedMedia.mediaType === 'youtube') ? (
                        <Button variant="outline" className="w-full h-8 text-xs" onClick={toggleSelectedMediaAudio}>
                          {(selectedMedia.audioMuted ?? true) ? <VolumeX size={14} className="mr-1.5" /> : <Volume2 size={14} className="mr-1.5" />}
                          {(selectedMedia.audioMuted ?? true) ? 'Unmute selected media' : 'Mute selected media'}
                        </Button>
                      ) : null;
                    })()}
                  </div>
                </div>
              )}

              {tab === 'Schedules' && (
                <div className="flex flex-col gap-2">
                  <SectionLabel icon={<ListMusic size={14} />}>RECENT SCHEDULES (QUICK ACCESS)</SectionLabel>
                  {recentSchedules.length === 0 ? (
                    <p className="text-xs text-slate-400 p-2">No recent schedules saved yet.</p>
                  ) : (
                    recentSchedules.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className="flex items-center justify-between p-2 rounded-lg bg-white/5 hover:bg-white/10 text-left border border-white/5 transition-colors"
                        onClick={() => applySchedulePayload(entry.payload)}
                      >
                        <div className="flex flex-col truncate">
                          <strong className="text-xs text-slate-200 truncate">{entry.name}</strong>
                          <span className="text-[10px] text-slate-400">Saved at {entry.savedAt}</span>
                        </div>
                        <ChevronRight className="text-slate-400 shrink-0" size={14} />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </aside>

          {/* Center Column: Open View Space */}
          <div className="flex-1 flex flex-col gap-3 min-w-0 h-full overflow-hidden">

            {/* 🎵 HORIZONTAL SCROLLABLE PRESENTATION DECK WITH EXCLUSIVE FOCUS */}
            <div
              tabIndex={0}
              onClick={() => setActiveFocus('deck')}
              onFocus={() => setActiveFocus('deck')}
              className={`media-presentation-timeline-pane bg-neutral-900/90 border rounded-xl p-2 flex flex-col gap-2 w-full h-[20vh] shrink-0 shadow-lg transition-all outline-none ${activeFocus === 'deck' ? 'border-primary ring-1 ring-primary/40 shadow-[0_0_12px_rgba(0,242,254,0.15)]' : 'border-white/10'
                }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-primary tracking-wider uppercase">
                    Presentation Deck · {(mediaDeckSlides[selectedMediaDeckIdx ?? selected]?.title) || (mediaDeckSlides.length ? 'Presentation' : 'No items loaded')}
                  </span>
                  {activeFocus === 'deck' && (
                    <span className="text-[9px] font-bold bg-primary/20 text-primary px-1.5 py-0.5 rounded uppercase tracking-wider">
                      FOCUSED · ARROW KEYS ACTIVE
                    </span>
                  )}
                </div>

                {/* Fixed Manual Navigation Buttons for Deck */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-400 mr-1">
                    ({mediaDeckSlides.length} items loaded)
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] px-2 bg-white/5 border-white/10 hover:bg-white/10"
                    disabled={(selectedMediaDeckIdx ?? 0) <= 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      stepDeck(-1);
                    }}
                  >
                    <ChevronLeft size={12} className="mr-0.5" /> Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] px-2 bg-white/5 border-white/10 hover:bg-white/10"
                    disabled={(selectedMediaDeckIdx ?? 0) >= mediaDeckSlides.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      stepDeck(1);
                    }}
                  >
                    Next <ChevronRight size={12} className="ml-0.5" />
                  </Button>
                </div>
              </div>

              <div className="custom-presentation-scroll-deck flex gap-2.5 overflow-x-auto pb-1 scrollbar-thin">
                {mediaDeckSlides.map((slideItem, index) => {
                  const isCurrentActive = selectedMediaDeckIdx === index;
                  const isScripture = slideItem.kind === 'scripture';

                  return (
                    <div
                      key={slideItem.id || `media-deck-${index}`}
                      ref={(el) => {
                        deckCardsRef.current[index] = el;
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveFocus('deck');
                        setSelectedMediaDeckIdx(index);
                        setSelected(index);
                        loadPreview(slideItem);
                        if (autoPush) broadcast(slideItem);
                      }}
                      className={`flex-none w-44 aspect-video rounded-md p-2 border cursor-pointer flex flex-col justify-between transition-all relative group ${isCurrentActive
                        ? 'bg-cyan-300/20 border-cyan-200 ring-2 ring-cyan-300 shadow-[0_0_14px_rgba(34,211,238,0.38)] text-white'
                        : 'bg-white/5 border-white/10 hover:bg-white/10 text-slate-300'
                        }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] font-bold text-primary uppercase">
                          {slideItem.label || `Verse ${index + 1}`}
                        </span>

                        <button type="button" aria-label={`Remove ${slideItem.title} from deck`} title="Remove from deck" className="text-white/70 hover:text-white hover:bg-rose-500/80 rounded p-1" onClick={(e) => { e.stopPropagation(); removeDeckMedia(index); }}>
                          <X size={12} />
                        </button>
                        {/* Inline Edit Trigger (Disabled on Scripture) */}
                        {!isScripture && slideItem.kind !== 'media' && (
                          <button
                            type="button"
                            className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 hover:bg-primary hover:text-black text-slate-300 transition-colors opacity-80 group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingSlideIdx(index);
                              setEditingText(slideItem.text);
                            }}
                          >
                            Edit
                          </button>
                        )}
                      </div>

                      <p className="text-[11px] line-clamp-3 leading-snug my-1">
                        {slideItem.text || '[Blank / Background Frame]'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Inline Typo Editor */}
            {editingSlideIdx !== null && (
              <div className="bg-neutral-900 border border-primary/40 rounded-xl p-3 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                    <Edit2 size={13} /> Edit Slide Text Live & Save to Global Song
                  </span>
                  <button
                    type="button"
                    className="text-xs text-slate-400 hover:text-white"
                    onClick={() => setEditingSlideIdx(null)}
                  >
                    Cancel
                  </button>
                </div>
                <textarea
                  className="w-full bg-black/60 border border-white/10 rounded p-2 text-xs text-white focus:outline-none focus:border-primary"
                  rows={2}
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" className="h-7 text-xs bg-primary text-black font-bold" onClick={saveSlideTypoFix}>
                    Apply Changes & Sync Global Song
                  </Button>
                </div>
              </div>
            )}

            {/* Center Stage: DUAL WORKSTATION */}
            <section className="dual-workstation flex-1 grid grid-cols-2 gap-3 w-full min-h-0">
              {/* Left: PREVIEW MONITOR */}
              <div
                className={`monitor-card flex flex-col h-full rounded-xl border bg-neutral-900/80 p-2 transition-all outline-none ${activeFocus === 'preview' ? 'border-primary ring-1 ring-primary/40 shadow-[0_0_12px_rgba(0,242,254,0.15)]' : 'border-white/10'
                  }`}
                tabIndex={0}
                onClick={() => setActiveFocus('preview')}
                onFocus={() => setActiveFocus('preview')}
              >
                <div className="monitor-header py-1 px-2 flex justify-between items-center mb-1">
                  <h3 className="text-xs font-bold flex items-center gap-1.5 text-slate-200">
                    <Layers size={13} className="text-primary" />
                    <span>PREVIEW MONITOR</span>
                    <small className="text-slate-400 font-normal">
                      ({mediaDeckSlides.length ? (selectedMediaDeckIdx ?? selected) + 1 : 0}/{mediaDeckSlides.length})
                    </small>
                  </h3>
                  {activeFocus === 'preview' && (
                    <span className="text-[8px] font-bold bg-primary/20 text-primary px-1.5 py-0.5 rounded uppercase">
                      FOCUSED
                    </span>
                  )}
                </div>

                <div className="monitor-screen-wrap flex-1 flex items-center justify-center bg-black/60 rounded-md overflow-hidden p-1">
                  <SlideScreen slide={activeSlide} transitionMode={transitionMode} />
                </div>

                <div className="monitor-footer py-1 px-1 flex items-center justify-between mt-2">
                  <div className="monitor-nav-btns flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[11px] px-2"
                      disabled={(selectedMediaDeckIdx ?? selected) <= 0}
                      onClick={() => stepDeck(-1)}
                    >
                      <ArrowLeft size={11} className="mr-1" /> Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[11px] px-2"
                      disabled={(selectedMediaDeckIdx ?? selected) >= mediaDeckSlides.length - 1}
                      onClick={() => stepDeck(1)}
                    >
                      Next <ArrowRight size={11} className="ml-1" />
                    </Button>
                  </div>

                  <Button size="sm" className="take-live-btn h-6 text-[11px] font-bold px-2.5 bg-primary text-black" onClick={() => broadcast(activeSlide)}>
                    <Radio size={12} className="mr-1" /> TAKE LIVE (↵)
                  </Button>
                </div>
              </div>

              {/* Right: PROJECTOR OUTPUT */}
              <div
                className={`monitor-card live-monitor flex flex-col h-full rounded-xl border bg-neutral-900/80 p-2 transition-all outline-none ${activeFocus === 'live' ? 'border-red-500 ring-1 ring-red-500/40 shadow-[0_0_12px_rgba(239,68,68,0.15)]' : 'border-white/10'
                  }`}
                tabIndex={0}
                onClick={() => setActiveFocus('live')}
                onFocus={() => setActiveFocus('live')}
              >
                <div className="monitor-header py-1 px-2 flex justify-between items-center mb-1">
                  <h3 className="text-xs font-bold flex items-center gap-1.5">
                    <span className="live-pulsing-dot" />
                    <span className="text-red-400">PROJECTOR OUTPUT</span>
                    <small className="text-slate-400 font-normal">({outputName})</small>
                  </h3>
                  <div className="flex items-center gap-2">
                    {activeFocus === 'live' && (
                      <span className="text-[8px] font-bold bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded uppercase">
                        FOCUSED
                      </span>
                    )}
                    <Switch
                      checked={autoPush}
                      onCheckedChange={(val) => {
                        setAutoPush(val);
                        setStoreAuto(val);
                        if (val) broadcast(activeSlide);
                        setNotice(val ? 'Live Sync ON' : 'Live Sync OFF');
                      }}
                      title="Toggle immediate live broadcasting"
                    />
                  </div>
                </div>

                <div className="monitor-screen-wrap flex-1 flex items-center justify-center bg-black/60 rounded-md overflow-hidden p-1">
                  <SlideScreen slide={output.slide} mode={output.mode} transitionMode={output.transitionMode ?? transitionMode} />
                </div>

                <div className="monitor-footer py-1 px-1 flex items-center justify-between mt-2">
                  <div className="monitor-nav-btns flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[11px] px-2"
                      disabled={(selectedMediaDeckIdx ?? selected) <= 0}
                      onClick={() => stepDeck(-1)}
                    >
                      <ArrowLeft size={11} className="mr-1" /> Prev Live
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[11px] px-2"
                      disabled={(selectedMediaDeckIdx ?? selected) >= mediaDeckSlides.length - 1}
                      onClick={() => stepDeck(1)}
                    >
                      Next Live <ArrowRight size={11} className="ml-1" />
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>

        {/* Footer */}
        <footer className="app-footer">
          <span>
            <span className="status-dot" /> Offline-First Sanctuary System · Zero Cloud Dependency
          </span>
          <span className="flex items-center gap-3">
            <span className="raven-badge" aria-label="Built by Raven">
              <span>Built by Raven</span>
            </span>
            <span>Selah Studio v1.0</span>
            <Keyboard size={13} />
          </span>
        </footer>

        {/* Modals & Sheets */}
        {/* Background Library Explorer Modal */}
        {isMediaExplorerOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-neutral-900 border border-white/10 rounded-xl p-5 w-full max-w-5xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">

              {/* Hidden File Inputs */}
              <input
                ref={scriptureMotionInputRef}
                type="file"
                accept="video/mp4,video/webm"
                className="hidden"
                onChange={(e) => handleUploadScriptureAsset(e, 'video')}
              />
              <input
                ref={scriptureStillInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleUploadScriptureAsset(e, 'image')}
              />
              <input
                ref={mediaMotionInputRef}
                type="file"
                accept="video/mp4,video/webm"
                className="hidden"
                onChange={(e) => handleUploadMediaAsset(e, 'video')}
              />
              <input
                ref={mediaStillInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleUploadMediaAsset(e, 'image')}
              />

              {/* Modal Sticky Header */}
              <div className="flex justify-between items-center border-b border-white/10 pb-3 mb-3 shrink-0">
                <div className="flex items-center gap-2">
                  <ImageIcon size={18} className="text-primary" />
                  <h3 className="text-sm font-bold text-slate-100 tracking-wide">
                    SELAH BACKGROUND MEDIA LIBRARY
                  </h3>
                </div>
                <button
                  type="button"
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
                  onClick={() => setIsMediaExplorerOpen(false)}
                >
                  <X size={20} />
                </button>
              </div>

              {/* Internal Scrollable Content */}
              <div className="grid grid-cols-1 gap-6 overflow-y-auto pr-2 flex-1 scrollbar-thin">

                {/* ==================== SONG / SERMON COLUMN ==================== */}
                <div className="flex flex-col gap-4">
                  <div className="sticky top-0 bg-neutral-900/95 py-2 z-10 border-b border-white/10 flex justify-between items-center">
                    <span className="text-xs font-bold text-primary uppercase tracking-wider">
                      Local Backgrounds · Assign by display
                    </span>
                  </div>

                  {/* Song/Sermon Motions Section */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
                      <span className="flex items-center gap-1">🎥 Motion Loops (.mp4, .webm)</span>
                      <div className="flex items-center gap-2">
                        <a href="https://storyloop.com/site/freebies" target="_blank" rel="noreferrer" className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                          Story Loop <ExternalLink size={9} />
                        </a>
                        <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5 gap-1 bg-white/5 border-white/10" onClick={() => mediaMotionInputRef.current?.click()}>
                          <Upload size={9} /> Upload Loop
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {availableBackgrounds.filter((asset) => asset.type === 'video').map(renderBackgroundCard)}
                    </div>
                  </div>

                  {/* Song/Sermon Stills Section */}
                  <div className="flex flex-col gap-2 mt-2">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
                      <span className="flex items-center gap-1">🖼️ Still Backgrounds (Images)</span>
                      <div className="flex items-center gap-2">
                        <a href="https://www.churchmotiongraphics.com/free-worship-media/" target="_blank" rel="noreferrer" className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                          CMG Stills <ExternalLink size={9} />
                        </a>
                        <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5 gap-1 bg-white/5 border-white/10" onClick={() => mediaStillInputRef.current?.click()}>
                          <Upload size={9} /> Upload Still
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {availableBackgrounds.filter((asset) => asset.type === 'image').map(renderBackgroundCard)}
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}
        {builderOpen && (
          <SongBuilder
            mode={builderMode}
            initialSong={builderSong}
            onClose={() => setBuilderOpen(false)}
            onApply={(item) => {
              loadSong(item);
              setNotice(`${item.kind === 'sermon' ? 'Sermon' : 'Song'} staged in preview`);
            }}
            onSave={(item) => {
              setSavedState('saving');
              void saveLocalSong(item)
                .then(() => {
                  setLibrarySongs((items) => [
                    ...items.filter((ex) => ex.title !== item.title || ex.kind !== item.kind),
                    item,
                  ]);
                  setBuilderOpen(false);
                  setSavedState('saved');
                  setNotice(`${item.kind === 'sermon' ? 'Sermon' : 'Song'} saved to local device. The current display was left unchanged.`);
                })
                .catch(() => setSavedState('error'));
            }}
          />
        )}

        {deleteTargetSong && (
          <div className="delete-confirm-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTargetSong(null); }}>
            <section className="delete-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-song-title" aria-describedby="delete-song-description">
              <span className="delete-confirm-kicker">LIBRARY ACTION</span>
              <h2 id="delete-song-title">Delete {deleteTargetSong.kind === 'sermon' ? 'sermon' : 'song'}?</h2>
              <p id="delete-song-description"><strong>{deleteTargetSong.title}</strong> will be removed from this device.</p>
              <div className="delete-confirm-actions">
                <Button variant="ghost" onClick={() => setDeleteTargetSong(null)}>Keep it</Button>
                <Button variant="destructive" onClick={confirmDeleteSong}>Delete {deleteTargetSong.kind === 'sermon' ? 'sermon' : 'song'}</Button>
              </div>
            </section>
          </div>
        )}

        <WorkflowModal open={workflow} onOpenChange={setWorkflow} />

        {notice && (
          <div role="status" className="notice">
            <CheckCheck size={17} />
            {notice}
            <Button variant="ghost" size="icon" aria-label="Dismiss notification" onClick={() => setNotice('')}>
              <X size={13} />
            </Button>
          </div>
        )}

        <Sheet open={settings} onOpenChange={setSettings}>
          <SheetContent className="settings-sheet">
            <SheetHeader>
              <div className="settings-icon">
                <Settings2 size={24} />
              </div>
              <SheetTitle>Studio Preferences</SheetTitle>
              <SheetDescription>Configure displays, themes, and offline behavior.</SheetDescription>
            </SheetHeader>
            <div className="settings-section">
              <SectionLabel>APPEARANCE ACCENT</SectionLabel>
              <div className="settings-themes">
                {accents.map(([value, label]) => (
                  <Button
                    key={value}
                    variant="outline"
                    className={theme === value ? 'selected-theme' : ''}
                    onClick={() => setTheme(value)}
                  >
                    <span className={`color-dot swatch-${value}`} />
                    {label}
                    {theme === value && <Check size={13} />}
                  </Button>
                ))}
              </div>
            </div>
            <div className="settings-section">
              <SectionLabel>OUTPUT DISPLAY</SectionLabel>
              <label htmlFor="output-name">Audience Display Name</label>
              <input id="output-name" value={outputName} onChange={(e) => setOutputName(e.target.value)} />
            </div>
            <div className="settings-section">
              <SectionLabel>OFFLINE BIBLE ENGINE</SectionLabel>
              <p>King James Version (KJV) 66-book offline archive is active and indexed locally.</p>
              <p role="status">
                Storage:{' '}
                {savedState === 'error' ? 'Storage warning' : 'Verified and active on this computer'}
              </p>
            </div>
            <Button
              className="wide-button"
              onClick={() => {
                setSettings(false);
                setNotice('Preferences saved');
              }}
            >
              <Check size={15} /> Save & Close
            </Button>
          </SheetContent>
        </Sheet>

        <Sheet open={guide} onOpenChange={setGuide}>
          <SheetContent side="right" className="guide-sheet">
            <SheetHeader>
              <img src={logo.url} width={64} height={64} alt="Selah" />
              <SheetTitle>Welcome to Selah Studio</SheetTitle>
              <SheetDescription>Calm, distraction-free sanctuary control.</SheetDescription>
            </SheetHeader>
            <div className="guide-step">
              <span className="guide-step-icon">
                {guideStep === 0 ? <Music2 size={32} /> : guideStep === 1 ? <Layers size={32} /> : <Radio size={32} />}
              </span>
              <span className="eyebrow">OPERATOR GUIDE | {guideStep + 1} OF 3</span>
              <h3>{guideSteps[guideStep]?.title}</h3>
              <p>{guideSteps[guideStep]?.copy}</p>
            </div>
            <div className="guide-progress">
              {guideSteps.map((_, i) => (
                <span key={i} className={i === guideStep ? 'active' : ''} />
              ))}
            </div>
            <div className="guide-nav">
              <Button variant="ghost" disabled={guideStep === 0} onClick={() => setGuideStep(guideStep - 1)}>
                <ArrowLeft size={14} /> Back
              </Button>
              <Button onClick={() => (guideStep < 2 ? setGuideStep(guideStep + 1) : setGuide(false))}>
                {guideStep === 2 ? 'Start Service' : 'Next'} <ArrowRight size={14} />
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}

export function Projector() {
  const [output, setOutput] = useState<OutputState>(() => {
    try {
      const cached = localStorage.getItem('selah-projector-latest');
      if (cached) return JSON.parse(cached) as OutputState;
    } catch {
      // Local fallback
    }
    return { slide: welcomeSlide, mode: 'normal' };
  });

  useEffect(() => {
    const bc = new BroadcastChannel('selah_projector_channel');
    const requestCurrentOutput = () => bc.postMessage({ type: 'request' });
    bc.onmessage = (event) => {
      if (event.data?.type === 'output' && event.data.output?.slide) setOutput(event.data.output);
      if (event.data?.type === 'request') {
        try {
          const cached = localStorage.getItem('selah-projector-latest');
          if (cached) bc.postMessage({ type: 'output', output: JSON.parse(cached) as OutputState });
        } catch {
          // fallback
        }
      }
    };
    requestCurrentOutput();
    const recover = () => {
      try {
        const cached = localStorage.getItem('selah-projector-latest');
        if (cached) setOutput(JSON.parse(cached) as OutputState);
      } catch {
        // fallback
      }
    };
    window.addEventListener('focus', recover);
    window.addEventListener('storage', recover);
    window.addEventListener('pageshow', requestCurrentOutput);
    document.addEventListener('visibilitychange', requestCurrentOutput);
    return () => {
      window.removeEventListener('focus', recover);
      window.removeEventListener('storage', recover);
      window.removeEventListener('pageshow', requestCurrentOutput);
      document.removeEventListener('visibilitychange', requestCurrentOutput);
      bc.close();
    };
  }, []);

  return (
    <div className="projector-view">
      <SlideScreen slide={output.slide} mode={output.mode} transitionMode={output.transitionMode ?? "blur-words"} />
      <Button
        variant="ghost"
        size="icon"
        className="fullscreen-button"
        aria-label="Enter fullscreen"
        title="Enter fullscreen"
        onClick={() => {
          if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => { });
          else document.exitFullscreen();
        }}
      >
        <Maximize2 />
      </Button>
    </div>
  );
}
