export { readBackgrounds, stashBackground, type StoredBackground } from './local-workspace';
import type { StoredBackground } from './local-workspace';
export type BackgroundAsset = Omit<StoredBackground, 'blob'> & { url: string };