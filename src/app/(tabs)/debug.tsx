import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getIdentity } from '@/lib/identity';
import { postNote } from '@/lib/notes';
import { openVoiceSession } from '@/lib/voice-ws';

type DebugAction = {
  label: string;
  run: () => Promise<unknown>;
};

async function captureMicAndStream(
  onTranscript: (kind: 'partial' | 'committed', text: string) => void,
  durationMs = 5000,
): Promise<void> {
  if (Platform.OS !== 'web') throw new Error('Mic capture is web-only for now');
  const { uid, handle } = await getIdentity();
  const session = openVoiceSession({ clientId: uid, handle });
  session.onServerMessage((msg) => {
    if (msg.type === 'transcript') onTranscript(msg.kind, msg.text);
  });

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const source = ctx.createMediaStreamSource(stream);
  // Tiny inline AudioWorklet that converts Float32 → Int16 PCM and posts
  // base64 strings up to the main thread.
  const workletSrc = `
    class PCM16Emitter extends AudioWorkletProcessor {
      process(inputs) {
        const ch = inputs[0]?.[0];
        if (!ch) return true;
        const buf = new Int16Array(ch.length);
        for (let i = 0; i < ch.length; i++) {
          const s = Math.max(-1, Math.min(1, ch[i]));
          buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage(buf.buffer, [buf.buffer]);
        return true;
      }
    }
    registerProcessor('pcm16-emitter', PCM16Emitter);
  `;
  const blob = new Blob([workletSrc], { type: 'application/javascript' });
  await ctx.audioWorklet.addModule(URL.createObjectURL(blob));
  const node = new AudioWorkletNode(ctx, 'pcm16-emitter');

  node.port.onmessage = (ev) => {
    const bytes = new Uint8Array(ev.data as ArrayBuffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = globalThis.btoa(bin);
    session.sendChunk(b64);
  };

  source.connect(node);

  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));

  node.disconnect();
  source.disconnect();
  stream.getTracks().forEach((t) => t.stop());
  await ctx.close();
  session.end();
  // Give ElevenLabs a moment to emit the final committed transcript before
  // we close the WS — 1500ms is more than the VAD threshold, so any
  // remaining audio will commit.
  await new Promise<void>((resolve) => setTimeout(resolve, 1500));
  session.close();
}

const ACTIONS: DebugAction[] = [
  {
    label: 'Post test note',
    run: async () => {
      const { uid, handle } = await getIdentity();
      const text = `test note ${Math.random().toString(36).slice(2, 6)}`;
      const id = await postNote({ text, authorUid: uid, authorHandle: handle });
      return { ok: true, noteId: id, text, authorHandle: handle };
    },
  },
  {
    label: 'Voice WS round-trip',
    run: async () => {
      const { uid, handle } = await getIdentity();
      const events: string[] = [];
      const startedAt = Date.now();
      const session = openVoiceSession({
        clientId: uid,
        handle,
        onOpen: () => events.push('open'),
        onClose: (code, reason) => events.push(`close ${code} ${reason}`),
        onError: () => events.push('error'),
      });
      const ack = await new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('no ack in 5s')), 5000);
        session.onServerMessage((msg) => {
          events.push(`recv ${msg.type}`);
          if (msg.type === 'ready') {
            session.sendChunk('SGVsbG8gV29ybGQ='); // base64("Hello World")
          }
          if (msg.type === 'ack') {
            clearTimeout(timeout);
            session.end();
            session.close();
            resolve(msg);
          }
        });
      });
      return {
        url: session.url,
        durationMs: Date.now() - startedAt,
        events,
        ack,
      };
    },
  },
  {
    label: 'Stream mic to STT (5s)',
    run: async () => {
      const transcripts: { kind: string; text: string; t: number }[] = [];
      const start = Date.now();
      await captureMicAndStream((kind, text) => {
        transcripts.push({ kind, text, t: Date.now() - start });
      });
      return {
        captureMs: 5000,
        durationMs: Date.now() - start,
        transcripts,
      };
    },
  },
];

type RunState =
  | { status: 'idle' }
  | { status: 'running'; label: string }
  | { status: 'done'; label: string; result: unknown; durationMs: number }
  | { status: 'error'; label: string; error: string; durationMs: number };

export default function DebugScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isNarrow = width < 768;
  const [state, setState] = useState<RunState>({ status: 'idle' });

  const runAction = async (action: DebugAction) => {
    setState({ status: 'running', label: action.label });
    const started = Date.now();
    try {
      const result = await action.run();
      setState({
        status: 'done',
        label: action.label,
        result,
        durationMs: Date.now() - started,
      });
    } catch (err) {
      setState({
        status: 'error',
        label: action.label,
        error: err instanceof Error ? err.stack ?? err.message : String(err),
        durationMs: Date.now() - started,
      });
    }
  };

  return (
    <ThemedView style={styles.root}>
      <ThemedView
        style={[
          styles.container,
          { paddingTop: insets.top + Spacing.three, paddingBottom: insets.bottom + Spacing.three },
        ]}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Debug</ThemedText>
        </View>

        <View style={[styles.panels, isNarrow && styles.panelsStacked]}>
          <ThemedView
            type="backgroundElement"
            style={[styles.actionsPanel, isNarrow && styles.actionsPanelNarrow]}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.panelLabel}>
              ACTIONS
            </ThemedText>
            <ScrollView contentContainerStyle={styles.actionList}>
              {ACTIONS.map((action) => {
                const isRunning = state.status === 'running' && state.label === action.label;
                return (
                  <Pressable
                    key={action.label}
                    onPress={() => runAction(action)}
                    disabled={state.status === 'running'}
                    style={({ pressed }) => [pressed && styles.pressed]}>
                    <ThemedView
                      type={isRunning ? 'backgroundSelected' : 'background'}
                      style={[styles.actionButton, { borderColor: theme.backgroundSelected }]}>
                      <ThemedText>{isRunning ? `${action.label}…` : action.label}</ThemedText>
                    </ThemedView>
                  </Pressable>
                );
              })}
            </ScrollView>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.outputPanel}>
            <View style={styles.panelHeader}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.panelLabel}>
                OUTPUT
              </ThemedText>
              {state.status === 'done' || state.status === 'error' ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {state.label} · {state.durationMs}ms
                </ThemedText>
              ) : null}
            </View>
            <ScrollView style={styles.output} contentContainerStyle={styles.outputContent}>
              <ThemedText type="code" style={{ color: theme.text }}>
                {renderOutput(state)}
              </ThemedText>
            </ScrollView>
          </ThemedView>
        </View>
      </ThemedView>
    </ThemedView>
  );
}

function renderOutput(state: RunState): string {
  switch (state.status) {
    case 'idle':
      return 'Select an action on the left.';
    case 'running':
      return `Running: ${state.label}…`;
    case 'done':
      return safeStringify(state.result);
    case 'error':
      return state.error;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth * 1.5,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pressed: {
    opacity: 0.7,
  },
  panels: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.three,
  },
  panelsStacked: {
    flexDirection: 'column',
  },
  actionsPanel: {
    width: 240,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  actionsPanelNarrow: {
    width: '100%',
    maxHeight: 200,
  },
  outputPanel: {
    flex: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  panelLabel: {
    letterSpacing: 1,
  },
  actionList: {
    gap: Spacing.two,
  },
  actionButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
  },
  output: {
    flex: 1,
  },
  outputContent: {
    paddingBottom: Spacing.three,
  },
});
