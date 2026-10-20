import { useRef, useState } from 'react';
import { Paintbrush, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TextFormat } from '@/lib/presentation';
import { PRESENTATION_COLORS, type PresentationFont } from '@/lib/scripture-appearance';

const fonts: Array<{ value: PresentationFont; label: string }> = [
  { value: 'font-bebas-neue', label: 'Bebas Neue' },
  { value: 'font-montserrat', label: 'Montserrat' },
  { value: 'font-dm', label: 'DM Sans' },
  { value: 'font-georgia', label: 'Georgia' },
  { value: 'font-mono', label: 'Monospace' },
];

export function SelectionEditor({
  text,
  formats = [],
  onChange,
  onFormat,
  defaultFont = 'font-bebas-neue',
  activeTab: controlledTab,
  onActiveTabChange,
  showTabs = true,
}: {
  text: string;
  formats?: TextFormat[];
  onChange: (text: string) => void;
  onFormat: (format: TextFormat) => void;
  defaultFont?: PresentationFont;
  activeTab?: 'text' | 'style';
  onActiveTabChange?: (tab: 'text' | 'style') => void;
  showTabs?: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [size, setSize] = useState(100);
  const [activeTab, setActiveTab] = useState<'text' | 'style'>('text');
  const currentTab = controlledTab ?? activeTab;
  const changeTab = (tab: 'text' | 'style') => {
    setActiveTab(tab);
    onActiveTabChange?.(tab);
  };

  const range = selection && selection.end > selection.start
    ? selection
    : { start: 0, end: text.length };
  const selectedFormat = formats
    .filter((format) => format.start <= range.start && format.end >= range.end)
    .reduce<Partial<TextFormat>>((current, format) => ({ ...current, ...format }), {});

  function apply(format: Partial<TextFormat>) {
    if (!text.length) return;
    onFormat({ ...range, ...format });
  }

  return (
    <div className="selection-editor-v2">
      {showTabs && <div className="editor-view-tabs" role="tablist" aria-label="Section editor">
        <Button type="button" variant="ghost" role="tab" aria-selected={currentTab === 'text'} className={currentTab === 'text' ? 'active' : ''} onClick={() => changeTab('text')}>
          <Type size={14} /> Text
        </Button>
        <Button type="button" variant="ghost" role="tab" aria-selected={currentTab === 'style'} className={currentTab === 'style' ? 'active' : ''} onClick={() => changeTab('style')}>
          <Paintbrush size={14} /> Style
        </Button>
      </div>}

      {currentTab === 'text' ? (
        <textarea
          ref={input}
          aria-label="Edit section lyrics or sermon text"
          className="editor-textarea-main"
          value={text}
          onChange={(event) => {
            onChange(event.target.value);
            setSelection(null);
          }}
          onSelect={(event) => {
            const { selectionStart: start, selectionEnd: end } = event.currentTarget;
            setSelection(end > start ? { start, end } : null);
          }}
          placeholder="Type or edit slide text here..."
        />
      ) : (
        <div className="editor-style-panel" role="tabpanel">
          <div className="editor-style-heading">
            <strong>Text appearance</strong>
            <span>{selection ? `${selection.end - selection.start} characters selected` : 'Applies to the whole section'}</span>
          </div>
          <label className="editor-style-field">
            Font
            <select
              aria-label="Text font"
              className="editor-font-select"
              value={(selectedFormat.font as PresentationFont | undefined) ?? defaultFont}
              onChange={(event) => apply({ font: event.target.value })}
            >
              {fonts.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
            </select>
          </label>
          <div className="editor-style-field">
            <div className="editor-style-heading"><span>Size</span><span>{selectedFormat.size ?? size}%</span></div>
            <input
              type="range"
              aria-label="Text size"
              min="75"
              max="160"
              step="5"
              value={selectedFormat.size ?? size}
              onChange={(event) => {
                const value = Number(event.target.value);
                setSize(value);
                apply({ size: value });
              }}
            />
          </div>
          <div className="editor-style-field">
            <span>Color</span>
            <div className="editor-color-grid" role="group" aria-label="Text color palette">
              {PRESENTATION_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`editor-color-dot ${selectedFormat.color === color ? 'selected' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => apply({ color })}
                  title={color}
                  aria-label={`Text color ${color}`}
                  aria-pressed={selectedFormat.color === color}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="editor-status-bar">
        <span>{text.split(/\r\n|\r|\n/).length} lines</span>
        <span>{text.length} characters</span>
      </div>
    </div>
  );
}
