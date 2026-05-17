import { Redirect } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ListenToggle } from "@/components/listen-toggle";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { WakeToggle } from "@/components/wake-toggle";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useIdentity } from "@/hooks/use-identity";
import { useNotes } from "@/hooks/use-notes";
import { useShift } from "@/hooks/use-shift";

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const { state: idState } = useIdentity();
  const feed = useNotes();
  const [wakeEnabled, setWakeEnabled] = useState(true);
  const shift = useShift({ wakeEnabled });

  if (idState.status === "ready" && idState.identity.isFresh) {
    return <Redirect href="/onboarding" />;
  }

  const handle = idState.status === "ready" ? idState.identity.handle : "...";

  // Feed query returns newest-first (orderBy createdAt desc); render in that order.
  const ordered = feed.notes;

  const live = shift.state.status === "live" ? shift.state : null;
  // Inline preview text above the feed while STT is rolling. We prefer the
  // post-"heads up" text (what will actually be saved) when it's present;
  // otherwise we show the raw partial so the user knows the mic is hearing
  // them. No bubble — keeps the visual handoff to the persisted note quiet.
  const previewText = live?.preview.armedText ?? live?.preview.partial ?? "";
  const showPreview = !!live && previewText.trim().length > 0;
  const isArmed = !!live?.preview.armedText;

  const toggleStatus = shift.state.status;
  const onToggle =
    toggleStatus === "live" || toggleStatus === "reconnecting"
      ? shift.stop
      : shift.start;

  return (
    <ThemedView style={styles.root}>
      <ThemedView
        style={[
          styles.container,
          {
            paddingTop: insets.top + Spacing.two,
            paddingLeft: insets.top + Spacing.two,
            paddingRight: insets.top + Spacing.two,
          },
        ]}
      >
        <ThemedView style={styles.header}>
          <View style={styles.headerLeft}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              YOU ARE
            </ThemedText>
            <ThemedText type="smallBold">{handle}</ThemedText>
          </View>
          <View style={styles.headerRight}>
            <ListenToggle status={toggleStatus} onPress={onToggle} />
            <WakeToggle
              wakeEnabled={wakeEnabled}
              onPress={() => setWakeEnabled((v) => !v)}
            />
          </View>
        </ThemedView>

        {feed.status === "error" ? (
          <ThemedText themeColor="textSecondary">{feed.error}</ThemedText>
        ) : null}

        {shift.state.status === "error" ? (
          <ThemedText type="small" themeColor="textSecondary">
            {shift.state.message}
          </ThemedText>
        ) : null}

        {showPreview ? (
          <Animated.View
            entering={FadeIn.duration(150)}
            exiting={FadeOut.duration(200)}
            style={styles.previewRow}
          >
            <ThemedText
              type="small"
              themeColor="textSecondary"
              numberOfLines={2}
              style={!isArmed && styles.previewDim}
            >
              {previewText}
            </ThemedText>
          </Animated.View>
        ) : null}

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
        >
          {ordered.length === 0 ? (
            <ThemedView style={styles.emptyState}>
              <ThemedText type="subtitle">No notes yet</ThemedText>
              <ThemedText themeColor="textSecondary">
                When someone says &ldquo;heads up&rdquo;, it appears here.
              </ThemedText>
            </ThemedView>
          ) : (
            ordered.map((n) => (
              <Animated.View key={n.id} entering={FadeIn.duration(250)}>
                <ThemedView
                  type="backgroundElement"
                  style={styles.messageBubble}
                >
                  <View style={styles.bubbleMeta}>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      {n.authorHandle || "unknown"}
                    </ThemedText>
                    {n.createdAt ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatTime(n.createdAt)}
                      </ThemedText>
                    ) : null}
                  </View>
                  <ThemedText>{n.text}</ThemedText>
                </ThemedView>
              </Animated.View>
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
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Spacing.two,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  scrollContent: {
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
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
  previewRow: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 20,
  },
  bubbleMeta: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
});

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
