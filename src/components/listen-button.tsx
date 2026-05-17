import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

type Props = {
  status: 'idle' | 'starting' | 'live' | 'stopping' | 'error';
  transcript?: string;
  errorMessage?: string;
  onPress: () => void;
};

export function ListenButton({ status, transcript, errorMessage, onPress }: Props) {
  const label =
    status === 'idle' ? 'Start Listening'
    : status === 'starting' ? 'Starting…'
    : status === 'live' ? 'Listening — tap to stop'
    : status === 'stopping' ? 'Stopping…'
    : 'Retry';

  const isLive = status === 'live';
  const isBusy = status === 'starting' || status === 'stopping';

  return (
    <ThemedView style={styles.wrap}>
      <Pressable disabled={isBusy} onPress={onPress}>
        <ThemedView
          type={isLive ? 'backgroundSelected' : 'backgroundElement'}
          style={styles.button}>
          <ThemedText type="smallBold">{label}</ThemedText>
        </ThemedView>
      </Pressable>
      {isLive && transcript ? (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {transcript}
        </ThemedText>
      ) : null}
      {status === 'error' && errorMessage ? (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
          {errorMessage}
        </ThemedText>
      ) : null}
      {status === 'idle' ? (
        <ThemedText type="small" themeColor="textSecondary">
          Say &ldquo;heads up&rdquo; then your note.
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.one,
    alignItems: 'center',
  },
  button: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    alignItems: 'center',
    minWidth: 200,
  },
});
