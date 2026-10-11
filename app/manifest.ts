import type { MetadataRoute } from 'next';

/** The manifest never varies, and a static export will not emit it without this. */
export const dynamic = 'force-static';

/**
 * Makes the app installable, which is how it ends up on a phone's home screen.
 * `standalone` drops the browser chrome, so a hand of cards gets the whole
 * screen; the colours match the felt so the status bar does not sit on a white
 * strip above the table.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Spadework',
    short_name: 'Spadework',
    description:
      'Spades that tells you what your play was worth, and a pass-and-play game for one phone.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0e1512',
    theme_color: '#16352a',
    categories: ['games'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops this to whatever shape the launcher uses.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
