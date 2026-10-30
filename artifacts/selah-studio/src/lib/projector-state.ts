import type { Slide } from './studio-data';

export type OutputState = {
  slide: Slide;
  mode: 'normal' | 'blackout' | 'clear' | 'logo';
  accentTheme?: 'teal' | 'gold' | 'purple';
  transitionMode?: 'cold' | 'fade' | 'blur-words';
  backgroundDim?: number;
};

export const welcomeSlide: Slide = {
  id: 'welcome', title: 'Welcome Walk', label: 'Welcome', text: 'Welcome home.', kind: 'media',
};

export function createStartupOutput(): OutputState {
  return { slide: welcomeSlide, mode: 'logo', backgroundDim: 50 };
}
