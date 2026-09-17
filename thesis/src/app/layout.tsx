import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

import './globals.css';

export const metadata: Metadata = {
  title: 'THESIS',
  description:
    'A research desk that takes a trade idea apart: the assumptions holding it up, and which of them can actually be checked.',
  // Generated from the source artwork: the mark cut out of its baked-in field so
  // it is flat cream on transparency, which is what a browser tab needs — a
  // black tile would read as a hole in a light tab strip.
  icons: {
    icon: [
      { url: '/mark-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/mark-64.png', sizes: '64x64', type: 'image/png' },
    ],
    apple: '/mark-180.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
