# Phase 4: Leaderboard — Implementation Plan

> **Spec reference:** [`docs/mvp-spec.md`](../mvp-spec.md), §3 must-haves ("monthly note count, ranked"), §6 leaderboard computation, plus the brainstorming session that landed on **note count + monthly window + dedicated tab + client-side aggregation**.

**Goal:** A dedicated "Leaderboard" tab that ranks every user by note count for the current month. Visible enough to drive participation but cheap enough that hackathon-scale traffic (< 10 k notes/month) won't strain Firestore or the client.

**Architecture:** Client-side aggregation on tab mount. The screen queries `notes where createdAt >= startOfMonth(now)`, groups by `authorHandle` (denormalized on each note doc), sorts desc, renders top N + the current user's rank. Realtime: subscribe to the same query so the leaderboard updates live as notes arrive. We use the existing `subscribeToNotes` pattern from `src/lib/notes.ts` and add a windowed variant.

This phase reintroduces a tab structure (Feed + Leaderboard) — Phase 1 had removed it. Expo Router groups the two screens under `(tabs)/` to keep the navigation tidy.

**Tech stack:** `@react-native-firebase/firestore`, existing themed components, `expo-router/unstable-native-tabs` (already present in the project history; we'll re-add the bottom tab bar).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/leaderboard.ts` | Pure helpers: `startOfMonth(date)`, `rankNotes(notes)` returning `Array<{ handle, count, rank }>`. Pure functions; easy to reason about. |
| `src/lib/notes.ts` | Add `subscribeToNotesSince(sinceDate, onChange, onError)` — same shape as `subscribeToNotes` but with a `where('createdAt', '>=', ts)` filter and a higher limit (the existing 100-limit subscription is fine for the feed but too restrictive for monthly aggregation). |
| `src/hooks/use-leaderboard.ts` | Hook wrapping `subscribeToNotesSince(startOfMonth(now), …)` and returning `{ status, rows, currentUserRank }`. |
| `src/components/app-tabs.tsx` | Re-add the `NativeTabs` bottom bar with two triggers: Feed and Leaderboard. Mirror the look from before (Phase 0 had this; we removed it in commit `0427548`). |
| `src/app/_layout.tsx` | Modify to render `<AppTabs />` underneath the identity loading overlay, replacing the bare `<Stack>`. |
| `src/app/(tabs)/_layout.tsx` | Group layout for the two tab screens. |
| `src/app/(tabs)/index.tsx` | Move the current feed screen here. Pure relocation, no behavior change. |
| `src/app/(tabs)/leaderboard.tsx` | New screen rendering the leaderboard. |
| `assets/images/tabIcons/leaderboard.png` | A small icon for the Leaderboard tab. We reuse the existing `home.png` for Feed; we'll add a placeholder Trophy-ish PNG or fall back to text-only. |

---

## Acceptance criteria (set at the start so the implementer can self-check)

- App opens to the **Feed** tab by default (preserves current behavior).
- A bottom tab bar with two tabs is visible.
- Tapping **Leaderboard** shows a ranked list of handles with their monthly note counts; the current user's row is visually distinguished (e.g. `backgroundSelected`).
- The leaderboard updates within ~2 s of a new note being posted by anyone — same realtime latency target as the feed.
- The "empty state" reads `No notes this month yet` when applicable.
- The current month is computed in the device's local timezone (not UTC) — a note posted at 11:55 PM local time on the 31st should count for that month, even if its UTC timestamp is in the next month.
- `pnpm exec tsc --noEmit` still shows only the 4 pre-existing errors.
- Bundle ID, signing, prebuild output — unchanged. No native deps added.

---

## Task 1: Leaderboard math (pure)

**Files:**
- Create: `src/lib/leaderboard.ts`

- [ ] **Step 1: Create the module**

  ```ts
  import type { Note } from './notes';

  export function startOfMonth(at: Date = new Date()): Date {
    return new Date(at.getFullYear(), at.getMonth(), 1, 0, 0, 0, 0);
  }

  export type LeaderboardRow = {
    handle: string;
    count: number;
    rank: number; // 1-indexed; ties share a rank (1, 2, 2, 4)
  };

  export function rankNotes(notes: Note[]): LeaderboardRow[] {
    const counts = new Map<string, number>();
    for (const n of notes) {
      const h = n.authorHandle || 'unknown';
      counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    const sorted = [...counts.entries()]
      .map(([handle, count]) => ({ handle, count }))
      .sort((a, b) => (b.count - a.count) || a.handle.localeCompare(b.handle));

    const rows: LeaderboardRow[] = [];
    let lastCount = -1;
    let lastRank = 0;
    sorted.forEach((row, i) => {
      const rank = row.count === lastCount ? lastRank : i + 1;
      lastCount = row.count;
      lastRank = rank;
      rows.push({ ...row, rank });
    });
    return rows;
  }
  ```

  Tie behavior is documented: equal counts share a rank; the next distinct count skips ahead (1, 2, 2, 4 not 1, 2, 2, 3). This is the "standard competition ranking" most leaderboards use.

- [ ] **Step 2: Sanity check** — read the file you just wrote. Verify the imports compile by running:

  ```
  pnpm exec tsc --noEmit
  ```

  Expected: 4 pre-existing errors, no new ones in `src/lib/leaderboard.ts`.

- [ ] **Step 3: Commit**

  ```
  git add src/lib/leaderboard.ts
  git commit -m "Add leaderboard ranking helpers"
  ```

---

## Task 2: Windowed notes subscription

**Files:**
- Modify: `src/lib/notes.ts`

- [ ] **Step 1: Read `src/lib/notes.ts`** so you understand the existing patterns (`notesQuery`, `subscribeToNotes`, `toNote`).

- [ ] **Step 2: Add a new exported function `subscribeToNotesSince` below `subscribeToNotes`**

  ```ts
  export function subscribeToNotesSince(
    since: Date,
    onChange: (notes: Note[]) => void,
    onError?: (err: Error) => void,
  ): () => void {
    return firestore()
      .collection('notes')
      .where('createdAt', '>=', firestore.Timestamp.fromDate(since))
      .orderBy('createdAt', 'desc')
      .limit(5000) // hackathon ceiling; revisit if we exceed this
      .onSnapshot(
        (qs) => onChange(qs.docs.map(toNote)),
        (err) => onError?.(err),
      );
  }
  ```

  Notes:
  - 5000 is a hard cap that's never going to be hit in this hackathon. If we ever do, the next move is a precomputed counter, not a higher limit.
  - The query needs a composite index: `notes` collection, fields `createdAt asc` AND `createdAt desc`. Firestore auto-suggests this on first use — the function logs a URL the human can click to create it.

- [ ] **Step 3: TypeScript check** — still 4 pre-existing errors; no new ones in `src/lib/notes.ts`.

- [ ] **Step 4: Commit**

  ```
  git add src/lib/notes.ts
  git commit -m "Add subscribeToNotesSince for windowed leaderboard queries"
  ```

---

## Task 3: `useLeaderboard` hook

**Files:**
- Create: `src/hooks/use-leaderboard.ts`

- [ ] **Step 1: Create the hook**

  ```ts
  import { useEffect, useMemo, useState } from 'react';

  import { useIdentity } from '@/hooks/use-identity';
  import { startOfMonth, rankNotes, type LeaderboardRow } from '@/lib/leaderboard';
  import { subscribeToNotesSince, type Note } from '@/lib/notes';

  type State =
    | { status: 'loading' }
    | { status: 'ready'; notes: Note[] }
    | { status: 'error'; error: string };

  export function useLeaderboard() {
    const [state, setState] = useState<State>({ status: 'loading' });
    const { state: idState } = useIdentity();

    useEffect(() => {
      const since = startOfMonth();
      const unsub = subscribeToNotesSince(
        since,
        (notes) => setState({ status: 'ready', notes }),
        (err) => setState({ status: 'error', error: err.message }),
      );
      return () => unsub();
    }, []);

    const rows: LeaderboardRow[] = useMemo(
      () => (state.status === 'ready' ? rankNotes(state.notes) : []),
      [state],
    );

    const currentHandle = idState.status === 'ready' ? idState.identity.handle : null;
    const currentRow = currentHandle
      ? rows.find((r) => r.handle === currentHandle) ?? null
      : null;

    return { status: state.status, rows, currentRow, error: state.status === 'error' ? state.error : null };
  }
  ```

  The hook intentionally re-aggregates on every notes change. With ≤ 5 000 notes this is sub-millisecond; no memo or persisted counter needed.

- [ ] **Step 2: TypeScript check** — no new errors.

- [ ] **Step 3: Commit**

  ```
  git add src/hooks/use-leaderboard.ts
  git commit -m "Add useLeaderboard hook"
  ```

---

## Task 4: Leaderboard screen

**Files:**
- Create: `src/app/(tabs)/leaderboard.tsx`

Note: this file lives under a route group `(tabs)/` that we'll create in Task 5. For now, create the directory and the file; Task 5 will add the `_layout.tsx` and move the existing index there.

- [ ] **Step 1: Create the directory and file**

  ```
  mkdir -p src/app/\(tabs\)
  ```

- [ ] **Step 2: Create `src/app/(tabs)/leaderboard.tsx`**

  ```tsx
  import { ScrollView, StyleSheet, View } from 'react-native';
  import { useSafeAreaInsets } from 'react-native-safe-area-context';

  import { DebugFab } from '@/components/debug-fab';
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
        <DebugFab />
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
  ```

- [ ] **Step 3: TypeScript check** — no new errors.

- [ ] **Step 4: Commit**

  ```
  git add 'src/app/(tabs)/leaderboard.tsx'
  git commit -m "Add leaderboard screen"
  ```

---

## Task 5: Tab navigator + route reorg

This is the trickiest task. We're moving the existing `src/app/index.tsx` into `src/app/(tabs)/index.tsx`, adding a `(tabs)/_layout.tsx` with `NativeTabs`, and updating the root `_layout.tsx` to use a `Stack` that delegates to the `(tabs)` group.

**Files:**
- Create: `src/app/(tabs)/_layout.tsx`
- Move: `src/app/index.tsx` → `src/app/(tabs)/index.tsx`
- Modify: `src/app/_layout.tsx` (no functional change; `Stack` already auto-mounts the `(tabs)` group)
- Verify: `src/app/onboarding.tsx` still exists at the root and is reachable via `<Redirect href="/onboarding" />`

- [ ] **Step 1: Move the existing feed screen into the tab group**

  ```
  git mv src/app/index.tsx 'src/app/(tabs)/index.tsx'
  ```

  Using `git mv` preserves history. After this, `src/app/(tabs)/` contains both `index.tsx` and `leaderboard.tsx`.

  **Important:** the moved `index.tsx` already has the correct imports for `@/components/debug-fab`, `@/hooks/use-identity`, `@/hooks/use-notes`, and the `<Redirect href="/onboarding" />` line. Those `@/` paths don't change. No edits to this file's contents are needed during the move.

- [ ] **Step 2: Create `src/app/(tabs)/_layout.tsx`**

  ```tsx
  import { NativeTabs } from 'expo-router/unstable-native-tabs';
  import React from 'react';
  import { useColorScheme } from 'react-native';

  import { Colors } from '@/constants/theme';

  export default function TabsLayout() {
    const scheme = useColorScheme();
    const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

    return (
      <NativeTabs
        backgroundColor={colors.background}
        indicatorColor={colors.backgroundElement}
        labelStyle={{ selected: { color: colors.text } }}>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>Feed</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="leaderboard">
          <NativeTabs.Trigger.Label>Leaderboard</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }
  ```

  No icons. Labels are sufficient for MVP. (We deleted the prior tab icon code; adding them back is a future polish task.)

- [ ] **Step 3: Verify `src/app/_layout.tsx` works as-is**

  Re-read `src/app/_layout.tsx`. It currently renders `<Stack screenOptions={{ headerShown: false }} />` underneath the identity overlay. Expo Router automatically picks up the `(tabs)/` group as the default route, so no changes to this file are required.

  If, during runtime verification, the tab bar fails to render, the most likely cause is the `Stack` being too restrictive about the `(tabs)` segment. The fix in that case is to explicitly declare the screen:

  ```tsx
  <Stack screenOptions={{ headerShown: false }}>
    <Stack.Screen name="(tabs)" />
    <Stack.Screen name="onboarding" />
  </Stack>
  ```

  Apply this only if needed. For now, leave `_layout.tsx` untouched.

- [ ] **Step 4: TypeScript check** — still 4 pre-existing errors. No new errors.

- [ ] **Step 5: Commit**

  ```
  git add 'src/app/(tabs)/_layout.tsx' 'src/app/(tabs)/index.tsx' src/app/index.tsx
  git commit -m "Group feed and leaderboard under (tabs) with bottom nav"
  ```

  `git add` of `src/app/index.tsx` stages the deletion (the path no longer exists, but git tracks the move via `git mv`).

---

## Task 6: Firestore composite index (one-time human step)

The new `subscribeToNotesSince` query (`where createdAt >= X` + `orderBy createdAt desc`) requires Firestore to have a composite index. Firestore auto-creates a URL in the error log on first use; click it to provision.

Alternative: declare the index up front in `firestore.indexes.json` and deploy:

- [ ] **Step 1: Create `firestore.indexes.json` at repo root**

  ```json
  {
    "indexes": [
      {
        "collectionGroup": "notes",
        "queryScope": "COLLECTION",
        "fields": [
          { "fieldPath": "createdAt", "order": "DESCENDING" }
        ]
      }
    ],
    "fieldOverrides": []
  }
  ```

  (A single-field index is what we actually need. Firestore creates these implicitly on the order direction we use. Declaring it here is belt-and-suspenders.)

- [ ] **Step 2: Reference it in `firebase.json`**

  Open `firebase.json` (created in Phase 3) and add the `indexes` property under `firestore`:

  ```json
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  }
  ```

- [ ] **Step 3: Deploy** (human step)

  ```
  pnpm dlx firebase-tools deploy --only firestore:indexes
  ```

  Or paste the JSON into Firebase Console → Firestore → Indexes tab.

- [ ] **Step 4: Commit**

  ```
  git add firestore.indexes.json firebase.json
  git commit -m "Declare firestore indexes for leaderboard window query"
  ```

---

## Phase 4 acceptance checklist

Once committed and the dev build is running:

- [ ] Bottom tab bar shows Feed and Leaderboard.
- [ ] Tapping Leaderboard shows ranked rows. With no notes yet, shows "No notes this month yet."
- [ ] Post a test note via the Debug FAB. Within ~2s, the leaderboard updates (your handle gains a count or appears in the list).
- [ ] Your row is visually distinguished (`backgroundSelected`).
- [ ] Force-quit, reopen, tap Leaderboard — same counts.
- [ ] `pnpm exec tsc --noEmit` reports the baseline 4 pre-existing errors only.

When all check, Phase 4 is done.

---

## Out of scope for Phase 4 (deferred)

- Server-maintained per-user counter doc (`users/{uid}.monthlyNotes`). Only needed if monthly volume exceeds ~10k notes.
- Daily / shift / all-time windows in the same view.
- Streaks, badges, achievements.
- AI-scored "impact" rating per note (would require pulling Phase 3's webhook response back).
- Reactions / kudos from peers (would require re-introducing client write paths).
- Avatars / per-user profile pages.
- Tab icons (we deleted the originals; ship labels-only for MVP).
- A "shift recap" digest delivered as a notification at end-of-shift.
