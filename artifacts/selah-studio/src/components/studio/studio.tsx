import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cloud,
  Copy,
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
} from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { chapters, initialTimeline, songs, songSlides, type Slide, type Song } from '@/lib/studio-data';
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
  saveLocalSong,
  saveTheme,
  saveWorkspacePreferences,
  stashBackground,
} from '@/lib/local-workspace';
import { getGetScriptureQueryKey, useGetScripture } from '@workspace/api-client-react';
import { usePushToTalk } from '@/hooks/use-push-to-talk';
import { parseBibleContent } from '@/lib/scripture-content';
import { searchPublicHymns, type PublicHymn } from '@/lib/song-search';
import {
  searchOfflineBible,
  fetchOfflinePassage,
  fetchChapterVersesSequence,
  getOfflineChapterVerses,
  type SearchVerseResult,
  type SequenceVerseItem,
} from '@/lib/offline-bible';
import { parseSpokenBibleReference, type ParsedSpokenReference } from '@/lib/spoken-bible-parser';

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
const defaultSlide: Slide = songSlides(defaultSong)[0] ?? welcomeSlide;
const psalmVerses = chapters['Psalms']?.verses ?? [];
const accents: [string, string][] = [
  ['teal', 'Neon Teal'],
  ['gold', 'Holy Gold'],
  ['purple', 'Deep Purple'],
];
const presets: [string, string][] = [
  ['Psalms', '23'],
  ['Romans', '8'],
  ['Genesis', '1'],
  ['John', '3'],
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
  const total = verses.length;
  return verses.map((verseText, index) => {
    const verseNum = numbers[index] ?? (index + 1);
    return {
      id: `${book}-${chapter}-${verseNum}`,
      title: `${canonicalBook} ${chapter}:${verseNum}`,
      label: total > 1 ? `Verse ${verseNum} (${index + 1}/${total})` : `Verse ${verseNum}`,
      kind: 'scripture',
      text: verseText,
      verses: [{ number: verseNum, text: verseText }],
    };
  });
}

