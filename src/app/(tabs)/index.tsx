import { Redirect } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListenToggle } from '@/components/listen-toggle';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useIdentity } from '@/hooks/use-identity';
import { useNotes } from '@/hooks/use-notes';
import { useShift } from '@/hooks/use-shift';

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const { state: idState } = useIdentity();
  const feed = useNotes();
  const shift = useShift();

  if (idState.status === 'ready' && idState.identity.isFresh) {
    return <Redirect href="/onboarding" />;
  }

  const handle = idState.status === 'ready' ? idState.identity.handle : '...';

  // Feed query returns newest-first (orderBy createdAt desc); render in that order.
  const ordered = feed.notes;

  const live = shift.state.status === 'live' ? shift.state : null;
  // Show a preview bubble whenever we have STT text. If "heads up" has been
  // heard, render it solid; otherwise faded — visually signaling what will
  // actually be saved.
  const previewText = live?.preview.armedText ?? live?.preview.partial ?? '';
  const showPreview = !!live && previewText.trim().length > 0;
  const isArmed = !!live?.preview.armedText;

  const toggleStatus = shift.state.status;
  const onToggle =
    toggleStatus === 'live' || toggleStatus === 'reconnecting'
      ? shift.stop
      : shift.start;

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
        <ThemedView style={styles.header}>
          <View style={styles.headerLeft}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              YOU ARE
            </ThemedText>
            <ThemedText type="smallBold">{handle}</ThemedText>
          </View>
          <ListenToggle status={toggleStatus} onPress={onToggle} />
        </ThemedView>

        {feed.status === 'error' ? (
          <ThemedText themeColor="textSecondary">{feed.error}</ThemedText>
        ) : null}

        {shift.state.status === 'error' ? (
          <ThemedText type="small" themeColor="textSecondary">
            {shift.state.message}
          </ThemedText>
        ) : null}

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}>
          {showPreview ? (
            <ThemedView
              type={isArmed ? 'backgroundSelected' : 'backgroundElement'}
              style={[styles.messageBubble, !isArmed && styles.previewDim]}>
              <View style={styles.bubbleMeta}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {handle}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {isArmed ? 'recording…' : 'listening…'}
                </ThemedText>
              </View>
              <ThemedText themeColor={isArmed ? undefined : 'textSecondary'}>
                {previewText}
              </ThemedText>
            </ThemedView>
          ) : null}

          {ordered.length === 0 && !showPreview ? (
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
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  scrollContent: {
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.five,
  },
  messageBubble: {
    gap: Spacing.half,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  previewDim: {
    opacity: 0.6,
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
