'use client';

import { preload } from 'react-dom';

// next/font injected these preload tags itself; ReactDOM.preload is App Router's way to ask.
export function FontPreload() {
  preload('/fonts/inter-latin.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  preload('/fonts/noto-sans-ethiopic-ethiopic.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  return null;
}