function plausibleChapter(book: string, chapter: string) {
  const canonical = resolveBook(book);
  return Boolean(canonical && validChapter(canonical, chapter));
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

const bibleBookPattern = Object.keys(bibleCodes)
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
  .join('|');
const spokenReferencePattern = new RegExp(
  `(?:^|\\b)(${bibleBookPattern})\\s+(\\d+)\\s*(?::|,|\\s)\\s*(\\d+(?:\\s*[-–—]\\s*\\d+)?)\\b`,
  'i',
);

export function Studio() {
  const [builderOpen, setBuilderOpen] = useState(false);
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

  // Hymn Search
  const [publicHymnSearch, setPublicHymnSearch] = useState(false);
  const [publicHymnResults, setPublicHymnResults] = useState<PublicHymn[]>([]);
  const [publicHymnStatus, setPublicHymnStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [publicHymnError, setPublicHymnError] = useState('');

  // Background Selection
  const [scriptureBackground, setScriptureBackground] = useState('scripture-obsidian');
  const [scriptureBackgroundType, setScriptureBackgroundType] = useState<'image' | 'video'>('image');

  // Scripture Keyword & Full-text Search
  const [scriptureSearchQuery, setScriptureSearchQuery] = useState('');
  const [scriptureSearchResults, setScriptureSearchResults] = useState<SearchVerseResult[]>([]);
  const [isSearchingScripture, setIsSearchingScripture] = useState(false);
  const [selectedTranslation, setSelectedTranslation] = useState<string>('KJV');

  // Surrounding Sequence Engine
  const [sequenceVerses, setSequenceVerses] = useState<SequenceVerseItem[]>([]);
  const [highlightedVerses, setHighlightedVerses] = useState<number[]>([1]);

  // Panel-scoped keyboard focus
  const [activeFocus, setActiveFocus] = useState<'preview' | 'live'>('preview');

  // Spoken Bible Voice Feedback
  const [voiceFeedback, setVoiceFeedback] = useState<{
    transcript: string;
    parsed: ParsedSpokenReference | null;
  } | null>(null);

  const searchInput = useRef<HTMLInputElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const timelineSlides = useRef<Record<string, Slide[]>>({});
  const restoredCanvas = useRef<Slide[] | null>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const [librarySongs, setLibrarySongs] = useState(songs);
  const [bookFocused, setBookFocused] = useState(false);
  const [invalidField, setInvalidField] = useState('');
  const bookInput = useRef<HTMLInputElement>(null);
  const [theme, setTheme] = useState('teal');
  const [tab, setTab] = useState('Songs');
  const [search, setSearch] = useState('');
  const [song, setSong] = useState<Song>(defaultSong);
  const [slides, setSlides] = useState<Slide[]>(songSlides(defaultSong));
  const [selected, setSelected] = useState(0);

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
  const [timelineActive, setTimelineActive] = useState('opening');
  const [dragged, setDragged] = useState<string | null>(null);
  const [book, setBook] = useState('Psalms');
  const [chapter, setChapter] = useState('23');
  const [verse, setVerse] = useState('1');
  const [checked, setChecked] = useState<number[]>([0]);
  const [transcription, setTranscription] = useState('');
  const [notice, setNotice] = useState('');
  const [countdown, setCountdown] = useState(15 * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [outputName, setOutputName] = useState('Main sanctuary');
  const channel = useRef<BroadcastChannel | null>(null);
  const outputRef = useRef(output);
  const chapterInput = useRef<HTMLInputElement>(null);
  const verseInput = useRef<HTMLInputElement>(null);
  const voiceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVerse = useRef(0);

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
  const activeSlide = slides[selected] || slides[0] || welcomeSlide;
  const availableChapter = validChapter(book, chapter);
  const chapterVerses = getChapter(book, chapter);
  const bookMatches = matchingBooks(book);

  // Take slide live directly
  const broadcast = useCallback((slide: Slide) => {
    setOutput({ slide, mode: 'normal' });
  }, []);

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
      if (voiceTimeout.current) clearTimeout(voiceTimeout.current);
    };
  }, []);

  // Initialize workspace from local Dexie / preferences
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
        if (preferences.outputName) setOutputName(preferences.outputName);
        setThemeLoaded(true);
        setPreferencesLoaded(true);
        const savedSong = [...songs, ...saved].find((item) => item.title === restoredCanvas.current?.[0]?.title);
        if (savedSong) setSong(savedSong);
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
    try {
      localStorage.setItem('selah-service-timeline', JSON.stringify(timeline));
    } catch {
      setSavedState('error');
    }
    try {
      localStorage.setItem('selah-service-slides', JSON.stringify(timelineSlides.current));
    } catch {
      setSavedState('error');
    }
  }, [timeline]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    void saveWorkspacePreferences({ autoPush, scriptureBackground, scriptureBackgroundType, outputName }).catch(
      () => setSavedState('error'),
    );
  }, [autoPush, scriptureBackground, scriptureBackgroundType, outputName, preferencesLoaded]);

  useEffect(() => {
    if (!themeLoaded) return;
    setSavedState('saving');
    void saveTheme(theme)
      .then(() => setSavedState('saved'))
      .catch(() => setSavedState('error'));
  }, [theme, themeLoaded]);

  // Online Scripture handling with automatic Offline KJV fallback
  useEffect(() => {
    if (!lookupParams) return;

    if (scriptureQuery.data) {
      const passage = scriptureQuery.data;
      const parsed = parseBibleContent(passage.content);
      const requestedIndexes = parseVerseRange(verse, Number.MAX_SAFE_INTEGER);
      const requestedNumbers = requestedIndexes?.map((index) => index + 1) ?? [];
      const selectedRows = parsed.verses
        .map((text, index) => ({ text, number: parsed.verseNumbers[index] ?? index + 1 }))
        .filter((row) => !requestedNumbers.length || requestedNumbers.includes(row.number));
      const selectedVerses = selectedRows.map((row) => row.text);
      const selectedNumbers = selectedRows.map((row) => row.number);

      if (selectedVerses.length) {
        const next = compileMappedScripture(book, chapter, selectedVerses, selectedNumbers).map((slide) => ({
          ...slide,
          background: scriptureBackground,
          backgroundType: scriptureBackgroundType,
        }));
        setSlides(next);
        setSelected(0);
        loadPreview(next[0] ?? initialScripture);
        setLookupError('');
        void cachePassage({
          bibleId: lookupParams.bibleId,
          book,
          chapter: Number(chapter),
          reference: passage.reference,
          verses: parsed.verses,
          verseNumbers: parsed.verseNumbers,
          copyright: passage.copyright,
        }).catch(() => undefined);
        setLookupParams(null);
        return;
      }
    }

    // Automatic Offline KJV Fallback when online fetch fails or produces no verses
    if (scriptureQuery.error || (scriptureQuery.isFetched && !scriptureQuery.data)) {
      const requestedIndexes = parseVerseRange(verse, 200) || [0];
      const numbers = requestedIndexes.map((i) => i + 1);
      void fetchOfflinePassage(book, Number(chapter), numbers).then((offlinePassage) => {
        if (offlinePassage && offlinePassage.verses.length) {
          const next = compileMappedScripture(book, chapter, offlinePassage.verses, offlinePassage.verseNumbers).map(
            (slide) => ({
              ...slide,
              background: scriptureBackground,
              backgroundType: scriptureBackgroundType,
            }),
          );
          setSlides(next);
          setSelected(0);
          loadPreview(next[0] ?? initialScripture);
          setLookupError('');
          setNotice(`Using offline KJV for ${offlinePassage.reference}`);
        } else {
          setLookupError('Could not load passage from online service or offline KJV.');
        }
      });
      setLookupParams(null);
    }
  }, [scriptureQuery.data, scriptureQuery.error, scriptureQuery.isFetched, lookupParams]);

  // Scripture Keyword & Full-Text Search Handler
  useEffect(() => {
    const q = scriptureSearchQuery.trim();
    if (q.length < 2) {
      setScriptureSearchResults([]);
      setIsSearchingScripture(false);
      return;
    }
    let alive = true;
    setIsSearchingScripture(true);
    const timeout = setTimeout(() => {
      void searchOfflineBible(q, 10).then((results) => {
        if (!alive) return;
        setScriptureSearchResults(results);
        setIsSearchingScripture(false);
      });
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, [scriptureSearchQuery]);

  // Public Hymn Search
  useEffect(() => {
    const query = search.trim();
    if (!publicHymnSearch || query.length < 2) {
      setPublicHymnResults([]);
      setPublicHymnStatus('idle');
      return;
    }
    let current = true;
    setPublicHymnStatus('loading');
    void searchPublicHymns(query)
      .then((results) => {
        if (!current) return;
        setPublicHymnResults(results);
        setPublicHymnStatus('ready');
      })
      .catch((error) => {
        if (!current) return;
        setPublicHymnResults([]);
        setPublicHymnStatus('error');
        setPublicHymnError(error instanceof Error ? error.message : 'Error searching hymn archive.');
      });
    return () => {
      current = false;
    };
  }, [publicHymnSearch, search]);

  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => setCountdown((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

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
    loadPreview(slide);
  }

  // Navigation for Staged Preview
  function stepPreview(direction: number) {
    if (!slides.length) return;
    const nextIdx = Math.max(0, Math.min(slides.length - 1, selected + direction));
    selectSlide(nextIdx);
  }

  // Navigation for Live Output (synchronized with active slides)
  function stepLive(direction: number) {
    if (!slides.length) return;
    const nextIdx = Math.max(0, Math.min(slides.length - 1, selected + direction));
    setSelected(nextIdx);
    const targetSlide = slides[nextIdx];
    if (targetSlide) {
      loadPreview(targetSlide);
      broadcast(targetSlide);
    }
  }

  // Instant display of a Scripture search result
  function displaySearchResult(result: SearchVerseResult, goLive = true) {
    setBook(result.book);
    setChapter(String(result.chapter));
    setVerse(String(result.verse));
    setScriptureSearchQuery('');
    setScriptureSearchResults([]);

    const slide: Slide = {
      id: `${result.book}-${result.chapter}-${result.verse}`,
      title: result.reference,
      label: `Verse ${result.verse}`,
      text: result.text,
      kind: 'scripture',
      background: scriptureBackground,
      backgroundType: scriptureBackgroundType,
    };

    setSlides([slide]);
    setSelected(0);
    loadPreview(slide);

    if (goLive) {
      broadcast(slide);
      setNotice(`Displayed ${result.reference} Live`);
    }
  }

  // Global & Panel-Scoped Keyboard Navigation
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      // Voice Result shortcuts when feedback popover is open
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

      // Push-to-Talk via Space or V
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

      // Function Panic Keys (F1: Blackout, F2: Clear Text, F3: Logo)
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

      // Enter takes Preview slide to Live
      if (e.key === 'Enter') {
        e.preventDefault();

        // If the user has configured ANY highlights via typing or clicking,
        // execute the compilation and projection routing right now!
        if (highlightedVerses.length > 0) {
          displayHighlightedVerses(autoPush);
        } else if (slides[selected]) {
          // Fallback: If no highlights exist, project whatever is in the active workspace slide
          broadcast(slides[selected]!);
        }
        return;
      }

      // Panel-Scoped Arrow Navigation
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (activeFocus === 'live') {
          stepLive(1);
        } else {
          stepPreview(1);
        }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (activeFocus === 'live') {
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

  function loadSong(item: Song) {
    const next = songSlides(item);
    setSong(item);
    setSlides(next);
    setSelected(0);
    loadPreview(next[0] ?? welcomeSlide);
    setTab('Songs');
  }

  function parseLyrics(value: string) {
    setLyrics(value);
    const chunks = value.trim().split(/\n\s*\n/).filter(Boolean);
    if (!chunks.length) return;
    const customSong = { title: 'Untitled worship song', author: 'Your lyrics', tag: 'Custom', lyrics: chunks };
    setSong(customSong);
    const next = songSlides(customSong);
    setSlides(next);
    setSelected(0);
    loadPreview(next[0] ?? welcomeSlide);
  }

  function pickBook(value: string) {
    const match = resolveBook(value);
    if (!match) {
      setInvalidField('book');
      return false;
    }
    setBook(match);
    setChapter(String(chapters[match]?.chapter ?? 1));
    setVerse('1');
    setChecked([]);
    setInvalidField('');
    setBookFocused(false);
    return true;
  }

  // Surrounding Sequence Handlers
  const loadSequence = useCallback((b: string, c: string | number, highlightRange?: number[]) => {
    void fetchChapterVersesSequence(b, c).then((seq) => {
      if (seq.length) {
        setSequenceVerses(seq);
        if (highlightRange && highlightRange.length) {
          setHighlightedVerses(highlightRange);
        }
      }
    });
  }, []);

  useEffect(() => {
    loadSequence(book, chapter, checked.map((i) => i + 1));
  }, [book, chapter, loadSequence]);

  function toggleSequenceVerse(vNum: number) {
    setHighlightedVerses((prev) => {
      const exists = prev.includes(vNum);
      const updated = exists ? prev.filter((n) => n !== vNum) : [...prev, vNum].sort((a, b) => a - b);

      if (updated.length) {
        // Group chronologically sorted highlights into readable discrete components
        // e.g., [1, 2, 3, 5] turns into "1-3,5" instead of erasing into "1-5"
        const customString = updated.reduce((acc, current, idx, arr) => {
          if (idx === 0) return `${current}`;
          if (current === arr[idx - 1] + 1) {
            if (idx === arr.length - 1 || arr[idx + 1] !== current + 1) {
              return acc.endsWith('-') ? `${acc}${current}` : `${acc}-${current}`;
            }
            return acc.endsWith('-') ? acc : `${acc}-`;
          }
          // Handle isolated jumps gracefully with commas
          return acc.endsWith('-') ? `${acc.slice(0, -1)},${current}` : `${acc},${current}`;
        }, '');

        setVerse(customString);
      } else {
        setVerse('');
      }
      return updated;
    });
  }

  // 1. UNIFIED PLAYLIST COMPILER & PROJECTION FORCE ENGINE
  function displayHighlightedVerses(takeLive = autoPush) {
    if (!highlightedVerses.length) {
      setNotice('Highlight at least one verse to display.');
      return;
    }

    // Chronologically sort selected verses (e.g., [1, 2, 3, 5])
    const numbers = [...highlightedVerses].sort((a, b) => a - b);

    void fetchOfflinePassage(book, Number(chapter), numbers).then((offlinePassage) => {
      if (offlinePassage?.verses.length) {
        // Compile ONLY the cherry-picked verses into slides
        const next = compileMappedScripture(
          book,
          chapter,
          offlinePassage.verses,
          offlinePassage.verseNumbers
        ).map((slide) => ({
          ...slide,
          background: scriptureBackground,
          backgroundType: scriptureBackgroundType,
        }));

        // 1. Update the workspace deck immediately
        setSlides(next);
        setSelected(0); // Lock focus cursor directly onto the first slide of your custom playlist

        const firstSelectedSlide = next[0];
        if (firstSelectedSlide) {
          // 2. FORCE update directly to the Preview Monitor state
          setStorePreview(firstSelectedSlide);

          // 3. If Live Sync is on (or user clicked 'Display Live'), push straight to the projector screen
          if (takeLive) {
            setOutput({ slide: firstSelectedSlide, mode: 'normal' });
            setStoreLive(firstSelectedSlide);
            setNotice(`Projected Selection Live`);
          } else {
            // Load preview track states normally
            const routed = routePreview(firstSelectedSlide, false);
            setStorePreview(routed.preview);
            setNotice(`Staged Selection in Preview`);
          }
        }
      } else {
        setLookupError('Could not process structural passage sequence formatting.');
      }
    });
  }

  // 2. MANUAL FIELD ENTRY CONTROLLER (Forces immediate execution)
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

    // Immediately hand over control to the playlist engine to run the build!
    setTimeout(() => {
      displayHighlightedVerses(takeLiveNow);
    }, 10);
  }


  function chooseScriptureBackground(url: string, type: 'image' | 'video', id?: string) {
    const nextBackground = id ? (id.startsWith('scripture-') ? id : `local-background:${id}`) : url;
    setScriptureBackground(nextBackground);
    setScriptureBackgroundType(type);
    setSlides((items) =>
      items.map((slide) =>
        slide.kind === 'scripture' ? { ...slide, background: nextBackground, backgroundType: type } : slide,
      ),
    );
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
          setSelected(0);
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
    setNotice('Added to your service timeline');
  }

  function loadTimeline(id: string) {
    setTimelineActive(id);
    const item = timeline.find((t) => t.id === id);
    if (!item) return;
    const saved = timelineSlides.current[id];
    if (saved?.[0]) {
      setSlides(saved);
      setSelected(0);
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
      setSelected(0);
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

          {/* Top Fixed LIVE BROADCAST Pulse */}
          <div className="flex items-center gap-3">
            <div className={`live-broadcast-pill ${!isLive ? 'off-air' : ''}`}>
              <span className="live-pulsing-dot" />
              <span>{isLive ? 'ON AIR' : output.mode.toUpperCase()}</span>
              {isLive && <span className="opacity-70 font-normal truncate max-w-[160px]">| {output.slide.title}</span>}
            </div>

            {/* Prominent Push to Talk Trigger */}
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
                <span>{voice.transcribing ? 'Transcribing…' : listening ? 'Listening…' : 'Push to Talk'}</span>
              </button>
            </div>
          </div>

          {/* Voice Result Popover with Speech Recognition Feedback & Enter-to-Display */}
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
                    <Check size={13} className="mr-1" /> Display Live (Enter ↵)
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Actions & Theme Picker */}
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
            <span className="saved">
              <CheckCheck size={13} /> Saved locally on device
            </span>
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
        <main className="workspace">
          {/* Left Panel: Resource Library */}
          <aside className="library-panel">
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
              {/* Songs Tab */}
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
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={() => setPublicHymnSearch((open) => !open)}
                    >
                      <BookOpen size={13} /> {publicHymnSearch ? 'Hide Open Hymnal' : 'Open Hymnal (>1,000)'}
                    </Button>
                  </div>

                  {publicHymnSearch && (
                    <div className="cloud-vault">
                      <div className="builder-label">
                        PUBLIC DOMAIN HYMNALS <span className="demo-label">OFFLINE ARCHIVE</span>
                      </div>
                      {search.trim().length < 2 && (
                        <p className="hymn-catalog-status">Type 2+ letters in search to query 1,000+ hymns…</p>
                      )}
                      {publicHymnStatus === 'loading' && (
                        <p className="hymn-catalog-status">Searching offline Open Hymnal archive…</p>
                      )}
                      {publicHymnResults.map((item) => (
                        <Button
                          variant="ghost"
                          className="cloud-result"
                          key={item.id}
                          onClick={() => {
                            setBuilderMode('song');
                            setBuilderSong(item);
                            setBuilderOpen(true);
                          }}
                        >
                          <span>
                            <strong>{item.title}</strong>
                            <small>{item.author} · Open Hymnal</small>
                          </span>
                          <Plus size={14} />
                        </Button>
                      ))}
                    </div>
                  )}

                  <div className="song-list">
                    {librarySongs
                      .filter((item) => `${item.title} ${item.author}`.toLowerCase().includes(search.toLowerCase()))
                      .map((item) => (
                        <Button
                          key={`${item.kind ?? 'song'}:${item.title}`}
                          variant="ghost"
                          className={`song-row ${song.title === item.title ? 'active' : ''}`}
                          onClick={() => loadSong(item)}
                        >
                          <span className="song-icon">
                            <Music2 size={16} />
                          </span>
                          <span className="song-info">
                            <strong>{item.title}</strong>
                            <small>{item.author}</small>
                          </span>
                          <span className="song-count">{item.lyrics.length}</span>
                        </Button>
                      ))}
                  </div>

                  <div className="drop-zone">
                    <div>
                      <span className="upload-icon">
                        <Upload size={16} />
                      </span>
                      <strong>Quick Paste Lyrics</strong>
                      <p>Blank line separates verses automatically.</p>
                    </div>
                    <textarea
                      aria-label="Paste lyrics"
                      placeholder="Paste CCLI or song lyrics here..."
                      value={lyrics}
                      onChange={(e) => parseLyrics(e.target.value)}
                    />
                  </div>
                </>
              )}

              {/* Scriptures Tab */}
              {tab === 'Scriptures' && (
                <>
                  <div className="subsection-title flex items-center justify-between">
                    <span>KEYWORD / PASSAGE SEARCH</span>
                    <div className="flex items-center gap-1">
                      {Object.entries(BIBLE_TRANSLATIONS).map(([key, trans]) => (
                        <button
                          key={key}
                          type="button"
                          className={`px-1.5 py-0.5 text-[9px] font-bold rounded transition-colors ${selectedTranslation === key
                            ? 'bg-primary text-black shadow-sm'
                            : 'bg-white/5 text-slate-400 hover:bg-white/10'
                            }`}
                          onClick={() => {
                            setSelectedTranslation(key);
                            setNotice(`Bible translation set to ${trans.label}`);
                          }}
                          title={`Switch to ${trans.label}`}
                        >
                          {key}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Keyword / Reference Fast Search */}
                  <div className="scripture-search-wrap">
                    <label className="search-input">
                      <Search size={15} />
                      <input
                        aria-label="Search scripture keywords or references"
                        placeholder="e.g. for god so loved, or John 3:16"
                        value={scriptureSearchQuery}
                        onChange={(e) => setScriptureSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && scriptureSearchResults[0]) {
                            e.preventDefault();
                            displaySearchResult(scriptureSearchResults[0], true);
                          }
                        }}
                      />
                    </label>

                    {/* Instant Search Dropdown */}
                    {scriptureSearchResults.length > 0 && (
                      <div className="scripture-results-dropdown">
                        {scriptureSearchResults.map((res) => (
                          <button
                            key={res.reference}
                            type="button"
                            className="scripture-result-item"
                            onClick={() => displaySearchResult(res, true)}
                          >
                            <strong>{res.reference}</strong>
                            <p>{res.text}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Manual Passage Selector with Auto-Highlight & Boundary Validation */}
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
                        }}
                        onKeyDown={(event) => {
                          if (['Enter', 'Tab', 'ArrowRight'].includes(event.key)) {
                            event.preventDefault();
                            const matches = matchingBooks(book);
                            const resolved = matches[0] || resolveBook(book) || book;
                            setBook(resolved);
                            pickBook(resolved);
                            chapterInput.current?.focus();
                            chapterInput.current?.select();
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
                                pickBook(name);
                                chapterInput.current?.focus();
                                chapterInput.current?.select();
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
                        if (num > maxCh) {
                          setInvalidField('chapter');
                          setTimeout(() => setInvalidField(''), 600);
                          return;
                        }
                        setInvalidField('');
                        setChapter(val);
                      }}
                      onKeyDown={(e) => {
                        if (['Enter', 'Tab', 'ArrowRight'].includes(e.key)) {
                          e.preventDefault();
                          if (!chapter || chapter === '0') setChapter('1');
                          verseInput.current?.focus();
                          verseInput.current?.select();
                        } else if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0) {
                          e.preventDefault();
                          bookInput.current?.focus();
                          bookInput.current?.select();
                        }
                      }}
                    />
                    <span>:</span>
                    <input
                      data-testid="input-bible-verse-range"
                      ref={verseInput}
                      aria-label="Verse or range"
                      placeholder="1-5"
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
                        if (!/^[\d,-]+$/.test(val)) return; // Allow commas for discrete inputs like 1,2,3,5
                        setVerse(val);

                        // Parse out discrete highlights automatically if commas or dashes are typed
                        const maxV = getMaxVerses(book, chapter || '1');
                        const inlineIndices = parseVerseRange(val, maxV);
                        if (inlineIndices) {
                          setHighlightedVerses(inlineIndices.map(i => i + 1));
                        }
                      }}
                      onKeyDown={(e) => {
                        // Enter takes Preview slide to Live or packages the highlighted playlist selection
                        if (e.key === 'Enter') {
                          e.preventDefault();

                          // If the operator has multiple discrete highlights active in the sidebar sequence,
                          // compile and project that playlist instantly.
                          if (highlightedVerses.length > 0) {
                            displayHighlightedVerses(autoPush);
                          } else if (slides[selected]) {
                            // Fallback: If no custom checklist highlights are present, take current preview live
                            broadcast(slides[selected]!);
                          }
                          return;
                        }
                        else if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0) {
                          e.preventDefault();
                          chapterInput.current?.focus();
                          chapterInput.current?.select();
                        }
                      }}

                    />

                  </div>

                  {/* Surrounding Sequence Engine */}
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
                          Clear Highlighted
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2 text-primary"
                          onClick={() => setHighlightedVerses(sequenceVerses.map((v) => v.verseNumber))}
                        >
                          Select All
                        </Button>
                        <Button
                          size="sm"
                          className="h-6 text-[10px] px-2.5 bg-primary text-black font-semibold"
                          disabled={!highlightedVerses.length}
                          onClick={() => displayHighlightedVerses(autoPush)}
                        >
                          Display {autoPush ? 'Live' : 'Preview'} [↵]
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

                  <div className="presets">
                    {presets.map(([b, c]) => (
                      <Button
                        key={b}
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setBook(b);
                          setChapter(c);
                          setVerse('1');
                          previewVerse(false);
                        }}
                      >
                        {b} {c}
                      </Button>
                    ))}
                  </div>

                  <div className="mt-2">
                    <Button
                      className="w-full bg-primary text-black font-bold uppercase tracking-wider text-xs h-9"
                      onClick={() => displayHighlightedVerses(autoPush)}
                    >
                      <Radio size={14} className="mr-1.5" />
                      {autoPush ? 'Project Live Instantly [↵]' : 'Update Preview Monitor [↵]'}
                    </Button>
                  </div>


                  <div className="mt-4">
                    <SectionLabel icon={<ImageIcon size={14} />}>SCRIPTURE BACKGROUND</SectionLabel>
                    <BackgroundPicker value={scriptureBackground} onChoose={chooseScriptureBackground} />
                  </div>
                </>
              )}

              {/* Media Tab */}
              {tab === 'Media' && (
                <>
                  <SectionLabel icon={<ImageIcon size={14} />}>ROYALTY-FREE WORSHIP MEDIA</SectionLabel>
                  <BackgroundPicker
                    presets={false}
                    onChoose={(url, type, id) => {
                      const slide: Slide = {
                        id: `media-${Date.now()}`,
                        title: 'Media Background',
                        label: type === 'video' ? 'Motion Loop' : 'Atmospheric Still',
                        text: '',
                        kind: 'media',
                        background: url,
                        backgroundType: type,
                      };
                      setSlides([slide]);
                      setSelected(0);
                      loadPreview(slide);
                    }}
                  />
                </>
              )}

              {/* Schedules Tab */}
              {tab === 'Schedules' && (
                <>
                  <SectionLabel icon={<ListMusic size={14} />}>SERVICE TIMELINE</SectionLabel>
                  {timeline.map((item, i) => (
                    <Button
                      key={item.id}
                      className="schedule-row"
                      variant="ghost"
                      onClick={() => loadTimeline(item.id)}
                    >
                      <span>{String(i + 1).padStart(2, '0')}</span>
                      <strong>{item.title}</strong>
                      <ChevronRight size={14} />
                    </Button>
                  ))}
                  <Button variant="outline" className="wide-button mt-3" onClick={addTimeline}>
                    <Plus size={14} /> Add current slide to schedule
                  </Button>
                </>
              )}
            </div>
          </aside>

          {/* Center Stage: DUAL WORKSTATION (Preview & Fixed Live Output) */}
          <section className="dual-workstation">
            {/* Left: PREVIEW MONITOR (Staged) */}
            <div
              className={`monitor-card ${activeFocus === 'preview' ? 'has-focus' : ''}`}
              tabIndex={0}
              onClick={() => setActiveFocus('preview')}
              onFocus={() => setActiveFocus('preview')}
            >
              <div className="monitor-header">
                <h3>
                  <Layers size={14} className="text-primary" />
                  <span>PREVIEW MONITOR</span>
                  <small className="text-muted-foreground font-normal">
                    (Slide {slides.length ? selected + 1 : 0} of {slides.length})
                  </small>
                </h3>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {activeFocus === 'preview' ? 'Focused (Arrows control preview)' : 'Click to Focus'}
                </span>
              </div>

              <div className="monitor-screen-wrap">
                <SlideScreen slide={activeSlide} />
              </div>

              <div className="monitor-footer">
                <div className="monitor-nav-btns">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selected <= 0}
                    onClick={() => stepPreview(-1)}
                  >
                    <ArrowLeft size={14} className="mr-1" /> Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selected >= slides.length - 1}
                    onClick={() => stepPreview(1)}
                  >
                    Next <ArrowRight size={14} className="ml-1" />
                  </Button>
                </div>

                <Button className="take-live-btn" onClick={() => broadcast(activeSlide)}>
                  <Radio size={14} className="mr-1" /> TAKE LIVE (Enter ↵)
                </Button>
              </div>
            </div>

            {/* Right: FIXED LIVE OUTPUT MONITOR (What Congregation Sees) */}
            <div
              className={`monitor-card live-monitor ${activeFocus === 'live' ? 'has-focus' : ''}`}
              tabIndex={0}
              onClick={() => setActiveFocus('live')}
              onFocus={() => setActiveFocus('live')}
            >
              <div className="monitor-header">
                <h3>
                  <span className="live-pulsing-dot" />
                  <span className="text-red-400">PROJECTOR OUTPUT</span>
                  <small className="text-muted-foreground font-normal">({outputName})</small>
                </h3>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] uppercase font-bold tracking-wider ${autoPush ? 'text-primary' : 'text-slate-400'}`}>
                    {autoPush ? 'LIVE SYNC ON' : 'LIVE SYNC OFF'}
                  </span>
                  <Switch
                    checked={autoPush}
                    onCheckedChange={(val) => {
                      setAutoPush(val);
                      setStoreAuto(val);
                      if (val) broadcast(activeSlide);
                      setNotice(val ? 'Live Sync ON: Passages broadcast immediately' : 'Live Sync OFF: Passages stage in preview first');
                    }}
                    title="Toggle immediate live broadcasting"
                  />
                </div>
              </div>

              <div className="monitor-screen-wrap">
                <SlideScreen slide={output.slide} mode={output.mode} />
              </div>

              <div className="monitor-footer">
                <div className="monitor-nav-btns">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selected <= 0}
                    onClick={() => stepLive(-1)}
                    title="Previous live verse / slide"
                  >
                    <ArrowLeft size={14} className="mr-1" /> Prev Live
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selected >= slides.length - 1}
                    onClick={() => stepLive(1)}
                    title="Next live verse / slide"
                  >
                    Next Live <ArrowRight size={14} className="ml-1" />
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-8 text-xs ${output.mode === 'blackout' ? 'text-red-400 font-bold' : ''}`}
                    onClick={() =>
                      setOutput((o) => ({ ...o, mode: o.mode === 'blackout' ? 'normal' : 'blackout' }))
                    }
                  >
                    <Square size={13} className="mr-1" /> Black
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-8 text-xs ${output.mode === 'clear' ? 'text-amber-400 font-bold' : ''}`}
                    onClick={() =>
                      setOutput((o) => ({ ...o, mode: o.mode === 'clear' ? 'normal' : 'clear' }))
                    }
                  >
                    <TextCursorInput size={13} className="mr-1" /> Clear Text
                  </Button>
                </div>
              </div>
            </div>
          </section>
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
                  loadSong(item);
                  setBuilderOpen(false);
                  setSavedState('saved');
                  setNotice(`${item.kind === 'sermon' ? 'Sermon' : 'Song'} saved to local device`);
                })
                .catch(() => setSavedState('error'));
            }}
          />
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
      <SlideScreen slide={output.slide} mode={output.mode} />
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