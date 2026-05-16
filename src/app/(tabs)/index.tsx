import { Redirect } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useIdentity } from '@/hooks/use-identity';
import { useNotes } from '@/hooks/use-notes';

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const { state: idState } = useIdentity();
  const feed = useNotes();

  if (idState.status === 'ready' && idState.identity.isFresh) {
    return <Redirect href="/onboarding" />;
  }

  const handle = idState.status === 'ready' ? idState.identity.handle : '...';

  // Render newest at the bottom for chat-like flow.
  const ordered = [...feed.notes].reverse();

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
        <ThemedView style={styles.header}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            YOU ARE
          </ThemedText>
          <ThemedText type="smallBold">{handle}</ThemedText>
        </ThemedView>

        {feed.status === 'error' ? (
          <ThemedText themeColor="textSecondary">{feed.error}</ThemedText>
        ) : null}

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}>
          {ordered.length === 0 ? (
            <ThemedView style={styles.emptyState}>
              <ThemedText type="subtitle">No notes yet</ThemedText>
              <ThemedText themeColor="textSecondary">
                When someone says &ldquo;heads up&rdquo;, it appears here.
              </ThemedText>
            </ThemedView>
          ) : (
            ordered.map((n) => (
              <ThemedView
                key={n.id}
                type="backgroundElement"
                style={styles.messageBubble}>
                <View style={styles.bubbleMeta}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    {n.authorHandle || 'unknown'}
                  </ThemedText>
                  {n.createdAt ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatTime(n.createdAt)}
                    </ThemedText>
                  ) : null}
                </View>
                <ThemedText>{n.text}</ThemedText>
              </ThemedView>
            ))
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
    gap: Spacing.two,
  },
  scrollContent: {
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  messageBubble: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
});

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
