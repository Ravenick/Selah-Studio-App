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


