import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  FolderPlus,
  Image as ImageIcon,
  Layers,
  LoaderCircle,
  MoveRight,
  Pencil,
  Plus,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  deleteMediaAlbum,
  getBackgroundObjectUrl,
  moveMediaToAlbum,
  isBackgroundAvailable,
  MAX_MEDIA_FILE_SIZE_BYTES,
  readBackgrounds,
  readMediaAlbums,
  saveMediaAlbum,
  stashBackground,
  type StoredBackground,
  type StoredMediaAlbum,
  type ScheduleMediaSnapshot,
} from '@/lib/local-workspace';
import type { Slide } from '@/lib/studio-data';

type Props = {
  onPresentSelection: (slides: Slide[], title: string, type: 'media' | 'album') => void;
  scheduleMedia?: ScheduleMediaSnapshot;
  onResolveMissingMedia: (item: StoredBackground, file: File) => Promise<void>;
};
type Selection = { type: 'media' | 'album'; id: string } | null;
type DraftEntry = { type: 'media'; id: string } | { type: 'file'; key: string; file: File };
type AlbumDraft = { id?: string; name: string; description: string; items: DraftEntry[] };

function createId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function mediaSlide(item: StoredBackground, albumId?: string): Slide {
  return {
    id: `media-${item.id}`,
    title: item.name,
    label: item.type === 'video' ? 'Video' : 'Image',
    text: '',
    kind: 'media',
    mediaUrl: `local-background:${item.id}`,
    mediaType: item.type,
    mediaAlbumId: albumId,
    audioMuted: true,
  };
}

export function MediaThumbnail({ item, large = false, deck = false, missing = false, onMissingChange }: { item: StoredBackground; large?: boolean; deck?: boolean; missing?: boolean; onMissingChange?: (id: string, missing: boolean) => void }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    setUrl('');
    if (item.type !== 'image') return () => { active = false; };
    void getBackgroundObjectUrl(item.id).then((value) => {
      if (active && value) setUrl(value);
      else if (active) {
        setFailed(true);
        onMissingChange?.(item.id, true);
      }
    }).catch(() => {
      if (active) {
        setFailed(true);
        onMissingChange?.(item.id, true);
      }
    });
    return () => { active = false; };
  }, [item, onMissingChange]);

  const sizeClass = large ? 'h-36 w-full' : deck ? 'h-16 w-full' : 'h-14 w-16 shrink-0';
  return (
    <div className={`overflow-hidden rounded-md border border-white/10 bg-black/40 ${sizeClass}`}>
      {item.type === 'image' && url && !failed
        ? <img
          src={url}
          alt={item.name}
          className="h-full w-full object-cover"
          onLoad={() => onMissingChange?.(item.id, false)}
          onError={() => {
            setFailed(true);
            onMissingChange?.(item.id, true);
          }}
        />
        : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-400">
            {item.type === 'video' ? <Video size={large ? 24 : 18} /> : <ImageIcon size={large ? 24 : 18} />}
            {(failed || missing) && <span className="text-[9px]">Missing file</span>}
          </div>
        )}
    </div>
  );
}

export function DeckMediaThumbnail({ slide }: { slide: Slide }) {
  const id = slide.mediaUrl?.startsWith('local-background:') ? slide.mediaUrl.slice('local-background:'.length) : '';
  if (id) return <MediaThumbnail item={{ id, name: slide.title, type: slide.mediaType === 'video' ? 'video' : 'image' }} deck />;
  return <div className="flex h-16 w-full items-center justify-center rounded-md border border-white/10 bg-black/40 text-slate-400"><Video size={20} /></div>;
}

function DraftFileThumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return (
    <div className="flex h-14 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black/30">
      {url ? <img src={url} alt={file.name} className="h-full w-full object-cover" /> : <Video size={18} className="text-primary" />}
    </div>
  );
}

