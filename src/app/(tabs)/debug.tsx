import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getIdentity } from '@/lib/identity';
import { postNote } from '@/lib/notes';

type DebugAction = {
  label: string;
  run: () => Promise<unknown>;
};

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
];

type RunState =
  | { status: 'idle' }
  | { status: 'running'; label: string }
  | { status: 'done'; label: string; result: unknown; durationMs: number }
  | { status: 'error'; label: string; error: string; durationMs: number };

export default function DebugScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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

        <View style={styles.panels}>
          <ThemedView type="backgroundElement" style={styles.leftPanel}>
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

          <ThemedView type="backgroundElement" style={styles.rightPanel}>
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
  leftPanel: {
    width: 240,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  rightPanel: {
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
