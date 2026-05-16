import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export function DebugFab() {
  const router = useRouter();
  if (Platform.OS !== 'web') return null;

  return (
    <Pressable
      onPress={() => router.push('/debug')}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
      accessibilityLabel="Open debug panel">
      <ThemedView type="backgroundSelected" style={styles.bubble}>
        <ThemedText type="smallBold">DEBUG</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    position: 'absolute',
    right: Spacing.four,
    bottom: Spacing.four,
    zIndex: 10,
  },
  pressed: {
    opacity: 0.7,
  },
  bubble: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.five,
  },
});
