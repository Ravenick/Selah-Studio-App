import { create } from 'zustand';
import type { Slide } from './studio-data';

type Store = {
  activePreviewSlide: Slide | null;
  liveOutputSlide: Slide | null;
  isAutoLiveSyncActive: boolean;
  currentPresentationCanvas: 'scripture' | 'media';
  setPreview: (slide: Slide | null) => void;
  setLive: (slide: Slide) => void;
  setAutoLiveSync: (active: boolean) => void;
  setCanvas: (track: 'scripture' | 'media') => void;
};
export const useAppStore = create<Store>((set) => ({
  activePreviewSlide: null,
  liveOutputSlide: null,
  isAutoLiveSyncActive: false,
  currentPresentationCanvas: 'media',
  setPreview: (activePreviewSlide) => set({ activePreviewSlide }),
  setLive: (liveOutputSlide) => set({ liveOutputSlide }),
  setAutoLiveSync: (isAutoLiveSyncActive) => set({ isAutoLiveSyncActive }),
  setCanvas: (currentPresentationCanvas) => set({ currentPresentationCanvas }),
}));
