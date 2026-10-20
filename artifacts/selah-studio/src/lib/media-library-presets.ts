import { MEDIA_BACKGROUNDS, type MediaAsset } from './studio-data';

export type OnlineMediaItem = {
  id: string;
  name: string;
  category: 'motion' | 'still';
  type: 'video' | 'image';
  thumbnailUrl: string;
  mediaUrl: string;
  author: string;
  license: string;
};

// Use the backgrounds bundled with the app so the picker works offline in both
// the browser and the Tauri desktop build.
const toPreset = (asset: MediaAsset): OnlineMediaItem => ({
  id: asset.id,
  name: asset.title,
  category: asset.type === 'video' ? 'motion' : 'still',
  type: asset.type,
  thumbnailUrl:
    asset.type === 'video'
      ? '/backgrounds/stills/Red Particles.jpg'
      : asset.url,
  mediaUrl: asset.url,
  author: 'Selah Studio',
  license: 'Bundled asset',
});

const presets = MEDIA_BACKGROUNDS.map(toPreset);

export const motionLoops = presets.filter((item) => item.category === 'motion');
export const stillScenes = presets.filter((item) => item.category === 'still');

