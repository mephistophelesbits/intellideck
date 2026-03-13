'use client';

import { ThemeProvider } from '@/components/ThemeProvider';
import { StoreHydration } from '@/components/StoreHydration';
import { UrlPreviewProvider } from '@/components/ui/UrlPreviewPopup';

interface AppProvidersProps {
  children: React.ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ThemeProvider>
      <StoreHydration>
        <UrlPreviewProvider>{children}</UrlPreviewProvider>
      </StoreHydration>
    </ThemeProvider>
  );
}
