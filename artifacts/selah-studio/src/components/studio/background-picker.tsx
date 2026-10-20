import { useEffect, useRef, useState } from 'react';
import { Check, Film, Image as ImageIcon, Sparkles, Upload, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getBackgroundBlob, readBackgrounds, readScriptureTheme, saveScriptureTheme, stashBackground, type StoredBackground } from '@/lib/local-workspace';
import { motionLoops, stillScenes } from '@/lib/media-library-presets';

const mountain = { url: '/selah-atmosphere.svg' };
type BackgroundAsset = Omit<StoredBackground, 'blob' | 'path'> & { url: string };

export function BackgroundPicker({
  value,
  onChoose,
  presets = true,
}: {
  value?: string;
  onChoose: (url: string, type: 'image' | 'video', id?: string) => void;
  presets?: boolean;
}) {
  const [tab, setTab] = useState<'motion' | 'stills' | 'uploads' | 'themes'>('motion');
  const [assets, setAssets] = useState<BackgroundAsset[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => {
    let mounted = true;
    readBackgrounds()
      .then(async (items) => {
        if (!mounted) return;
        const next = (
          await Promise.all(
            items.map(async (item) => {
              const blob = await getBackgroundBlob(item.id);
              if (!blob) return null;
              const url = URL.createObjectURL(blob);
              urls.current.push(url);
              return { id: item.id, name: item.name, type: item.type, url };
            }),
          )
        ).filter((item): item is BackgroundAsset => item !== null);

        setAssets(next);
        const selected = await readScriptureTheme();
        const asset = next.find((item) => item.id === selected);
        if (presets && asset) onChoose(`local-background:${asset.id}`, asset.type, asset.id);
        else if (presets && selected.startsWith('scripture-')) onChoose(selected, 'image', selected);
      })
      .catch(() => setStatus('Local storage unavailable.'));
    return () => {
      mounted = false;
    };
  }, []);

  function choose(url: string, type: 'image' | 'video', id: string) {
    onChoose(url, type, id);
    if (presets) {
      void saveScriptureTheme(id).catch(() => setStatus('Preference could not be saved.'));
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setStatus('');
    try {
      for (const file of Array.from(files)) {
        const item = await stashBackground(file);
        const blob = await getBackgroundBlob(item.id);
        if (!blob) throw new Error('Could not read saved background.');
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        setAssets((items) => [...items, { id: item.id, name: item.name, type: item.type, url }]);
        choose(url, item.type, item.id);
      }
      setStatus('Saved to your device library');
      setTab('uploads');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save file.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }


  return (
    <div className="bg-picker-container">
      {/* Category Tabs */}
      <div className="bg-picker-tabs">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={tab === 'motion' ? 'active' : ''}
          onClick={() => setTab('motion')}
        >
          <Film size={13} />
          <span>Motion Loops</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={tab === 'stills' ? 'active' : ''}
          onClick={() => setTab('stills')}
        >
          <ImageIcon size={13} />
          <span>Atmospheric Stills</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={tab === 'uploads' ? 'active' : ''}
          onClick={() => setTab('uploads')}
        >
          <Upload size={13} />
          <span>My Uploads ({assets.length})</span>
        </Button>
        {presets && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={tab === 'themes' ? 'active' : ''}
            onClick={() => setTab('themes')}
          >
            <Sparkles size={13} />
            <span>Obsidian Tones</span>
          </Button>
        )}
      </div>

      {/* Motion Loops Tab */}
      {tab === 'motion' && (
        <div className="bg-media-grid">
          {motionLoops.map((item) => {
            const isSelected = value === item.mediaUrl || value === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`bg-media-card ${isSelected ? 'selected' : ''}`}
                onClick={() => choose(item.mediaUrl, 'video', item.id)}
                title={item.name}
              >
                <div className="bg-thumb-wrap">
                  <img src={item.thumbnailUrl} alt={item.name} loading="lazy" />
                  <span className="media-badge video-badge">
                    <Play size={10} fill="currentColor" /> MP4
                  </span>
                  {isSelected && <span className="selected-check"><Check size={12} /></span>}
                </div>
                <div className="bg-media-info">
                  <strong>{item.name}</strong>
                  <small>{item.author}</small>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Atmospheric Stills Tab */}
      {tab === 'stills' && (
        <div className="bg-media-grid">
          {stillScenes.map((item) => {
            const isSelected = value === item.mediaUrl || value === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`bg-media-card ${isSelected ? 'selected' : ''}`}
                onClick={() => choose(item.mediaUrl, 'image', item.id)}
                title={item.name}
              >
                <div className="bg-thumb-wrap">
                  <img src={item.thumbnailUrl} alt={item.name} loading="lazy" />
                  <span className="media-badge">STILL</span>
                  {isSelected && <span className="selected-check"><Check size={12} /></span>}
                </div>
                <div className="bg-media-info">
                  <strong>{item.name}</strong>
                  <small>{item.author}</small>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Uploads Tab */}
      {tab === 'uploads' && (
        <div className="bg-uploads-section">
          <div
            className="stash-drop-area"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void upload(e.dataTransfer.files);
            }}
          >
            <input
              ref={input}
              type="file"
              accept="image/*,video/mp4,video/quicktime,video/webm"
              multiple
              className="sr-only"
              onChange={(e) => void upload(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => input.current?.click()}
              className="upload-trigger-btn"
            >
              <Upload size={16} />
              <span>{busy ? 'Saving locally…' : 'Drop MP4 Video Loops or Images here'}</span>
              <small>MP4, MOV, WebM, JPG, PNG, GIF</small>
            </Button>
          </div>

          {assets.length > 0 && (
            <div className="bg-media-grid">
              {assets.map((asset) => {
                const isSelected = value === `local-background:${asset.id}` || value === asset.url;
                return (
                  <button
                    key={asset.id}
                    type="button"
                    className={`bg-media-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => choose(asset.url, asset.type, asset.id)}
                    title={asset.name}
                  >
                    <div className="bg-thumb-wrap">
                      {asset.type === 'video' ? (
                        <video src={asset.url} muted playsInline />
                      ) : (
                        <img src={asset.url} alt={asset.name} />
                      )}
                      <span className="media-badge">{asset.type.toUpperCase()}</span>
                      {isSelected && <span className="selected-check"><Check size={12} /></span>}
                    </div>
                    <div className="bg-media-info">
                      <strong className="truncate">{asset.name}</strong>
                      <small>Local Storage</small>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Obsidian Themes Tab */}
      {presets && tab === 'themes' && (
        <div className="scripture-themes">
          {[
            ['scripture-obsidian', 'Obsidian Slate'],
            ['scripture-horizon', 'Golden Horizon'],
            ['scripture-sanctuary', 'Deep Sanctuary'],
          ].map(([id, name]) => (
            <Button
              key={id}
              variant="ghost"
              className={`scripture-theme ${id} ${value === id ? 'selected' : ''}`}
              onClick={() => choose(id ?? '', 'image', id ?? '')}
            >
              {id !== 'scripture-obsidian' && <img src={mountain.url} alt="" />}
              <span>{name}</span>
              {value === id && <Check size={12} />}
            </Button>
          ))}
        </div>
      )}

      {status && <span className="stash-status">{status}</span>}
    </div>
  );
}
