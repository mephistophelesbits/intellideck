'use client';

import { formatDistanceToNow } from 'date-fns';

interface RelativeTimeProps {
  date: string | Date;
  className?: string;
}

export function RelativeTime({ date, className }: RelativeTimeProps) {
  return (
    <span className={className} suppressHydrationWarning>
      {formatDistanceToNow(new Date(date), { addSuffix: true })}
    </span>
  );
}
