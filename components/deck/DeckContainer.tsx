'use client';

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { useDeckStore } from '@/lib/store';
import { useArticlesStore } from '@/lib/articles-store';
import { reorderColumnsRequest } from '@/lib/deck-client';
import { Article, Column as DeckColumn } from '@/lib/types';
import { Column } from './Column';
import { ReadingColumn } from './ReadingColumn';
import { Plus } from 'lucide-react';
import React from 'react';

interface DeckContainerProps {
  onAddColumn: () => void;
  onArticleClick: (article: Article) => void;
  onCloseArticle: () => void;
  selectedArticle: Article | null;
  refreshTrigger: number;
}

interface SortableColumnProps {
  column: DeckColumn;
  onArticleClick: (article: Article) => void;
  selectedArticleId: string | null;
  refreshTrigger: number;
}

function SortableColumn({ column, onArticleClick, selectedArticleId, refreshTrigger }: SortableColumnProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 'auto',
  };

  return (
    <div ref={setNodeRef} style={style} className="h-full flex-shrink-0">
      <Column
        column={column}
        onArticleClick={onArticleClick}
        selectedArticleId={selectedArticleId}
        refreshTrigger={refreshTrigger}
        dragHandleProps={attributes}
        dragListeners={listeners}
      />
    </div>
  );
}

export function DeckContainer({ onAddColumn, onArticleClick, onCloseArticle, selectedArticle, refreshTrigger }: DeckContainerProps) {
  const columns = useDeckStore((state) => state.columns);
  const reorderColumns = useDeckStore((state) => state.reorderColumns);
  const setColumns = useDeckStore((state) => state.setColumns);
  const setSavedFeeds = useDeckStore((state) => state.setSavedFeeds);
  const articleToColumn = useArticlesStore((state) => state.articleToColumn);

  const sourceColumnId = selectedArticle ? articleToColumn.get(selectedArticle.id) : null;


  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      const oldIndex = columns.findIndex((col) => col.id === active.id);
      const newIndex = columns.findIndex((col) => col.id === over?.id);

      const newOrder = arrayMove(columns, oldIndex, newIndex).map(c => c.id);
      reorderColumns(newOrder);
      try {
        const deckState = await reorderColumnsRequest(newOrder);
        setColumns(deckState.columns);
        setSavedFeeds(deckState.savedFeeds);
      } catch (error) {
        console.error('Failed to reorder columns:', error);
      }
    }
  };

  const containerStyle = {
    minWidth: 0,
  };

  return (
    <div
      className="h-full w-full overflow-x-auto overflow-y-hidden deck-scroll"
      style={containerStyle}
    >
      <div className="flex h-full">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={columns.map(c => c.id)}
            strategy={horizontalListSortingStrategy}
          >
            {columns.map((column) => (
              <React.Fragment key={column.id}>
                <SortableColumn
                  column={column}
                  onArticleClick={onArticleClick}
                  selectedArticleId={selectedArticle?.id || null}
                  refreshTrigger={refreshTrigger}
                />
                {selectedArticle && sourceColumnId === column.id && (
                  <ReadingColumn
                    article={selectedArticle}
                    onClose={onCloseArticle}
                  />
                )}
              </React.Fragment>
            ))}
          </SortableContext>
        </DndContext>

        {/* Add Column Button - always show to allow unlimited columns */}

        <div
          className="h-full flex flex-col items-center justify-center border-r border-border border-dashed flex-shrink-0"
          style={{ width: '60px' }}
        >
          <button
            onClick={onAddColumn}
            title="Add Column"
            className="w-10 h-10 rounded-full bg-background-tertiary flex items-center justify-center hover:bg-accent hover:text-white transition-all text-foreground-secondary group shadow-sm"
          >
            <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
          </button>
        </div>

      </div>
    </div>
  );
}
