'use client';

import { formatDistanceToNow } from 'date-fns';

interface TimeAgoProps {
    date: string | Date;
    className?: string;
    addSuffix?: boolean;
}

export function TimeAgo({ date, className, addSuffix = true }: TimeAgoProps) {
    return (
        <span className={className} suppressHydrationWarning>
            {formatDistanceToNow(new Date(date), { addSuffix })}
        </span>
    );
}
