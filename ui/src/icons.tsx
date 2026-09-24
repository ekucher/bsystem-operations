import type { ComponentType, ReactNode, SVGProps } from 'react';

// Мінімалістичний inline SVG-набір (без зовнішніх залежностей/CDN) — той
// самий візуальний стиль (stroke=currentColor, 24x24, заокруглені кінці),
// що узгоджений у макеті редизайну. Декоративні — не несуть власного
// accessible name, тому aria-hidden завжди true.
function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="icon"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconSuccess(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9" />
    </Icon>
  );
}

export function IconWarning(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3 2 21h20L12 3z" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconCritical(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </Icon>
  );
}

export function IconSkipped(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </Icon>
  );
}

export function IconPending(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" strokeDasharray="2.5 3" />
    </Icon>
  );
}

export function IconSun(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </Icon>
  );
}

export function IconMoon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M20 12.5A8 8 0 1 1 11.5 4a6.5 6.5 0 0 0 8.5 8.5z" />
    </Icon>
  );
}

export function IconChevronLeft(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M15 6l-6 6 6 6" />
    </Icon>
  );
}

export function IconChevronRight(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M9 6l6 6-6 6" />
    </Icon>
  );
}

export function IconRefresh(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </Icon>
  );
}

export function IconRack(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="4" y="4" width="16" height="4.5" rx="1" />
      <rect x="4" y="10.75" width="16" height="4.5" rx="1" />
      <rect x="4" y="17.5" width="16" height="2.5" rx="1" />
    </Icon>
  );
}

export function IconLock(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Icon>
  );
}

export type IconTier = 'success' | 'warning' | 'critical' | 'skipped' | 'pending';

const TIER_ICON: Record<IconTier, ComponentType<SVGProps<SVGSVGElement>>> = {
  success: IconSuccess,
  warning: IconWarning,
  critical: IconCritical,
  skipped: IconSkipped,
  pending: IconPending,
};

export function TierIcon({ tier, ...props }: { tier: IconTier } & SVGProps<SVGSVGElement>) {
  const Component = TIER_ICON[tier];
  return <Component {...props} />;
}
