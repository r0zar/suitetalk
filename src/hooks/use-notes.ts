import { useEffect, useState } from 'react';

import { subscribeToNotes, type Note } from '@/lib/notes';

type State =
  | { status: 'loading'; notes: Note[] }
  | { status: 'ready'; notes: Note[] }
  | { status: 'error'; notes: Note[]; error: string };

export function useNotes() {
  const [state, setState] = useState<State>({ status: 'loading', notes: [] });

  useEffect(() => {
    const unsub = subscribeToNotes(
      (notes) => setState({ status: 'ready', notes }),
      (err) =>
        setState((s) => ({
          status: 'error',
          notes: s.notes,
          error: err.message,
        })),
    );
    return () => unsub();
  }, []);

  return state;
}
