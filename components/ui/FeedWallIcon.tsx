import type { SVGProps } from 'react';

type FeedWallIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number | string;
};

export function FeedWallIcon({
  size = 24,
  strokeWidth = 2,
  className,
  ...props
}: FeedWallIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <rect
        x="4"
        y="3.75"
        width="6.25"
        height="7.25"
        rx="1.45"
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />
      <rect
        x="13.75"
        y="3.75"
        width="6.25"
        height="4.9"
        rx="1.45"
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />
      <rect
        x="4"
        y="14.05"
        width="6.25"
        height="6.2"
        rx="1.45"
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />
      <rect
        x="13.75"
        y="11.7"
        width="6.25"
        height="8.55"
        rx="1.45"
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />
      <path
        d="M7.1 7.4h.05M16.85 6.2h.05M16.85 15.95h.05"
        stroke="currentColor"
        strokeWidth={Number(strokeWidth) + 0.4}
        strokeLinecap="round"
      />
    </svg>
  );
}
