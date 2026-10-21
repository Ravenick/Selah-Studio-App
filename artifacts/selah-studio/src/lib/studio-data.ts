import { sectionHeadings } from './studio-workflows';
import type { TextFormat } from './presentation';
export type HeaderStyle = { weight: '400' | '500' | '600' | '700'; size: number; color: string; font: string };
export type Slide = { id: string; text: string; label: string; kind: 'song' | 'scripture' | 'media' | 'sermon'; title: string; background?: string; backgroundType?: 'image' | 'video'; heading?: string; headingStyle?: HeaderStyle; chorus?: boolean; verses?: { number: number; text: string }[]; formats?: TextFormat[]; mediaUrl?: string; mediaType?: 'image' | 'video' | 'youtube'; audioMuted?: boolean; youtubeUrl?: string };
export type Song = { title: string; author: string; tag: string; lyrics: string[]; kind?: 'song' | 'sermon'; sections?: { text: string; chorus: boolean; formats?: TextFormat[] | undefined }[]; background?: string | undefined; backgroundType?: 'image' | 'video' | undefined; headerStyle?: HeaderStyle | undefined; sermonText?: string | undefined; slideBreaks?: number[] | undefined };
export const songs: Song[] = [];
export const chapters: Record<string, { chapter: number; verses: string[] }> = {
  Psalms: { chapter: 23, verses: ['The LORD is my shepherd; I shall not want.', 'He maketh me to lie down in green pastures: he leadeth me beside the still waters.', 'He restoreth my soul: he leadeth me in the paths of righteousness for his name’s sake.', 'Yea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.', 'Thou preparest a table before me in the presence of mine enemies: thou anointest my head with oil; my cup runneth over.', 'Surely goodness and mercy shall follow me all the days of my life: and I will dwell in the house of the LORD for ever.'] },
  Genesis: { chapter: 1, verses: ['In the beginning God created the heaven and the earth.', 'And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.', 'And God said, Let there be light: and there was light.', 'And God saw the light, that it was good: and God divided the light from the darkness.', 'And God called the light Day, and the darkness he called Night. And the evening and the morning were the first day.', 'And God said, Let there be a firmament in the midst of the waters, and let it divide the waters from the waters.', 'And God made the firmament, and divided the waters which were under the firmament from the waters which were above the firmament: and it was so.', 'And God called the firmament Heaven. And the evening and the morning were the second day.', 'And God said, Let the waters under the heaven be gathered together unto one place, and let the dry land appear: and it was so.', 'And God called the dry land Earth; and the gathering together of the waters called he Seas: and God saw that it was good.', 'And God said, Let the earth bring forth grass, the herb yielding seed, and the fruit tree yielding fruit after his kind, whose seed is in itself, upon the earth: and it was so.', 'And the earth brought forth grass, and herb yielding seed after his kind, and the tree yielding fruit, whose seed was in itself, after his kind: and God saw that it was good.', 'And the evening and the morning were the third day.', 'And God said, Let there be lights in the firmament of the heaven to divide the day from the night; and let them be for signs, and for seasons, and for days, and years:', 'And let them be for lights in the firmament of the heaven to give light upon the earth: and it was so.', 'And God made two great lights; the greater light to rule the day, and the lesser light to rule the night: he made the stars also.', 'And God set them in the firmament of the heaven to give light upon the earth,', 'And to rule over the day and over the night, and to divide the light from the darkness: and God saw that it was good.', 'And the evening and the morning were the fourth day.', 'And God said, Let the waters bring forth abundantly the moving creature that hath life, and fowl that may fly above the earth in the open firmament of heaven.', 'And God created great whales, and every living creature that moveth, which the waters brought forth abundantly, after their kind, and every winged fowl after his kind: and God saw that it was good.', 'And God blessed them, saying, Be fruitful, and multiply, and fill the waters in the seas, and let fowl multiply in the earth.', 'And the evening and the morning were the fifth day.', 'And God said, Let the earth bring forth the living creature after his kind, cattle, and creeping thing, and beast of the earth after his kind: and it was so.', 'And God made the beast of the earth after his kind, and cattle after their kind, and every thing that creepeth upon the earth after his kind: and God saw that it was good.', 'And God said, Let us make man in our image, after our likeness: and let them have dominion over the fish of the sea, and over the fowl of the air, and over the cattle, and over all the earth, and over every creeping thing that creepeth upon the earth.', 'So God created man in his own image, in the image of God created he him; male and female created he them.', 'And God blessed them, and God said unto them, Be fruitful, and multiply, and replenish the earth, and subdue it: and have dominion over the fish of the sea, and over the fowl of the air, and over every living thing that moveth upon the earth.', 'And God said, Behold, I have given you every herb bearing seed, which is upon the face of all the earth, and every tree, in the which is the fruit of a tree yielding seed; to you it shall be for meat.', 'And to every beast of the earth, and to every fowl of the air, and to every thing that creepeth upon the earth, wherein there is life, I have given every green herb for meat: and it was so.', 'And God saw every thing that he had made, and, behold, it was very good. And the evening and the morning were the sixth day.'] },
  Romans: { chapter: 8, verses: ['There is therefore now no condemnation to them which are in Christ Jesus, who walk not after the flesh, but after the Spirit.', 'For the law of the Spirit of life in Christ Jesus hath made me free from the law of sin and death.'] },
};
export const romans28 = 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.';
export function songSlides(song: Song): Slide[] { const headings = song.sections ? sectionHeadings(song.sections) : []; return song.lyrics.map((text, i) => ({ id: `${song.title}-${i}`, text, label: song.kind === 'sermon' ? `Slide ${i + 1}` : song.sections?.[i]?.chorus ? 'Chorus' : `Verse ${i + 1}`, title: song.title, kind: song.kind ?? 'song', background: song.background, backgroundType: song.backgroundType, heading: song.kind === 'sermon' ? undefined : headings[i], headingStyle: song.kind === 'sermon' ? undefined : song.headerStyle, chorus: song.kind === 'sermon' ? false : song.sections?.[i]?.chorus, formats: song.sections?.[i]?.formats })); }
export const initialTimeline = [
  { id: 'welcome', title: 'Welcome Walk', subtitle: '5 min', kind: 'media' },
  { id: 'reading', title: 'Sermon Reading', subtitle: 'Psalm 23', kind: 'scripture' },
  { id: 'closing', title: 'Closing Prayer', subtitle: '3 min', kind: 'media' },
];

