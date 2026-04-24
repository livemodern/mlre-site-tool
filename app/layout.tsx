import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Modern Living Image Prep',
  description:
    'Prepare SEO-optimized images for Modern Living community pages: scrape, crop, WebP, rename, zip.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
