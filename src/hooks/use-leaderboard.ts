import { useEffect, useMemo, useState } from 'react';

import { useIdentity } from '@/hooks/use-identity';
import { startOfMonth, rankNotes, type LeaderboardRow } from '@/lib/leaderboard';
import { subscribeToNotesSince, type Note } from '@/lib/notes';

type State =
  | { status: 'loading' }
  | { status: 'ready'; notes: Note[] }
  | { status: 'error'; error: string };

export function useLeaderboard() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const { state: idState } = useIdentity();

  useEffect(() => {
    const since = startOfMonth();
    const unsub = subscribeToNotesSince(
      since,
      (notes) => setState({ status: 'ready', notes }),
      (err) => setState({ status: 'error', error: err.message }),
    );
    return () => unsub();
  }, []);

  const rows: LeaderboardRow[] = useMemo(
    () => (state.status === 'ready' ? rankNotes(state.notes) : []),
    [state],
  );

  const currentHandle = idState.status === 'ready' ? idState.identity.handle : null;
  const currentRow = currentHandle
    ? rows.find((r) => r.handle === currentHandle) ?? null
    : null;

  return { status: state.status, rows, currentRow, error: state.status === 'error' ? state.error : null };
}