export interface MediaAsset {
  id: string;
  title: string;
  url: string;
  type: 'image' | 'video';
  target: 'scripture' | 'media' | 'both';
}

const ALL_STILLS: Omit<MediaAsset, 'target'>[] = [
  { id: 'christmas-golden', title: 'Christmas Spectacular Golden', url: '/backgrounds/stills/Christmas Spectacular Golden - 16x9.jpg', type: 'image' },
  { id: 'christmas-holiday', title: 'Christmas Spectacular Holiday', url: '/backgrounds/stills/Christmas Spectacular Holiday - 16x9.jpg', type: 'image' },
  { id: 'christmas-hope', title: 'Christmas Spectacular Hope', url: '/backgrounds/stills/Christmas Spectacular Hope - 16x9.jpg', type: 'image' },
  { id: 'christmas-luminous', title: 'Christmas Spectacular Luminous', url: '/backgrounds/stills/Christmas Spectacular Luminous - 16x9.jpg', type: 'image' },
  { id: 'christmas-serene', title: 'Christmas Spectacular Serene', url: '/backgrounds/stills/Christmas Spectacular Serene - 16x9.jpg', type: 'image' },
  { id: 'christmas-starfield', title: 'Christmas Spectacular Starfield', url: '/backgrounds/stills/Christmas Spectacular Starfield - 16x9.jpg', type: 'image' },
  { id: 'christmas-starlight', title: 'Christmas Spectacular Starlight', url: '/backgrounds/stills/Christmas Spectacular Starlight - 16x9.jpg', type: 'image' },
  { id: 'christmas-warm', title: 'Christmas Spectacular Warm', url: '/backgrounds/stills/Christmas Spectacular Warm - 16x9.jpg', type: 'image' },
  { id: 'colorflow-love', title: 'Colorflow Gradients Love', url: '/backgrounds/stills/Colorflow Gradients Love - 16x9.jpg', type: 'image' },
  { id: 'colorflow-praise', title: 'Colorflow Gradients Praise', url: '/backgrounds/stills/Colorflow Gradients Praise - 16x9.jpg', type: 'image' },
  { id: 'colorflow-pure', title: 'Colorflow Gradients Pure', url: '/backgrounds/stills/Colorflow Gradients Pure - 16x9.jpg', type: 'image' },
  { id: 'echo-moonlight', title: 'Echo Spheres Moonlight', url: '/backgrounds/stills/Echo Spheres Moonlight - 16x9.jpg', type: 'image' },
  { id: 'echo-party', title: 'Echo Spheres Party', url: '/backgrounds/stills/Echo Spheres Party - 16x9.jpg', type: 'image' },
  { id: 'paint-blank', title: 'Paint Sweeps Blank', url: '/backgrounds/stills/Paint Sweeps Blank.jpg', type: 'image' },
  { id: 'paint-burn', title: 'Paint Sweeps Burn', url: '/backgrounds/stills/Paint Sweeps Burn.jpg', type: 'image' },
  { id: 'paint-dreams', title: 'Paint Sweeps Dreams', url: '/backgrounds/stills/Paint Sweeps Dreams.jpg', type: 'image' },
  { id: 'paint-evergreen', title: 'Paint Sweeps Evergreen', url: '/backgrounds/stills/Paint Sweeps Evergreen.jpg', type: 'image' },
  { id: 'paint-field', title: 'Paint Sweeps Field', url: '/backgrounds/stills/Paint Sweeps Field.jpg', type: 'image' },
  { id: 'paint-final', title: 'Paint Sweeps Final', url: '/backgrounds/stills/Paint Sweeps Final.jpg', type: 'image' },
  { id: 'paint-forest', title: 'Paint Sweeps Forest', url: '/backgrounds/stills/Paint Sweeps Forest.jpg', type: 'image' },
  { id: 'paint-forever', title: 'Paint Sweeps Forever', url: '/backgrounds/stills/Paint Sweeps Forever.jpg', type: 'image' },
  { id: 'paint-fun', title: 'Paint Sweeps Fun', url: '/backgrounds/stills/Paint Sweeps Fun.jpg', type: 'image' },
  { id: 'paint-gold', title: 'Paint Sweeps Gold', url: '/backgrounds/stills/Paint Sweeps Gold.jpg', type: 'image' },
  { id: 'paint-hope', title: 'Paint Sweeps Hope', url: '/backgrounds/stills/Paint Sweeps Hope.jpg', type: 'image' },
  { id: 'paint-joy', title: 'Paint Sweeps Joy', url: '/backgrounds/stills/Paint Sweeps Joy.jpg', type: 'image' },
  { id: 'paint-king', title: 'Paint Sweeps King', url: '/backgrounds/stills/Paint Sweeps King.jpg', type: 'image' },
  { id: 'paint-love', title: 'Paint Sweeps Love', url: '/backgrounds/stills/Paint Sweeps Love.jpg', type: 'image' },
  { id: 'paint-peace', title: 'Paint Sweeps Peace', url: '/backgrounds/stills/Paint Sweeps Peace.jpg', type: 'image' },
  { id: 'paint-shine', title: 'Paint Sweeps Shine', url: '/backgrounds/stills/Paint Sweeps Shine.jpg', type: 'image' },
  { id: 'paint-silver', title: 'Paint Sweeps Silver', url: '/backgrounds/stills/Paint Sweeps Silver.jpg', type: 'image' },
  { id: 'paint-spread', title: 'Paint Sweeps Spread', url: '/backgrounds/stills/Paint Sweeps Spread.jpg', type: 'image' },
  { id: 'paint-strong', title: 'Paint Sweeps Strong', url: '/backgrounds/stills/Paint Sweeps Strong.jpg', type: 'image' },
  { id: 'paint-torn', title: 'Paint Sweeps Torn', url: '/backgrounds/stills/Paint Sweeps Torn.jpg', type: 'image' },
  { id: 'paint-vive', title: 'Paint Sweeps Vive', url: '/backgrounds/stills/Paint Sweeps Vive.jpg', type: 'image' },
  { id: 'particulas-caindo', title: 'Partículas Caindo', url: '/backgrounds/stills/Partículas caindo (loopável).jpg', type: 'image' },
  { id: 'red-particles-jpg', title: 'Red Particles', url: '/backgrounds/stills/Red Particles.jpg', type: 'image' },
  { id: 'red-particles-alt', title: 'Red Particles (Alt)', url: '/backgrounds/stills/red-particles.jpg', type: 'image' },
  { id: 'refractions-points', title: 'Refractions Points', url: '/backgrounds/stills/Refractions Points - 16x9.jpg', type: 'image' },
  { id: 'refractions-united', title: 'Refractions United', url: '/backgrounds/stills/Refractions United - 16x9.jpg', type: 'image' },
  { id: 'retro-glow', title: 'Retro Glow Blaze', url: '/backgrounds/stills/Retro Glow Blaze - 16x9.jpg', type: 'image' },
  { id: 'sundrift-sunrise', title: 'Sundrift Sunrise', url: '/backgrounds/stills/Sundrift Sunrise - 16x9.jpg', type: 'image' },
];

