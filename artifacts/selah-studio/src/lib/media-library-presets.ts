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

// Curated royalty-free high performance worship motion loops & atmospheric stills
export const CURATED_ONLINE_MEDIA: OnlineMediaItem[] = [
  {
    id: 'motion-celestial-particles',
    name: 'Celestial Particles & Amber Haze',
    category: 'motion',
    type: 'video',
    thumbnailUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=480&auto=format&fit=crop&q=80',
    mediaUrl: 'https://assets.mixkit.co/videos/preview/mixkit-dust-particles-moving-in-slow-motion-41819-large.mp4',
    author: 'Mixkit / Public Domain',
    license: 'Royalty-Free Commercial',
  },
  {
    id: 'motion-ambient-waves',
    name: 'Deep Blue Sanctuary Flow',
    category: 'motion',
    type: 'video',
    thumbnailUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=480&auto=format&fit=crop&q=80',
    mediaUrl: 'https://assets.mixkit.co/videos/preview/mixkit-slow-motion-of-abstract-smoke-waves-42171-large.mp4',
    author: 'Mixkit Free Assets',
    license: 'Royalty-Free',
  },
  {
    id: 'motion-golden-light',
    name: 'Holy Dawn Rays',
    category: 'motion',
    type: 'video',
    thumbnailUrl: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=480&auto=format&fit=crop&q=80',
    mediaUrl: 'https://assets.mixkit.co/videos/preview/mixkit-sun-rays-in-a-forest-42487-large.mp4',
    author: 'Mixkit Nature',
    license: 'Royalty-Free',
  },
  {
    id: 'motion-starry-heavens',
    name: 'Cosmic Nebula & Stars',
    category: 'motion',
    type: 'video',
    thumbnailUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=480&auto=format&fit=crop&q=80',
    mediaUrl: 'https://assets.mixkit.co/videos/preview/mixkit-flight-through-a-starfield-42562-large.mp4',
    author: 'Mixkit Space',
    license: 'Royalty-Free',
  },
  {
    id: 'still-mountain-majesty',
    name: 'Mountain Majesty at Dusk',
    category: 'still',
    type: 'image',
    thumbnailUrl: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=480&auto=format&fit=crop&q=80',
    mediaUrl: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1920&auto=format&fit=crop&q=85',
    author: 'Kalen Emsley (Unsplash)',
    license: 'Unsplash Free',
  },
  {
    id: 'still-sanctuary-cathedral',
    name: 'Cathedral Columns & Light',
    category: 'still',
    type: 'image',
    thumbnailUrl: 'https://images.unsplash.com/photo-1548625361-195fe5787754?w=480&auto=format&fit=crop&q=80',
    mediaUrl: 'https://images.unsplash.com/photo-1548625361-195fe5787754?w=1920&auto=format&fit=crop&q=85',
    author: 'Peter Hermann (Unsplash)',
    license: 'Unsplash Free',
  },
  {
    id: 'still-dark-candlelight',
    name: 'Sacred Flame & Peace',
    category: 'still',
    type: 'image',
    thumbnailUrl: 'https://images.unsplash.com/photo-1518241353330-0f7941c2d9b5?w=480&auto=format&fit=crop&q=80',
    mediaUrl: 'https://images.unsplash.com/photo-1518241353330-0f7941c2d9b5?w=1920&auto=format&fit=crop&q=85',
    author: 'David Beale (Unsplash)',
    license: 'Unsplash Free',
  },
  {
    id: 'still-evening-waters',
    name: 'Beside Still Waters',
    category: 'still',
    type: 'image',
    thumbnailUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=480&auto=format&fit=crop&q=80',
    mediaUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1920&auto=format&fit=crop&q=85',
    author: 'Bailey Zindel (Unsplash)',
    license: 'Unsplash Free',
  },
  {
    id: 'still-obsidian-gradient',
    name: 'Minimal Deep Obsidian Tone',
    category: 'still',
    type: 'image',
    thumbnailUrl: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=480&auto=format&fit=crop&q=80',
    mediaUrl: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1920&auto=format&fit=crop&q=85',
    author: 'Lucas Benjamin (Unsplash)',
    license: 'Unsplash Free',
  },
];
