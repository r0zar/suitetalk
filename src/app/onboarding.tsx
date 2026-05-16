import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useIdentity } from '@/hooks/use-identity';
import { useTheme } from '@/hooks/use-theme';

export default function OnboardingScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state, rename } = useIdentity();

  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Seed the input from the resolved handle exactly once, when identity flips to ready.
  useEffect(() => {
    if (!seeded && state.status === 'ready') {
      setValue(state.identity.handle);
      setSeeded(true);
    }
  }, [seeded, state]);

  if (state.status !== 'ready') return <ThemedView style={{ flex: 1 }} />;

  const confirm = async (next: string) => {
    setError(null);
    setBusy(true);
    try {
      // Always call rename even if unchanged — it's the side-channel that
      // marks the identity as onboarded (sets isFresh = false on next read).
      await rename(next);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView
      style={[
        styles.root,
        { paddingTop: insets.top + Spacing.six, paddingBottom: insets.bottom + Spacing.four },
      ]}>
      <View style={styles.body}>
        <ThemedText type="subtitle">Welcome to SuiteTalk</ThemedText>
        <ThemedText themeColor="textSecondary">
          We&apos;ve picked a handle for you. Keep it, or change it now. (You can rename later.)
        </ThemedText>

        <ThemedView type="backgroundElement" style={styles.inputWrap}>
          <TextInput
            style={[styles.input, { color: theme.text }]}
            value={value}
            onChangeText={setValue}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </ThemedView>
        {error ? <ThemedText themeColor="textSecondary">{error}</ThemedText> : null}

        <Pressable disabled={busy} onPress={() => confirm(value)}>
          <ThemedView type="backgroundSelected" style={styles.button}>
            <ThemedText type="smallBold">{busy ? 'Saving…' : 'Continue'}</ThemedText>
          </ThemedView>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
  },
  body: {
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  inputWrap: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  input: {
    fontSize: 16,
    paddingVertical: Spacing.three,
  },
  button: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
    alignSelf: 'flex-start',
  },
});