const ALL_MOTIONS: Omit<MediaAsset, 'target'>[] = [
  { id: 'blue-particles-mp4', title: 'Blue Particles', url: '/backgrounds/motion/Blue Particles.mp4', type: 'video' },
  { id: 'dark-mist-mp4', title: 'Dark Mist', url: '/backgrounds/motion/Dark Mist.mp4', type: 'video' },
  { id: 'green-particles-mp4', title: 'Green Particles', url: '/backgrounds/motion/Green Particles.mp4', type: 'video' },
];

export const SCRIPTURE_BACKGROUNDS: MediaAsset[] = [
  {
    id: 'scripture-echo-spheres-party',
    title: 'Echo Spheres Party',
    url: "/backgrounds/stills/Echo Spheres Party - 16x9.jpg",
    type: 'image',
    target: 'scripture',
  },
  ...ALL_MOTIONS.map((item) => ({ ...item, target: 'scripture' as const })),
  ...ALL_STILLS.map((item) => ({ ...item, target: 'scripture' as const })),
];

export const MEDIA_BACKGROUNDS: MediaAsset[] = [
  ...ALL_MOTIONS.map((item) => ({ ...item, target: 'media' as const })),
  ...ALL_STILLS.map((item) => ({ ...item, target: 'media' as const })),
];
