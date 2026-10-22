import { Studio } from '@/components/studio/studio';

// Web-only home slot. Cursor can replace this with the landing page; the
// Tauri build statically selects Studio and tree-shakes this dynamic import.
export default function WebHome() {
  return <Studio />;
}
