import type { ReactNode } from 'react';

// Native no-op. The web sibling (web-tooltip.web.tsx) wraps the children in a
// <div title={label}> so browsers render the native hover tooltip.
export function WebTooltip({ children }: { label: string; children: ReactNode }) {
  return <>{children}</>;
}
