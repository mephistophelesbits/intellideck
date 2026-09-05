'use client';

import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';

/**
 * Clean up the stray markdown artifacts LLMs commonly emit, without touching valid syntax.
 * An emphasis run (`**`/`*`/`_`) immediately followed by whitespace can never open emphasis
 * in CommonMark, so a leading `** ` (as briefs sometimes start with) is pure noise that would
 * otherwise render as a literal `**` — strip it. Leave `* `/`- ` at a line start alone: those
 * are valid list bullets.
 */
function normalizeMarkdown(md: string): string {
  return md.trim().replace(/^(\*\*|__)(?=\s)/, '').trim();
}

/**
 * Renders LLM-generated brief text as proper markdown (headings, bold, lists) instead of
 * showing raw `#`/`*` characters. Colors inherit from the wrapper's text color so each
 * panel keeps its own size/tone — pass that via `className` (e.g. "text-sm text-foreground").
 */
export function Markdown({ children, className }: { children: string | null | undefined; className?: string }) {
  if (!children) return null;
  const content = normalizeMarkdown(children);
  if (!content) return null;
  return (
    <div
      className={cn(
        'prose prose-sm max-w-none',
        'prose-headings:text-inherit prose-headings:font-semibold prose-headings:text-[0.8em] prose-headings:uppercase prose-headings:tracking-wider prose-headings:mt-3 prose-headings:mb-1',
        'prose-p:text-inherit prose-p:my-2 prose-p:leading-relaxed',
        'prose-strong:text-inherit prose-strong:font-semibold',
        'prose-em:text-inherit',
        'prose-ul:my-2 prose-ol:my-2 prose-li:text-inherit prose-li:my-0.5 prose-li:marker:text-accent/60',
        'prose-a:text-accent prose-a:no-underline hover:prose-a:underline',
        'prose-code:text-inherit prose-code:bg-background-tertiary prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none',
        '[&>:first-child]:mt-0 [&>:last-child]:mb-0',
        className,
      )}
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
