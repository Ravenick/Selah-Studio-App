import { useRef, useState } from 'react';
import { AlignCenter, AlignLeft, Bold, Italic, Sparkles, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TextFormat } from '@/lib/presentation';

export function SelectionEditor({
  text,
  formats = [],
  onChange,
  onFormat,
}: {
  text: string;
  formats?: TextFormat[];
  onChange: (text: string) => void;
  onFormat: (format: TextFormat) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [size, setSize] = useState(100);
  const [alignment, setAlignment] = useState<'center' | 'left'>('center');
  const [hasGlow, setHasGlow] = useState(true);

  function apply(format: Partial<TextFormat>) {
    // If text is highlighted, apply to that range; otherwise apply to entire text
    const range = selection && selection.end > selection.start
      ? selection
      : { start: 0, end: text.length };
    onFormat({ ...range, ...format });
  }

  const isSelectionBold = Boolean(
    selection &&
      formats.some(
        (f) => f.bold && f.start <= selection.start && f.end >= selection.end,
      ),
  );

  return (
    <div className="selection-editor-v2">
      {/* Persistent Typography Control Bar */}
      <div className="editor-top-toolbar" role="toolbar" aria-label="Slide text styling">
        <div className="tool-group">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Toggle Bold"
            className={`tool-btn ${isSelectionBold ? 'active' : ''}`}
            onClick={() => apply({ bold: !isSelectionBold })}
            title="Bold"
          >
            <Bold size={14} />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="tool-btn"
            onClick={() => {
              // Convert text to uppercase or normal
              if (text === text.toUpperCase()) {
                onChange(text.toLowerCase());
              } else {
                onChange(text.toUpperCase());
              }
            }}
            title="Toggle All-Caps"
          >
            <Type size={14} />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={`tool-btn ${hasGlow ? 'active' : ''}`}
            onClick={() => setHasGlow(!hasGlow)}
            title="High Contrast Video Shadow Glow"
          >
            <Sparkles size={13} />
            <span className="text-[10px] ml-1">Shadow</span>
          </Button>
        </div>

        <div className="toolbar-divider" />

        {/* Color Palette */}
        <div className="color-swatches-row">
          {[
            ['ink-white', '#ffffff', 'Pure White'],
            ['ink-gold', 'var(--gold)', 'Holy Gold'],
            ['ink-teal', 'oklch(0.805 0.143 177)', 'Neon Teal'],
            ['ink-rose', '#fb7185', 'Rose Glow'],
          ].map(([cls, col, label]) => (
            <button
              key={cls}
              type="button"
              className={`editor-color-dot ${cls}`}
              style={{ background: col }}
              onClick={() => apply({ color: cls })}
              title={label}
              aria-label={label}
            />
          ))}
        </div>

        <div className="toolbar-divider" />

        {/* Font Family Selector */}
        <select
          aria-label="Text Font"
          className="editor-font-select"
          defaultValue="font-dm"
          onChange={(e) => apply({ font: e.target.value })}
        >
          <option value="font-dm">DM Sans (Modern)</option>
          <option value="font-georgia">Georgia (Serif)</option>
          <option value="font-mono">Monospace (Clean)</option>
        </select>

        <div className="toolbar-divider" />

        {/* Size Slider */}
        <div className="editor-size-control">
          <span>{size}%</span>
          <input
            type="range"
            aria-label="Text size"
            min="75"
            max="160"
            step="5"
            value={size}
            onChange={(e) => {
              const val = Number(e.target.value);
              setSize(val);
              apply({ size: val });
            }}
          />
        </div>
      </div>

      {/* Main Textarea */}
      <textarea
        ref={input}
        aria-label="Edit section lyrics or sermon text"
        className="editor-textarea-main"
        value={text}
        style={{
          textShadow: hasGlow ? '0 2px 14px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.9)' : 'none',
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setSelection(null);
        }}
        onSelect={(e) => {
          const { selectionStart: start, selectionEnd: end } = e.currentTarget;
          setSelection(end > start ? { start, end } : null);
        }}
        placeholder="Type or edit slide lyrics here..."
      />

      <div className="editor-status-bar">
        <span>{text.split(/\r\n|\r|\n/).length} lines</span>
        <span>{selection ? `${selection.end - selection.start} chars selected` : 'Whole slide selected'}</span>
      </div>
    </div>
  );
}