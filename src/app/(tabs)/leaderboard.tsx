import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useLeaderboard } from '@/hooks/use-leaderboard';

export default function LeaderboardScreen() {
  const insets = useSafeAreaInsets();
  const { status, rows, currentRow, error } = useLeaderboard();
  const currentHandle = currentRow?.handle ?? null;

  return (
    <ThemedView style={styles.root}>
      <ThemedView
        style={[
          styles.container,
          {
            paddingTop: insets.top + Spacing.three,
            paddingBottom: insets.bottom + Spacing.three,
          },
        ]}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Leaderboard</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            this month
          </ThemedText>
        </View>

        {status === 'error' ? (
          <ThemedText themeColor="textSecondary">{error}</ThemedText>
        ) : null}

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.list}>
          {rows.length === 0 ? (
            <ThemedView style={styles.emptyState}>
              <ThemedText themeColor="textSecondary">
                No notes this month yet.
              </ThemedText>
            </ThemedView>
          ) : (
            rows.map((r) => {
              const isMe = r.handle === currentHandle;
              return (
                <ThemedView
                  key={r.handle}
                  type={isMe ? 'backgroundSelected' : 'backgroundElement'}
                  style={styles.row}>
                  <ThemedText type="smallBold" style={styles.rank}>
                    #{r.rank}
                  </ThemedText>
                  <ThemedText style={styles.handle}>{r.handle}</ThemedText>
                  <ThemedText type="smallBold">{r.count}</ThemedText>
                </ThemedView>
              );
            })
          )}
        </ScrollView>
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  list: { gap: Spacing.two, paddingVertical: Spacing.two },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  rank: { minWidth: 32 },
  handle: { flex: 1 },
});
