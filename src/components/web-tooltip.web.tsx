import type { ReactNode } from 'react';

// Render a thin <div title=…> so the browser shows a native hover tooltip on
// our icon-only buttons. The div is display:contents so it doesn't introduce
// any layout box of its own.
export function WebTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div title={label} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
