import type { SVGProps } from 'react';

// Small stroke icons (16px grid, currentColor). Hand-rolled to avoid an icon dependency.
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

export const CheckIcon = (p: IconProps) => <Svg {...p}><path d="M3.5 8.5l3 3 6-7" /></Svg>;
export const XIcon = (p: IconProps) => <Svg {...p}><path d="M4.5 4.5l7 7m0-7l-7 7" /></Svg>;
export const AlertIcon = (p: IconProps) => <Svg {...p}><path d="M8 2.5l6 10.5H2L8 2.5z" /><path d="M8 6.5v3M8 11.3v.2" /></Svg>;
export const InfoIcon = (p: IconProps) => <Svg {...p}><circle cx="8" cy="8" r="6" /><path d="M8 7.2v3.6M8 5v.2" /></Svg>;
export const PlusIcon = (p: IconProps) => <Svg {...p}><path d="M8 3v10M3 8h10" /></Svg>;
export const ArrowUpIcon = (p: IconProps) => <Svg {...p}><path d="M8 13V3m-4 4l4-4 4 4" /></Svg>;
export const ArrowDownIcon = (p: IconProps) => <Svg {...p}><path d="M8 3v10m-4-4l4 4 4-4" /></Svg>;
export const ArrowRightIcon = (p: IconProps) => <Svg {...p}><path d="M3 8h10m-4-4l4 4-4 4" /></Svg>;
export const ChevronIcon = (p: IconProps) => <Svg {...p}><path d="M6 4l4 4-4 4" /></Svg>;
export const SparkIcon = (p: IconProps) => <Svg {...p}><path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2L12 12M12 4l-1.8 1.8M5.8 10.2L4 12" /></Svg>;
export const DatabaseIcon = (p: IconProps) => <Svg {...p}><ellipse cx="8" cy="4" rx="5" ry="2" /><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" /></Svg>;
export const GlobeIcon = (p: IconProps) => <Svg {...p}><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c1.8 2 1.8 10 0 12M8 2c-1.8 2-1.8 10 0 12" /></Svg>;
export const ShieldIcon = (p: IconProps) => <Svg {...p}><path d="M8 2l5 2v4c0 3-2.2 5.2-5 6-2.8-.8-5-3-5-6V4l5-2z" /><path d="M6 8l1.5 1.5L10.5 6.5" /></Svg>;
export const LinkIcon = (p: IconProps) => <Svg {...p}><path d="M7 9a2.5 2.5 0 003.5 0l2-2A2.5 2.5 0 009 3.5l-.7.7M9 7a2.5 2.5 0 00-3.5 0l-2 2A2.5 2.5 0 007 12.5l.7-.7" /></Svg>;
export const WrenchIcon = (p: IconProps) => <Svg {...p}><path d="M10.5 2.5a3 3 0 00-3.4 4l-4.6 4.6 1.4 1.4 4.6-4.6a3 3 0 004-3.4l-1.8 1.8-1.6-.4-.4-1.6 1.8-1.8z" /></Svg>;
export const RetryIcon = (p: IconProps) => <Svg {...p}><path d="M13 8a5 5 0 11-1.5-3.5M13 2.5v3h-3" /></Svg>;
export const PlayIcon = (p: IconProps) => <Svg {...p}><path d="M5 3.5l7 4.5-7 4.5v-9z" /></Svg>;

export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={`spin ${className}`} aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 00-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
