// Detects the wake phrase "heads up" in a stream of committed
// transcripts and captures the next utterance. Pure: no side effects,
// no I/O. The server owns one of these per WebSocket session.

export type WakeResult =
  | { kind: 'idle' }
  | { kind: 'armed' }       // waiting for the next non-empty committed transcript
  | { kind: 'utterance'; text: string };

type State = 'IDLE' | 'CAPTURING';

const WAKE_RE = /\bheads[\s-]+up\b[\s,.!?:;-]*/i;

function isMeaningful(text: string): boolean {
  return /\S/.test(text.replace(/[\s.,!?;:-]+/g, ''));
}

export class WakeMachine {
  private state: State = 'IDLE';

  feed(text: string): WakeResult {
    const trimmed = text.trim();

    if (this.state === 'IDLE') {
      const match = WAKE_RE.exec(trimmed);
      if (!match) return { kind: 'idle' };

      // "heads up" appears in the committed transcript. Whatever follows
      // it in the same transcript is the utterance.
      const after = trimmed.slice((match.index ?? 0) + match[0].length).trim();
      if (after && isMeaningful(after)) {
        // Single-shot capture: "heads up X" → utterance "X", stay IDLE.
        return { kind: 'utterance', text: after };
      }
      // Wake phrase landed alone; the next non-empty committed transcript
      // is the utterance.
      this.state = 'CAPTURING';
      return { kind: 'armed' };
    }

    // CAPTURING — waiting for an utterance.
    if (!isMeaningful(trimmed)) {
      // empty / punctuation-only commit; keep waiting.
      return { kind: 'armed' };
    }
    this.state = 'IDLE';
    return { kind: 'utterance', text: trimmed };
  }

  reset(): void {
    this.state = 'IDLE';
  }
}
