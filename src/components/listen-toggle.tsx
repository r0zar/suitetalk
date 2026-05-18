import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { WebTooltip } from '@/components/web-tooltip';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Status = 'idle' | 'starting' | 'live' | 'reconnecting' | 'stopping' | 'error';

type Props = {
  status: Status;
  onPress: () => void;
};

export function ListenToggle({ status, onPress }: Props) {
  const theme = useTheme();
  const isActive = status === 'live' || status === 'reconnecting';
  const isBusy = status === 'starting' || status === 'stopping';

  const icon: keyof typeof Ionicons.glyphMap =
    status === 'reconnecting' ? 'sync-outline'
    : isActive ? 'mic'
    : 'mic-outline';

  // Use text color for the icon so it shows up clearly against the bubble.
  const tint = isActive ? theme.text : theme.textSecondary;

  const label =
    status === 'reconnecting' ? 'Reconnecting… tap to stop'
    : isActive ? 'Stop listening'
    : isBusy ? 'Busy…'
    : 'Start listening';

  return (
    <WebTooltip label={label}>
      <Pressable
        onPress={onPress}
        disabled={isBusy}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={label}>
        <ThemedView
          type={isActive ? 'backgroundSelected' : 'backgroundElement'}
          style={styles.button}>
          <Ionicons name={icon} size={18} color={tint} />
        </ThemedView>
      </Pressable>
    </WebTooltip>
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
