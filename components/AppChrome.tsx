'use client';

import { useState, useEffect } from 'react';
import { TopNavBar } from '@/components/ui/TopNavBar';
import { PlusCircle, RefreshCw, Settings } from 'lucide-react';
import { AddFeedModal } from '@/components/ui/AddFeedModal';
import { SettingsModal } from '@/components/ui/SettingsModal';
import { StockTicker } from '@/components/ui/StockTicker';
import { BriefingManager } from '@/components/BriefingManager';

type AppChromeProps = {
  children?: React.ReactNode;
  renderContent?: (controls: { openAddFeedModal: () => void }) => React.ReactNode;
  onRefreshAll?: () => Promise<void> | void;
};

export function AppChrome({ children, renderContent, onRefreshAll }: AppChromeProps) {
  const [isAddFeedModalOpen, setIsAddFeedModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const t = setTimeout(() => void Notification.requestPermission(), 500);
      return () => clearTimeout(t);
    }
  }, []);

  const openAddFeedModal = () => setIsAddFeedModalOpen(true);
  const closeAddFeedModal = () => setIsAddFeedModalOpen(false);

  const openSettingsModal = () => setIsSettingsModalOpen(true);
  const closeSettingsModal = () => setIsSettingsModalOpen(false);

  const handleRefreshAll = async () => {
    if (onRefreshAll) {
      setIsRefreshing(true);
      setRefreshMessage(null);
      try {
        await onRefreshAll();
        setRefreshMessage('Saved feeds refreshed.');
        setTimeout(() => setRefreshMessage(null), 2500);
      } catch (error) {
        console.error('Refresh all failed:', error);
        setRefreshMessage(error instanceof Error ? error.message : 'Refresh failed');
        setTimeout(() => setRefreshMessage(null), 3000);
      } finally {
        setIsRefreshing(false);
      }
    }
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background relative">
      {/* Draggable title-bar strip for Electron — ignored in the browser */}
      <div
        className="w-full flex-shrink-0 bg-background-secondary"
        style={{ height: '28px', WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <BriefingManager />
      <TopNavBar
        pageActions={
          <>
            <button 
              onClick={openAddFeedModal}
              title="Add Column"
              className="p-2 text-foreground-secondary hover:text-foreground hover:bg-background-tertiary rounded-lg transition-colors flex items-center justify-center"
            >
              <PlusCircle className="w-5 h-5" />
            </button>
            <button 
              onClick={handleRefreshAll}
              disabled={isRefreshing}
              title="Refresh All"
              className="p-2 text-foreground-secondary hover:text-foreground hover:bg-background-tertiary rounded-lg transition-colors flex items-center justify-center disabled:opacity-50"
            >
              <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin text-accent' : ''}`} />
            </button>
            <button 
              onClick={openSettingsModal}
              title="Settings"
              className="p-2 text-foreground-secondary hover:text-foreground hover:bg-background-tertiary rounded-lg transition-colors flex items-center justify-center"
            >
              <Settings className="w-5 h-5" />
            </button>
            {refreshMessage && (
              <div className="absolute right-6 top-16 mt-2 z-50 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground-secondary shadow-lg max-w-[220px] animate-in slide-in-from-top-2 fade-in">
                {refreshMessage}
              </div>
            )}
          </>
        }
      />
      <StockTicker />
      <main className="flex flex-1 overflow-hidden min-h-0">
        <div className="relative flex-1 overflow-hidden min-h-0">
          {renderContent ? renderContent({ openAddFeedModal }) : children}
        </div>
        <AddFeedModal isOpen={isAddFeedModalOpen} onClose={closeAddFeedModal} />
        <SettingsModal isOpen={isSettingsModalOpen} onClose={closeSettingsModal} />
      </main>
    </div>
  );
}
