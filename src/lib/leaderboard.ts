import type { Note } from './notes';

export function startOfMonth(at: Date = new Date()): Date {
  return new Date(at.getFullYear(), at.getMonth(), 1, 0, 0, 0, 0);
}

export type LeaderboardRow = {
  handle: string;
  count: number;
  rank: number; // 1-indexed; ties share a rank (1, 2, 2, 4)
};

export function rankNotes(notes: Note[]): LeaderboardRow[] {
  const counts = new Map<string, number>();
  for (const n of notes) {
    const h = n.authorHandle || 'unknown';
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  const sorted = [...counts.entries()]
    .map(([handle, count]) => ({ handle, count }))
    .sort((a, b) => (b.count - a.count) || a.handle.localeCompare(b.handle));

  const rows: LeaderboardRow[] = [];
  let lastCount = -1;
  let lastRank = 0;
  sorted.forEach((row, i) => {
    const rank = row.count === lastCount ? lastRank : i + 1;
    lastCount = row.count;
    lastRank = rank;
    rows.push({ ...row, rank });
  });
  return rows;
}