function moveOrder<T>(items: T[], from: number, to: number) {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

function stopPresentationShortcuts(event: KeyboardEvent<HTMLDivElement>) {
  if (
    ['Enter', ' ', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'F1', 'F2', 'F3'].includes(event.key)
    || event.key.toLowerCase() === 'v'
    || event.key === '/'
    || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')
  ) event.stopPropagation();
}

export function MediaLibrary({ onPresentSelection, scheduleMedia, onResolveMissingMedia }: Props) {
  const [libraryMedia, setLibraryMedia] = useState<StoredBackground[]>([]);
  const [libraryAlbums, setLibraryAlbums] = useState<StoredMediaAlbum[]>([]);
  const [missingMediaIds, setMissingMediaIds] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection>(null);
  const [draft, setDraft] = useState<AlbumDraft | null>(null);
  const [moveMediaId, setMoveMediaId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draggedDraftIndex, setDraggedDraftIndex] = useState<number | null>(null);
  const [touchDraftIndex, setTouchDraftIndex] = useState<number | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const albumInput = useRef<HTMLInputElement>(null);
  const resolveInput = useRef<HTMLInputElement>(null);
  const resolveMediaRef = useRef<StoredBackground | null>(null);

  const refresh = async () => {
    const [nextMedia, nextAlbums] = await Promise.all([readBackgrounds(), readMediaAlbums()]);
    setLibraryMedia(nextMedia.filter((item) => item.purpose !== 'background'));
    setLibraryAlbums(nextAlbums);
  };

  useEffect(() => {
    void refresh().catch((reason) => {
      console.error('Could not load the media library.', reason);
      setError(reason instanceof Error ? reason.message : 'Could not load the media library.');
    });
  }, []);

  useEffect(() => {
    const firstItem = scheduleMedia?.media[0];
    if (!firstItem) {
      setSelection(null);
      return;
    }
    setSelection(firstItem.albumId
      ? { type: 'album', id: firstItem.albumId }
      : { type: 'media', id: firstItem.id });
  }, [scheduleMedia]);

  const media = useMemo(() => {
    const records = new Map(libraryMedia.map((item) => [item.id, item]));
    for (const saved of scheduleMedia?.media ?? []) {
      const current = records.get(saved.id);
      records.set(saved.id, { ...current, ...saved, blob: current?.blob, path: current?.path });
    }
    return [...records.values()];
  }, [libraryMedia, scheduleMedia]);
  const albums = useMemo(() => {
    const records = new Map(libraryAlbums.map((item) => [item.id, item]));
    for (const saved of scheduleMedia?.albums ?? []) {
      records.set(saved.id, { ...records.get(saved.id), ...saved });
    }
    return [...records.values()];
  }, [libraryAlbums, scheduleMedia]);

  const updateMissingMedia = useCallback((id: string, missing: boolean) => {
    setMissingMediaIds((current) => {
      if (current.has(id) === missing) return current;
      const next = new Set(current);
      if (missing) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all(media.map(async (item) => [item.id, !(await isBackgroundAvailable(item.id))] as const))
      .then((availability) => {
        if (!active) return;
        const nextMissing = new Set(availability.filter(([, missing]) => missing).map(([id]) => id));
        setMissingMediaIds((current) => (
          current.size === nextMissing.size && [...current].every((id) => nextMissing.has(id))
            ? current
            : nextMissing
        ));
      });
    return () => { active = false; };
  }, [media]);

  const selectedMedia = selection?.type === 'media' ? media.find((item) => item.id === selection.id) : undefined;
  const selectedAlbum = selection?.type === 'album' ? albums.find((item) => item.id === selection.id) : undefined;
  const albumItems = selectedAlbum
    ? selectedAlbum.mediaIds.flatMap((id) => {
      const item = media.find((candidate) => candidate.id === id);
      return item ? [item] : [];
    })
    : [];
  const standaloneItems = media.filter((item) => !item.albumId);

  async function uploadStandalone(files: File[]) {
    if (!files.length) return;
    setError('');
    setNotice('');
    setUploading(true);
    const failures: string[] = [];
    let added = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      setProgress(`Saving ${index + 1} of ${files.length}: ${file.name}`);
      try {
        await stashBackground(file, 'media');
        added += 1;
      } catch (reason) {
        failures.push(`${file.name}: ${reason instanceof Error ? reason.message : 'Upload failed.'}`);
      }
    }
    try {
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Media uploaded but the library could not refresh.');
    } finally {
      setUploading(false);
      setProgress('');
    }
    setNotice(`${added} file${added === 1 ? '' : 's'} added to the media library. They were not added to the deck.`);
    if (failures.length) setError(failures.join('\n'));
  }

  function chooseFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void uploadStandalone(files);
  }

  async function restoreMissingMedia(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    const item = resolveMediaRef.current;
    resolveMediaRef.current = null;
    if (!file || !item) return;
    setUploading(true);
    setError('');
    try {
      await onResolveMissingMedia(item, file);
      setMissingMediaIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      await refresh();
      setNotice(`Restored “${item.name}” using the selected file. Its schedule reference and deck order were preserved.`);
    } catch (reason) {
      console.error(`Could not restore missing media "${item.name}".`, reason);
      setError(reason instanceof Error ? reason.message : `Could not restore “${item.name}”.`);
    } finally {
      setUploading(false);
    }
  }

  function openCreateAlbum() {
    setError('');
    setDraft({ name: '', description: '', items: [] });
  }

  function openEditAlbum(album: StoredMediaAlbum) {
    setError('');
    setDraft({ id: album.id, name: album.name, description: album.description, items: album.mediaIds.map((id) => ({ type: 'media', id })) });
  }

  function addDraftFiles(files: File[]) {
    const allowed = files.filter((file) => file.type.startsWith('image/')
      || ['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type.toLowerCase()));
    const invalid = files.length - allowed.length;
    const tooLarge = allowed.filter((file) => file.size > MAX_MEDIA_FILE_SIZE_BYTES);
    const valid = allowed.filter((file) => file.size <= MAX_MEDIA_FILE_SIZE_BYTES);
    setDraft((current) => current ? {
      ...current,
      items: [...current.items, ...valid.map((file): DraftEntry => ({ type: 'file', key: createId(), file }))],
    } : current);
    setError([
      invalid ? `${invalid} file(s) have an unsupported type. Use images, MP4, MOV, or WebM.` : '',
      tooLarge.length ? `${tooLarge.map((file) => file.name).join(', ')} exceed the 200 MB per-file limit.` : '',
    ].filter(Boolean).join('\n'));
  }

  function onAlbumDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    addDraftFiles(Array.from(event.dataTransfer.files));
  }

  async function saveDraft() {
    if (!draft || !draft.name.trim()) {
      setError('Enter an album name before saving.');
      return;
    }
    setUploading(true);
    setError('');
    setNotice('');
    const mediaIds: string[] = [];
    const failed: string[] = [];
    try {
      const newFiles = draft.items.filter((item): item is Extract<DraftEntry, { type: 'file' }> => item.type === 'file');
      let completedFiles = 0;
      for (const entry of draft.items) {
        if (entry.type === 'media') {
          mediaIds.push(entry.id);
          continue;
        }
        completedFiles += 1;
        const { file } = entry;
        setProgress(`Saving ${completedFiles} of ${newFiles.length}: ${file.name}`);
        try {
          const item = await stashBackground(file, 'media');
          mediaIds.push(item.id);
        } catch (reason) {
          failed.push(`${file.name}: ${reason instanceof Error ? reason.message : 'Upload failed.'}`);
        }
      }
      const album = await saveMediaAlbum({
        id: draft.id ?? createId(),
        name: draft.name.trim(),
        description: draft.description.trim(),
        mediaIds,
      });
      setSelection({ type: 'album', id: album.id });
      if (moveMediaId) {
        await moveMediaToAlbum(moveMediaId, album.id);
        setSelection({ type: 'album', id: album.id });
        setMoveMediaId(null);
      }
      await refresh();
      setDraft(null);
      setNotice(failed.length
        ? `Album saved; ${failed.length} file(s) were not added. Choose those files again to retry.`
        : 'Album saved. Its media remains off the live output until you explicitly present it.');
      if (failed.length) setError(failed.join('\n'));
    } catch (reason) {
      console.error('Could not save this media album.', reason);
      setError(reason instanceof Error ? reason.message : 'Could not save this album.');
    } finally {
      setUploading(false);
      setProgress('');
    }
  }

  async function removeFromAlbum(item: StoredBackground) {
    try {
      await moveMediaToAlbum(item.id);
      await refresh();
      setNotice(`“${item.name}” returned to the standalone media library.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not remove media from this album.');
    }
  }

  async function removeAlbum(album: StoredMediaAlbum) {
    const confirmed = window.confirm(`Delete “${album.name}”? Its ${album.mediaIds.length} media file(s) will be retained in the standalone library.`);
    if (!confirmed) return;
    try {
      await deleteMediaAlbum(album.id);
      setSelection(null);
      await refresh();
      setNotice('Album deleted. Its media was kept in the standalone library.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete the album.');
    }
  }

  async function reorderDraft(from: number, to: number) {
    setDraft((current) => current ? { ...current, items: moveOrder(current.items, from, to) } : current);
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>, target: Selection) {
    const activeSelection = target;
    if (event.key === 'Enter' && activeSelection) {
      event.preventDefault();
      event.stopPropagation();
      setSelection(activeSelection);
      presentSelectionFor(activeSelection);
      return;
    }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const entries: Exclude<Selection, null>[] = [
        ...albums.map((item) => ({ type: 'album' as const, id: item.id })),
        ...standaloneItems.map((item) => ({ type: 'media' as const, id: item.id })),
      ];
      const currentIndex = entries.findIndex((entry) => entry.type === activeSelection?.type && entry.id === activeSelection?.id);
      const next = entries[currentIndex + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        setSelection(next);
        document.getElementById(`media-library-card-${next.type}-${next.id}`)?.focus();
      }
      return;
    }
    event.stopPropagation();
  }

  function presentSelectionFor(target: Exclude<Selection, null>) {
    const items = target.type === 'media'
      ? media.filter((item) => item.id === target.id)
      : (albums.find((album) => album.id === target.id)?.mediaIds ?? []).flatMap((id) => {
        const item = media.find((candidate) => candidate.id === id);
        return item ? [item] : [];
      });
    if (!items.length) {
      setError('This selection has no available media to load.');
      return;
    }
    const album = target.type === 'album' ? albums.find((item) => item.id === target.id) : undefined;
    onPresentSelection(
      items.map((item) => mediaSlide(item, album?.id)),
      album?.name ?? items[0]!.name,
      target.type,
    );
  }

  return (
    <section className="flex min-h-0 flex-col gap-3" aria-label="Media library" onKeyDownCapture={(event) => {
      if (!(event.target instanceof HTMLElement) || !event.target.closest('[role="button"]')) event.stopPropagation();
    }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-white">Media library</h3>
          <p className="text-[10px] text-slate-400">Select an item or album and press Enter to present it.</p>
        </div>
        <div className="flex gap-1.5">
          <input ref={uploadInput} type="file" accept="image/*,video/mp4,video/quicktime,video/webm" multiple className="hidden" onChange={chooseFiles} />
          <input ref={resolveInput} type="file" accept="image/*,video/mp4,video/quicktime,video/webm" className="hidden" onChange={restoreMissingMedia} />
          <Button size="sm" variant="outline" className="h-8 px-2 text-[10px]" disabled={uploading} onClick={() => uploadInput.current?.click()} title="Upload standalone media">
            <Upload size={13} className="mr-1" /> Upload
          </Button>
          <Button size="sm" className="h-8 px-2 text-[10px]" disabled={uploading} onClick={openCreateAlbum}>
            <FolderPlus size={13} className="mr-1" /> Album
          </Button>
        </div>
      </div>

      <div className="flex gap-2 text-[10px] text-slate-400">
        <span>{standaloneItems.length} standalone</span>
        <span>·</span>
        <span>{albums.length} album{albums.length === 1 ? '' : 's'}</span>
        <span>·</span>
        <span>200 MB max per file</span>
      </div>

      {uploading && <div className="flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1.5 text-[10px] text-primary"><LoaderCircle size={13} className="animate-spin" />{progress || 'Saving media…'}</div>}
      {error && <div role="alert" className="whitespace-pre-line rounded-md border border-rose-400/30 bg-rose-500/10 p-2 text-[10px] text-rose-200">{error}</div>}
      {notice && <div role="status" className="rounded-md border border-emerald-400/20 bg-emerald-500/5 p-2 text-[10px] text-emerald-200">{notice}</div>}

      <div className="grid min-h-0 grid-cols-1 gap-3">
        <div className="max-h-[42vh] min-h-32 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/10 p-1.5" aria-label="Albums and standalone media">
          {albums.map((album) => {
            const target = { type: 'album' as const, id: album.id };
            const firstImage = album.mediaIds.map((id) => media.find((item) => item.id === id)).find((item) => item?.type === 'image');
            return (
              <div key={album.id} id={`media-library-card-album-${album.id}`} role="button" tabIndex={0} aria-pressed={selection?.type === 'album' && selection.id === album.id} onFocus={() => setSelection(target)} onClick={() => setSelection(target)} onKeyDown={(event) => handleCardKeyDown(event, target)}
                className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-left ${selection?.type === 'album' && selection.id === album.id ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-white/5'}`}>
                {firstImage ? <MediaThumbnail item={firstImage} missing={missingMediaIds.has(firstImage.id)} onMissingChange={updateMissingMedia} /> : <div className="flex h-14 w-16 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-primary"><Layers size={19} /></div>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-white" title={album.name}>{album.name}</span>
                  <span className="block text-[10px] text-slate-400">{album.mediaIds.length} item{album.mediaIds.length === 1 ? '' : 's'} · Album</span>
                  {album.mediaIds.some((id) => missingMediaIds.has(id)) && <span className="block text-[9px] text-amber-300">Contains missing media</span>}
                </span>
                {selection?.type === 'album' && selection.id === album.id && <Check size={14} className="text-primary" />}
              </div>
            );
          })}
          {standaloneItems.map((item) => {
            const target = { type: 'media' as const, id: item.id };
            return (
              <div key={item.id} id={`media-library-card-media-${item.id}`} role="button" tabIndex={0} aria-pressed={selection?.type === 'media' && selection.id === item.id} onFocus={() => setSelection(target)} onClick={() => setSelection(target)} onKeyDown={(event) => handleCardKeyDown(event, target)}
                className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-left ${selection?.type === 'media' && selection.id === item.id ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-white/5'}`}>
                <MediaThumbnail item={item} missing={missingMediaIds.has(item.id)} onMissingChange={updateMissingMedia} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-white" title={item.name}>{item.name}</span>
                  <span className={`block text-[10px] ${missingMediaIds.has(item.id) ? 'text-amber-300' : 'text-slate-400'}`}>
                    {missingMediaIds.has(item.id) ? 'Missing file · schedule item' : item.type === 'video' ? 'Video' : 'Image'}{item.mimeType ? ` · ${item.mimeType}` : ''}
                  </span>
                </span>
                {selection?.type === 'media' && selection.id === item.id && <Check size={14} className="text-primary" />}
              </div>
            );
          })}
          {!albums.length && !standaloneItems.length && (
            <div className="p-5 text-center text-xs text-slate-400">
              <ImageIcon size={24} className="mx-auto mb-2 opacity-60" />
              Your media library is empty. Upload files or create an album to get started.
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-lg border border-white/10 bg-black/10 p-3">
          {selectedAlbum ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-bold text-white" title={selectedAlbum.name}>{selectedAlbum.name}</h4>
                  <p className="whitespace-pre-wrap text-[10px] text-slate-400">{selectedAlbum.description || 'No description'} · {albumItems.length} item(s)</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => openEditAlbum(selectedAlbum)} title="Edit album"><Pencil size={12} /></Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] text-rose-300" onClick={() => void removeAlbum(selectedAlbum)} title="Delete album"><Trash2 size={12} /></Button>
                </div>
              </div>
              <div className="max-h-44 space-y-1 overflow-y-auto">
                {albumItems.map((item, index) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-md bg-white/5 p-1.5">
                    <span className="w-5 text-center text-[10px] text-slate-500">{index + 1}</span>
                    <MediaThumbnail item={item} missing={missingMediaIds.has(item.id)} onMissingChange={updateMissingMedia} />
                    <span className="min-w-0 flex-1 truncate text-[10px] text-slate-200" title={item.name}>
                      {missingMediaIds.has(item.id) ? `Missing schedule item · ${item.name}` : item.name}
                    </span>
                    {missingMediaIds.has(item.id) && (
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[9px] text-amber-200" onClick={() => setSelection({ type: 'media', id: item.id })}>
                        Locate
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" title={`Return ${item.name} to standalone library`} onClick={() => void removeFromAlbum(item)}><MoveRight size={12} /></Button>
                  </div>
                ))}
                {!albumItems.length && <p className="p-3 text-center text-[10px] text-slate-500">This album is empty. Edit it to add media.</p>}
              </div>
              <p className="text-center text-[9px] text-slate-500">Press Enter to replace the deck and present this album in its saved order.</p>
            </div>
          ) : selectedMedia ? (
            <div className="flex flex-col gap-3">
              <MediaThumbnail item={selectedMedia} large missing={missingMediaIds.has(selectedMedia.id)} onMissingChange={updateMissingMedia} />
              <div className="min-w-0">
                <h4 className="break-all text-xs font-semibold text-white" title={selectedMedia.name}>{selectedMedia.name}</h4>
                <p className="mt-1 text-[10px] text-slate-400">{selectedMedia.type === 'video' ? 'Video' : 'Image'} · {selectedMedia.mimeType || 'Unknown format'} · {selectedMedia.size ? `${(selectedMedia.size / 1024 / 1024).toFixed(1)} MB` : 'Size unavailable'}</p>
                {missingMediaIds.has(selectedMedia.id) && (
                  <div className="mt-2 rounded-md border border-amber-400/30 bg-amber-500/10 p-2 text-[10px] text-amber-200">
                    Missing schedule media: “{selectedMedia.name}”. This deck item remains in its saved position.
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2">
                <Button variant="outline" className="h-8 text-[10px]" onClick={() => setMoveMediaId(selectedMedia.id)}><MoveRight size={12} className="mr-1" />Move to album</Button>
                {missingMediaIds.has(selectedMedia.id) && (
                  <Button className="h-8 text-[10px]" disabled={uploading} onClick={() => { resolveMediaRef.current = selectedMedia; resolveInput.current?.click(); }}>
                    <Upload size={12} className="mr-1" />Locate file to restore this item
                  </Button>
                )}
              </div>
              <p className="text-center text-[9px] text-slate-500">Press Enter to present this item. Additional standalone media is kept in the same deck.</p>
            </div>
          ) : (
            <div className="flex h-full min-h-36 flex-col items-center justify-center gap-2 text-center text-xs text-slate-500">
              <ImageIcon size={24} />
              Select an album or media item to view details and actions.
            </div>
          )}
        </div>
      </div>

      <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open && !uploading) setDraft(null); }}>
        <DialogContent onKeyDownCapture={stopPresentationShortcuts} className="max-h-[90vh] max-w-2xl overflow-y-auto border-white/10 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit media album' : 'Create media album'}</DialogTitle>
            <DialogDescription className="text-slate-400">Add media, then arrange the saved order. Files remain in your local media library.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <label className="block text-xs text-slate-300">Album name
                <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={100} className="mt-1 h-9 w-full rounded-md border border-white/15 bg-black/40 px-2 text-sm text-white outline-none focus:border-primary" />
              </label>
              <label className="block text-xs text-slate-300">Description (optional)
                <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={2} maxLength={500} className="mt-1 w-full resize-y rounded-md border border-white/15 bg-black/40 p-2 text-xs text-white outline-none focus:border-primary" />
              </label>
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={onAlbumDrop}
                className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4 text-center text-xs text-slate-300"
              >
                <Upload size={19} className="mx-auto mb-1 text-primary" />
                Drop images or videos here, or
                <Button type="button" variant="link" className="h-auto px-1 text-primary" onClick={() => albumInput.current?.click()}>choose files</Button>
                <p className="mt-1 text-[10px] text-slate-500">Images, MP4, MOV, WebM · 200 MB max per file</p>
                <input ref={albumInput} type="file" accept="image/*,video/mp4,video/quicktime,video/webm" multiple className="hidden" onChange={(event) => { addDraftFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-slate-400"><span>Album order</span><span>Drag to arrange, or use move buttons</span></div>
                {draft.items.map((entry, index) => {
                  const item = entry.type === 'media' ? media.find((candidate) => candidate.id === entry.id) : undefined;
                  const label = item?.name ?? (entry.type === 'file' ? entry.file.name : 'Unavailable media');
                  return (
                    <div key={entry.type === 'media' ? entry.id : entry.key} data-media-sort-index={index} draggable onDragStart={() => setDraggedDraftIndex(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedDraftIndex !== null) void reorderDraft(draggedDraftIndex, index); setDraggedDraftIndex(null); }}
                      onTouchStart={() => setTouchDraftIndex(index)}
                      onTouchEnd={(event) => {
                        if (touchDraftIndex === null) return;
                        const touch = event.changedTouches[0];
                        const target = touch && document.elementFromPoint(touch.clientX, touch.clientY)?.closest<HTMLElement>('[data-media-sort-index]');
                        if (target) void reorderDraft(touchDraftIndex, Number(target.dataset.mediaSortIndex));
                        setTouchDraftIndex(null);
                      }}
                      onTouchCancel={() => setTouchDraftIndex(null)}
                      className={`flex items-center gap-2 rounded-md border p-1.5 ${entry.type === 'media' ? 'border-white/10 bg-black/20' : 'border-dashed border-primary/30 bg-primary/5'}`}>
                      {item
                        ? <MediaThumbnail item={item} />
                        : entry.type === 'file' && <DraftFileThumbnail file={entry.file} />}
                      <span className="min-w-0 flex-1 truncate text-[10px]" title={label}>{label}</span>
                      <button type="button" aria-label={`Move ${label} up`} className="rounded p-1 hover:bg-white/10 disabled:opacity-30" disabled={index === 0} onClick={() => void reorderDraft(index, index - 1)}><ArrowUp size={13} /></button>
                      <button type="button" aria-label={`Move ${label} down`} className="rounded p-1 hover:bg-white/10 disabled:opacity-30" disabled={index === draft.items.length - 1} onClick={() => void reorderDraft(index, index + 1)}><ArrowDown size={13} /></button>
                      <button type="button" aria-label={`Remove ${label} from this album`} className="rounded px-1.5 py-1 text-[10px] text-rose-300 hover:bg-rose-500/10" onClick={() => setDraft({ ...draft, items: draft.items.filter((candidate) => candidate !== entry) })}>Remove</button>
                    </div>
                  );
                })}
              </div>
              {uploading && <div className="flex items-center gap-2 text-xs text-primary"><LoaderCircle size={14} className="animate-spin" />{progress}</div>}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={uploading} onClick={() => setDraft(null)}>Cancel</Button>
            <Button type="button" disabled={uploading || !draft?.name.trim()} onClick={() => void saveDraft()}>{uploading ? 'Saving…' : draft?.id ? 'Save changes' : 'Create album'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(moveMediaId)} onOpenChange={(open) => { if (!open) setMoveMediaId(null); }}>
        <DialogContent onKeyDownCapture={stopPresentationShortcuts} className="max-w-md border-white/10 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle>Move media to an album</DialogTitle>
            <DialogDescription className="text-slate-400">This changes the library organization only; it does not copy the file or affect the deck/output.</DialogDescription>
          </DialogHeader>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {albums.map((album) => (
              <button key={album.id} type="button" className="flex w-full items-center gap-2 rounded-md border border-white/10 p-2 text-left text-xs hover:bg-white/5" onClick={async () => {
                if (!moveMediaId) return;
                try {
                  await moveMediaToAlbum(moveMediaId, album.id);
                  setMoveMediaId(null);
                  await refresh();
                  setNotice(`Media moved to “${album.name}”.`);
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : 'Could not move this media.');
                }
              }}><Layers size={15} className="text-primary" /><span className="flex-1">{album.name}</span><span className="text-slate-500">{album.mediaIds.length}</span></button>
            ))}
            {!albums.length && <p className="p-2 text-xs text-slate-400">No albums yet. Create one to move this media.</p>}
          </div>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={openCreateAlbum}><Plus size={13} className="mr-1" /> Create album</Button>
            <Button type="button" variant="ghost" onClick={() => setMoveMediaId(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
