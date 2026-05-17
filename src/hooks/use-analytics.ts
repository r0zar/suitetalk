import { useEffect, useMemo, useState } from 'react';

import { startOfMonth, summarize, type Analytics } from '@/lib/analytics';
import { subscribeToNotesSince, type Note } from '@/lib/notes';

type State =
  | { status: 'loading' }
  | { status: 'ready'; notes: Note[] }
  | { status: 'error'; error: string };

export function useAnalytics() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const since = startOfMonth();
    const unsub = subscribeToNotesSince(
      since,
      (notes) => setState({ status: 'ready', notes }),
      (err) => setState({ status: 'error', error: err.message }),
    );
    return () => unsub();
  }, []);

  const analytics: Analytics = useMemo(
    () =>
      state.status === 'ready'
        ? summarize(state.notes)
        : { total: 0, uniqueAuthors: 0, perUser: [], busiestHour: null },
    [state],
  );

  return {
    status: state.status,
    analytics,
    error: state.status === 'error' ? state.error : null,
  };
}
