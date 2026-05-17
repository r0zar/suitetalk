import type { Note } from './notes';

export function startOfMonth(at: Date = new Date()): Date {
  return new Date(at.getFullYear(), at.getMonth(), 1, 0, 0, 0, 0);
}

export type UserCount = {
  handle: string;
  count: number;
};

export type Analytics = {
  total: number;
  uniqueAuthors: number;
  perUser: UserCount[];
  busiestHour: { hour: number; count: number } | null;
};

export function summarize(notes: Note[]): Analytics {
  const counts = new Map<string, number>();
  const hourly = new Array<number>(24).fill(0);

  for (const n of notes) {
    const h = n.authorHandle || 'unknown';
    counts.set(h, (counts.get(h) ?? 0) + 1);
    if (n.createdAt) hourly[n.createdAt.getHours()] += 1;
  }

  const perUser: UserCount[] = [...counts.entries()]
    .map(([handle, count]) => ({ handle, count }))
    .sort((a, b) => b.count - a.count || a.handle.localeCompare(b.handle));

  let busiestHour: Analytics['busiestHour'] = null;
  for (let h = 0; h < 24; h++) {
    if (hourly[h] > 0 && (!busiestHour || hourly[h] > busiestHour.count)) {
      busiestHour = { hour: h, count: hourly[h] };
    }
  }

  return {
    total: notes.length,
    uniqueAuthors: counts.size,
    perUser,
    busiestHour,
  };
}

export function formatHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const period = hour < 12 ? 'am' : 'pm';
  return `${h12}${period}`;
}
