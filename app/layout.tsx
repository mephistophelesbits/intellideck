import type { Metadata } from 'next';
import { DM_Sans, Playfair_Display, Orbitron, Inter, Fira_Code } from 'next/font/google';
import './globals.css';
import { AppProviders } from '@/components/AppProviders';
import { HtmlLangUpdater } from '@/components/HtmlLangUpdater';

const orbitron = Orbitron({
  variable: '--font-orbitron',
  subsets: ['latin'],
  display: 'swap',
});

const dmSans = DM_Sans({
  variable: '--font-dm-sans',
  subsets: ['latin'],
  display: 'swap',
});

const playfair = Playfair_Display({
  variable: '--font-playfair',
  subsets: ['latin'],
  display: 'swap',
});

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

const firaCode = Fira_Code({
  variable: '--font-fira-code',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'RSS Deck - Curated Feeds',
  description: 'A beautiful, organized way to read your favorite feeds.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${dmSans.variable} ${playfair.variable} ${orbitron.variable} ${inter.variable} ${firaCode.variable} antialiased h-screen overflow-hidden bg-background text-foreground font-sans`}
        suppressHydrationWarning
      >
        <AppProviders>
          <HtmlLangUpdater />
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
