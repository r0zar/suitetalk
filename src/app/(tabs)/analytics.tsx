import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAnalytics } from '@/hooks/use-analytics';
import { formatHour } from '@/lib/analytics';

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const { status, analytics, error } = useAnalytics();

  return (
    <ThemedView style={styles.root}>
      <ThemedView
        style={[
          styles.container,
          {
            paddingTop: insets.top + Spacing.two,
            paddingBottom: insets.bottom + Spacing.two,
          },
        ]}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Analytics</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            this month
          </ThemedText>
        </View>

        {status === 'error' ? (
          <ThemedText themeColor="textSecondary">{error}</ThemedText>
        ) : null}

        <View style={styles.statRow}>
          <Stat label="Notes" value={String(analytics.total)} />
          <Stat label="Authors" value={String(analytics.uniqueAuthors)} />
          <Stat
            label="Busiest hour"
            value={
              analytics.busiestHour
                ? formatHour(analytics.busiestHour.hour)
                : '—'
            }
          />
        </View>

        <ThemedText type="smallBold" themeColor="textSecondary">
          By author
        </ThemedText>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.list}>
          {analytics.perUser.length === 0 ? (
            <ThemedView style={styles.emptyState}>
              <ThemedText themeColor="textSecondary">
                No notes this month yet.
              </ThemedText>
            </ThemedView>
          ) : (
            analytics.perUser.map((u) => (
              <ThemedView
                key={u.handle}
                type="backgroundElement"
                style={styles.row}>
                <ThemedText style={styles.handle}>{u.handle}</ThemedText>
                <ThemedText type="smallBold">{u.count}</ThemedText>
              </ThemedView>
            ))
          )}
        </ScrollView>
      </ThemedView>
    </ThemedView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.stat}>
      <ThemedText type="subtitle">{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
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
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  statRow: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  stat: {
    flex: 1,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: 'center',
    gap: Spacing.half,
  },
  list: { gap: Spacing.one, paddingVertical: Spacing.one },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.five,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  handle: { flex: 1 },
});
