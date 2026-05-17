import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  wakeEnabled: boolean;
  onPress: () => void;
};

// Toggle between wake-phrase mode (only "heads up X" becomes a note) and free
// mode (every committed utterance becomes a note). Sits next to the mic in
// the Feed header.
export function WakeToggle({ wakeEnabled, onPress }: Props) {
  const theme = useTheme();

  // sparkles = wake phrase active (a triggered keyword), megaphone-outline = free mode.
  const icon: keyof typeof Ionicons.glyphMap = wakeEnabled
    ? 'sparkles'
    : 'megaphone-outline';

  const tint = wakeEnabled ? theme.text : theme.textSecondary;

  const label = wakeEnabled
    ? 'Wake phrase on — only “heads up” triggers notes. Tap to disable.'
    : 'Wake phrase off — every utterance becomes a note. Tap to enable.';

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      // `title` is passed through by react-native-web to the underlying DOM
      // element to give a browser hover tooltip. RN types don't include it.
      {...({ title: label } as object)}>
      <ThemedView
        type={wakeEnabled ? 'backgroundSelected' : 'backgroundElement'}
        style={styles.button}>
        <Ionicons name={icon} size={16} color={tint} />
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
  },
});
