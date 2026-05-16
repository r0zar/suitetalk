import { useEffect, useState } from 'react';
import { getIdentity, renameHandle as renameHandleSvc, type Identity } from '@/lib/identity';

type State =
  | { status: 'loading' }
  | { status: 'ready'; identity: Identity }
  | { status: 'error'; error: string };

export function useIdentity() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getIdentity()
      .then((identity) => {
        if (!cancelled) setState({ status: 'ready', identity });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rename = async (next: string) => {
    if (state.status !== 'ready') return;
    await renameHandleSvc(state.identity.uid, next);
    setState({
      status: 'ready',
      identity: { ...state.identity, handle: next.trim().toLowerCase(), isFresh: false },
    });
  };

  return { state, rename };
}
