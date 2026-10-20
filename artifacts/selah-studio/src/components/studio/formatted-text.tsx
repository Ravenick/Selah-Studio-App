import type { TextFormat } from '@/lib/presentation';

export function FormattedText({ text, formats = [] }: { text: string; formats?: TextFormat[] | undefined }) {
  const boundaries = [...new Set([0, text.length, ...formats.flatMap(f => [f.start, f.end])])].filter(n => n >= 0 && n <= text.length).sort((a,b) => a-b);
  return <>{boundaries.slice(0,-1).map((start, i) => {
    const end = boundaries[i+1] ?? text.length;
    const format = formats.filter(f => f.start <= start && f.end >= end).reduce<Partial<TextFormat>>((result,item) => ({...result,...item}),{});
    const color = format.color?.startsWith('#') ? format.color : undefined;
    return <span key={start} className={`formatted-run ${color ? '' : format.color ?? ''} ${format.font ?? ''}`} style={{ ...(color ? { color } : {}), ...(format.size ? { fontSize: `${format.size}%` } : {}), ...(format?.bold ? { fontWeight: 700 } : {}) }}>{text.slice(start,end)}</span>;
  })}</>;
}
