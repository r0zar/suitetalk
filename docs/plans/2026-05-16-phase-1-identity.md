# Phase 1: Identity — Implementation Plan

> **Spec reference:** [`docs/mvp-spec.md`](../mvp-spec.md), §8 "Identity flow" and §6 "Data model".
>
> **Process note:** This plan favors verifiable runtime checkpoints over TDD for UI/native/Firebase wiring (no clean unit-test seam without heavy mocking). Pure functions (handle generator) are tested. Each task ends in a commit.

**Goal:** First launch creates a stable anonymous Firebase identity for the device, generates a human-readable handle, persists it to Firestore + AsyncStorage, and shows a one-time "you're <handle> — keep / rename" prompt. Subsequent launches restore the same identity silently.

**Architecture:** Firebase Anonymous Auth gives us a persistent per-device UID without a login flow. A local handle generator produces friendly names from word lists. AsyncStorage caches the {uid, handle} pair for instant render on cold start; Firestore is the source of truth. A tiny onboarding screen prompts on first launch only.

**Tech stack:** Firebase JS SDK v10 (modular), `@react-native-async-storage/async-storage`, Expo Router, existing themed components.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/firebase.ts` | Initialize Firebase app + export `auth`, `db` singletons. One source of truth for Firebase. |
| `src/lib/identity.ts` | Public API: `getIdentity()`, `renameHandle()`. Owns auth-anonymous flow, Firestore user doc r/w, AsyncStorage cache. |
| `src/lib/handle-generator.ts` | Pure function: `generateHandle()` → `"swift-otter"`. Adjective + animal word lists. Testable. |
| `src/lib/__tests__/handle-generator.test.ts` | Jest tests for the generator. |
| `src/hooks/use-identity.ts` | React hook wrapping `getIdentity` + `renameHandle`. Subscribes to identity state. |
| `src/app/_layout.tsx` | Modify to bootstrap identity at app start (block UI until first identity load resolves). |
| `src/app/onboarding.tsx` | One-time prompt screen: "You're <handle>. Keep / Rename." Navigates back to `/` on confirm. |
| `src/app/index.tsx` | Modify to show handle in header; route to `/onboarding` on first launch. |
| `.env.local` | Firebase web config (gitignored). |
| `app.json` | Add Firebase web config env vars are not needed — using public web config inline via env. |
| `package.json` | Add `firebase`, `@react-native-async-storage/async-storage`. Add `jest`, `@types/jest`, `ts-jest` if not present. |

---

## Prerequisites (run before Task 1)

You must do these by hand — they require web consoles I can't drive.

- [ ] **Create Firebase project**
  1. Go to <https://console.firebase.google.com>, click **Add project**, name it `suitetalk` (or your choice).
  2. Disable Google Analytics for now (you can re-enable later).
  3. In the new project: **Build → Authentication → Get started → Sign-in method → Anonymous → Enable**.
  4. **Build → Firestore Database → Create database → Start in test mode → choose region (us-central1 is fine)**.
- [ ] **Get the web app config**
  1. Project settings (gear icon) → **Your apps** → **Web** (`</>`) → **Register app** (nickname: `suitetalk-web`).
  2. Copy the `firebaseConfig` object values. You'll paste them into `.env.local` in Task 1, Step 2.
- [ ] **Verify Expo dev server still works**

  ```bash
  pnpm expo start --clear
  ```

  Open in Expo Go on the iPhone; confirm the chat screen still loads. Cancel after verifying.

---

## Task 1: Install dependencies and add Firebase config

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `.env.local`

- [ ] **Step 1: Install Firebase + AsyncStorage with Expo-pinned versions**

  ```bash
  pnpm expo install firebase @react-native-async-storage/async-storage
  ```

  Expected: both packages added, no peer warnings beyond the existing `@ai-sdk/react` one.

- [ ] **Step 2: Create `.env.local` with Firebase web config**

  Use the values you copied in Prerequisites. The `EXPO_PUBLIC_` prefix makes them available at runtime; this is fine because Firebase web config is not a secret (security is enforced by Firestore rules + auth).

  ```bash
  cat >> .env.local <<'EOF'

  # Firebase web config (public; security enforced by Firestore rules)
  EXPO_PUBLIC_FIREBASE_API_KEY=...
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
  EXPO_PUBLIC_FIREBASE_PROJECT_ID=...
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=...
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
  EXPO_PUBLIC_FIREBASE_APP_ID=...
  EOF
  ```

  Open `.env.local` in your editor and replace the `...` with the real values from the Firebase console.

- [ ] **Step 3: Verify `.env.local` is gitignored**

  ```bash
  git check-ignore -v .env.local
  ```

  Expected output mentions `.gitignore:N:.env*.local`. If not, stop and fix `.gitignore` before proceeding.

- [ ] **Step 4: Commit**

  ```bash
  git add package.json pnpm-lock.yaml
  git commit -m "Install firebase and async-storage for identity"
  ```

  Note: `.env.local` is intentionally not committed.

---

## Task 2: Firebase singleton module

**Files:**
- Create: `src/lib/firebase.ts`

- [ ] **Step 1: Create `src/lib/firebase.ts`**

  ⚠️ **Important:** In React Native, you MUST use `initializeAuth` with `getReactNativePersistence(AsyncStorage)`. Using the default `getAuth(app)` keeps auth state in memory only and the user gets a **new anonymous UID on every cold start** — which silently breaks identity persistence. Reference: <https://firebase.google.com/docs/auth/web/start#initialize-authentication>.

  ```ts
  import AsyncStorage from '@react-native-async-storage/async-storage';
  import { getApp, getApps, initializeApp } from 'firebase/app';
  import { getReactNativePersistence, initializeAuth } from 'firebase/auth';
  import { getFirestore } from 'firebase/firestore';

  const config = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  };

  for (const [k, v] of Object.entries(config)) {
    if (!v) throw new Error(`Missing Firebase env var for ${k}`);
  }

  export const app = getApps().length ? getApp() : initializeApp(config);

  // initializeAuth must run exactly once per app. On Fast Refresh in dev, the
  // module re-evaluates; guard against re-init by checking getApps() length.
  // If you see "Firebase: Auth already initialized" in dev, this guard isn't
  // working — restart Metro with --clear.
  export const auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });

  export const db = getFirestore(app);
  ```

  **Note on TS types:** `getReactNativePersistence` is exported from `firebase/auth` at runtime but in some firebase-js-sdk versions the type is not declared. If TypeScript complains with "no exported member `getReactNativePersistence`", import it as:
  ```ts
  // @ts-expect-error - getReactNativePersistence is missing from firebase/auth types in some versions
  import { getReactNativePersistence } from 'firebase/auth';
  ```

- [ ] **Step 2: Verify the module loads at runtime**

  Open `src/app/index.tsx` temporarily and add at the top:

  ```ts
  import { app } from '@/lib/firebase';
  console.log('FIREBASE_APP_NAME', app.name);
  ```

  Run `pnpm expo start --clear`, open in Expo Go. Expected: Metro logs `FIREBASE_APP_NAME [DEFAULT]`. If you get "Missing Firebase env var for …", the `.env.local` value for that key is blank.

  **Revert the temporary lines** before committing.

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/firebase.ts
  git commit -m "Add firebase singleton module"
  ```

---

## Task 3: Handle generator (pure, tested)

**Files:**
- Create: `src/lib/handle-generator.ts`
- Create: `src/lib/__tests__/handle-generator.test.ts`
- Modify: `package.json` (add jest + ts-jest if absent)

- [ ] **Step 1: Check whether Jest is already configured**

  ```bash
  cat package.json | grep -E 'jest|test'
  ```

  If there's no `"test"` script or `"jest"` config, run:

  ```bash
  pnpm add -D jest @types/jest ts-jest
  ```

  Then add to `package.json`:

  ```json
  "scripts": {
    "test": "jest"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "testMatch": ["**/__tests__/**/*.test.ts"]
  }
  ```

- [ ] **Step 2: Write the failing test**

  Create `src/lib/__tests__/handle-generator.test.ts`:

  ```ts
  import { generateHandle } from '../handle-generator';

  describe('generateHandle', () => {
    it('returns adjective-animal format', () => {
      const handle = generateHandle();
      expect(handle).toMatch(/^[a-z]+-[a-z]+$/);
    });

    it('produces different values across calls (probabilistic)', () => {
      const handles = new Set(Array.from({ length: 20 }, () => generateHandle()));
      expect(handles.size).toBeGreaterThan(1);
    });

    it('accepts a deterministic seed', () => {
      expect(generateHandle(0)).toBe(generateHandle(0));
    });
  });
  ```

- [ ] **Step 3: Run test, confirm it fails**

  ```bash
  pnpm test src/lib/__tests__/handle-generator.test.ts
  ```

  Expected: fails with `Cannot find module '../handle-generator'`.

- [ ] **Step 4: Implement the generator**

  Create `src/lib/handle-generator.ts`:

  ```ts
  const ADJECTIVES = [
    'swift', 'bold', 'wry', 'brave', 'calm', 'eager', 'fierce', 'gentle',
    'happy', 'jolly', 'kind', 'lively', 'merry', 'nimble', 'plucky', 'quick',
    'silent', 'tidy', 'witty', 'zesty',
  ];

  const ANIMALS = [
    'otter', 'fox', 'heron', 'lynx', 'sparrow', 'whale', 'badger', 'crane',
    'deer', 'eagle', 'falcon', 'hare', 'ibis', 'jay', 'koala', 'lemur',
    'marmot', 'newt', 'owl', 'puffin',
  ];

  export function generateHandle(seed?: number): string {
    const pick = (arr: readonly string[], offset: number) => {
      if (seed !== undefined) return arr[(seed + offset) % arr.length];
      return arr[Math.floor(Math.random() * arr.length)];
    };
    return `${pick(ADJECTIVES, 0)}-${pick(ANIMALS, 1)}`;
  }
  ```

- [ ] **Step 5: Run tests, confirm pass**

  ```bash
  pnpm test src/lib/__tests__/handle-generator.test.ts
  ```

  Expected: 3 passing.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/handle-generator.ts src/lib/__tests__/handle-generator.test.ts package.json pnpm-lock.yaml
  git commit -m "Add handle generator with adjective-animal format"
  ```

---

## Task 4: Identity service (`src/lib/identity.ts`)

**Files:**
- Create: `src/lib/identity.ts`

This module owns the persistence flow. Not unit-tested — it integrates Firebase + AsyncStorage. We'll verify it at runtime in Task 6.

- [ ] **Step 1: Create the module**

  ```ts
  import AsyncStorage from '@react-native-async-storage/async-storage';
  import { signInAnonymously } from 'firebase/auth';
  import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firestore';
  import { auth, db } from './firebase';
  import { generateHandle } from './handle-generator';

  // NOTE: replace the stub import line above with:
  // import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

  const CACHE_KEY = 'suitetalk.identity.v1';

  export type Identity = {
    uid: string;
    handle: string;
    isFresh: boolean; // true if this is the first-ever launch on this device
  };

  async function readCache(): Promise<Identity | null> {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Identity;
    } catch {
      return null;
    }
  }

  async function writeCache(id: Identity): Promise<void> {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(id));
  }

  export async function getIdentity(): Promise<Identity> {
    const cached = await readCache();

    const cred = await signInAnonymously(auth);
    const uid = cred.user.uid;

    if (cached && cached.uid === uid) {
      return { ...cached, isFresh: false };
    }

    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      const handle = (snap.data().handle as string) ?? generateHandle();
      const id: Identity = { uid, handle, isFresh: false };
      await writeCache(id);
      return id;
    }

    const handle = generateHandle();
    await setDoc(userRef, { handle, createdAt: serverTimestamp() });
    const id: Identity = { uid, handle, isFresh: true };
    await writeCache(id);
    return id;
  }

  export async function renameHandle(uid: string, handle: string): Promise<void> {
    const trimmed = handle.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,32}$/.test(trimmed)) {
      throw new Error('Handle must be 2–32 lowercase letters, digits, or hyphens.');
    }
    await updateDoc(doc(db, 'users', uid), { handle: trimmed });
    const cached = await readCache();
    if (cached?.uid === uid) await writeCache({ ...cached, handle: trimmed });
  }
  ```

  Fix the import line as noted in the comment (it's a deliberate trap to make sure you're reading, not just pasting).

- [ ] **Step 2: TypeScript check**

  ```bash
  pnpm exec tsc --noEmit
  ```

  Expected: no errors in `src/lib/identity.ts`. (You may have pre-existing errors in other files; ignore those for now.)

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/identity.ts
  git commit -m "Add identity service with anonymous auth and firestore user doc"
  ```

---

## Task 5: `useIdentity` hook

**Files:**
- Create: `src/hooks/use-identity.ts`

- [ ] **Step 1: Create the hook**

  ```ts
  import { useEffect, useState } from 'react';
  import { getIdentity, renameHandle as renameHandleSvc, type Identity } from '@/lib/identity';

  type State =
    | { status: 'loading' }
    | { status: 'ready'; identity: Identity }
    | { status: 'error'; error: string };

  export function useIdentity() {
    const [state, setState] = useState<State>({ status: 'loading' });

    useEffect(() => {
      let cancelled = false;
      getIdentity()
        .then((identity) => {
          if (!cancelled) setState({ status: 'ready', identity });
        })
        .catch((err: unknown) => {
          if (!cancelled)
            setState({
              status: 'error',
              error: err instanceof Error ? err.message : String(err),
            });
        });
      return () => {
        cancelled = true;
      };
    }, []);

    const rename = async (next: string) => {
      if (state.status !== 'ready') return;
      await renameHandleSvc(state.identity.uid, next);
      setState({
        status: 'ready',
        identity: { ...state.identity, handle: next.trim().toLowerCase(), isFresh: false },
      });
    };

    return { state, rename };
  }
  ```

- [ ] **Step 2: TypeScript check**

  ```bash
  pnpm exec tsc --noEmit
  ```

  Expected: no errors in this file.

- [ ] **Step 3: Commit**

  ```bash
  git add src/hooks/use-identity.ts
  git commit -m "Add useIdentity hook"
  ```

---

## Task 6: Wire identity bootstrap into the app + show handle in header

**Files:**
- Modify: `src/app/_layout.tsx`
- Modify: `src/app/index.tsx`

- [ ] **Step 1: Bootstrap identity in `_layout.tsx`**

  Keep the `<Stack />` mounted at all times so deep-link state and route history aren't blown away during transient identity reloads. Render the loading / error UI as an **overlay** instead of replacing the navigator.

  Replace the contents of `src/app/_layout.tsx` with:

  ```tsx
  import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
  import { Stack } from 'expo-router';
  import React from 'react';
  import { ActivityIndicator, StyleSheet, useColorScheme, View } from 'react-native';

  import { ThemedText } from '@/components/themed-text';
  import { ThemedView } from '@/components/themed-view';
  import { useIdentity } from '@/hooks/use-identity';

  export default function RootLayout() {
    const colorScheme = useColorScheme();
    const { state } = useIdentity();

    return (
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <View style={styles.root}>
          <Stack screenOptions={{ headerShown: false }} />
          {state.status === 'loading' ? (
            <ThemedView style={styles.overlay}>
              <ActivityIndicator />
            </ThemedView>
          ) : null}
          {state.status === 'error' ? (
            <ThemedView style={styles.overlay}>
              <ThemedText type="subtitle">Couldn't sign in</ThemedText>
              <ThemedText themeColor="textSecondary">{state.error}</ThemedText>
            </ThemedView>
          ) : null}
        </View>
      </ThemeProvider>
    );
  }

  const styles = StyleSheet.create({
    root: { flex: 1 },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      padding: 24,
    },
  });
  ```

- [ ] **Step 2: Show the handle on the chat screen**

  In `src/app/index.tsx`, import the hook and add a header row. At the top of the imports:

  ```tsx
  import { useIdentity } from '@/hooks/use-identity';
  ```

  Inside `ChatScreen()`, before `const { messages, error, sendMessage }` add:

  ```tsx
  const { state: idState } = useIdentity();
  const handle = idState.status === 'ready' ? idState.identity.handle : '...';
  ```

  Then inside the `container` `<ThemedView>`, immediately before the existing `error` check, add:

  ```tsx
  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two }}>
    <ThemedText type="smallBold" themeColor="textSecondary">YOU ARE</ThemedText>
    <ThemedText type="smallBold">{handle}</ThemedText>
  </View>
  ```

  Make sure `View` is imported from `react-native` (it should already be).

- [ ] **Step 3: Runtime verification (the big one)**

  Add one temporary log line at the top of `getIdentity()` in `src/lib/identity.ts` so you can confirm UID stability:

  ```ts
  console.log('IDENTITY uid before signIn:', auth.currentUser?.uid ?? '(none)');
  ```

  Then:

  1. Run `pnpm expo start --clear`.
  2. Open in Expo Go on the iPhone. Note the UID printed in the Metro console after the first sign-in (find it in the `cred.user.uid` value or add a second log to print it).
  3. Expected: a brief spinner overlay, then the chat screen renders with `YOU ARE <handle>` at the top.
  4. In the Firebase console → **Firestore** → exactly one new doc under `users/` keyed by that UID, with `handle` and `createdAt` fields.
  5. Force-quit Expo Go and reopen. Expected:
     - Same handle appears.
     - Metro console shows the same UID in the `IDENTITY uid before signIn` log on the second launch (this confirms `initializeAuth` + RN persistence is working). If the log shows `(none)` again, persistence is broken — revisit Task 2.
     - **No new `users/` doc is created in Firestore.** Refresh the Firestore console to confirm only one doc exists.

  Remove the temporary `console.log` once verification passes.

  Common failures:
  - Spinner forever → Firebase config wrong; check Metro console for the env-var error.
  - "Couldn't sign in" → Anonymous sign-in not enabled in the Firebase console.
  - Different handle / new UID after reopening → `initializeAuth` persistence isn't taking effect. Most likely cause: imported `getAuth` somewhere else, or `getReactNativePersistence` import isn't resolving. Check `src/lib/firebase.ts` carefully.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/_layout.tsx src/app/index.tsx
  git commit -m "Bootstrap identity at app start and show handle in chat header"
  ```

---

## Task 7: Onboarding screen for first launch

**Files:**
- Create: `src/app/onboarding.tsx`
- Modify: `src/app/index.tsx` (route to onboarding when `isFresh`)

**Preflight check:** This screen uses `ThemedView type="backgroundElement"` and `type="backgroundSelected"`. Both must already exist as keys in `Colors.light` / `Colors.dark` in `src/constants/theme.ts` (the `ThemeColor` union is derived from them). Verify with `grep -E "backgroundElement|backgroundSelected" src/constants/theme.ts` — you should see both names. If either is missing, stop and ask.

- [ ] **Step 1: Create the onboarding screen**

  ```tsx
  // src/app/onboarding.tsx
  import { useRouter } from 'expo-router';
  import { useState } from 'react';
  import { Pressable, StyleSheet, TextInput, View } from 'react-native';
  import { useSafeAreaInsets } from 'react-native-safe-area-context';

  import { ThemedText } from '@/components/themed-text';
  import { ThemedView } from '@/components/themed-view';
  import { Spacing } from '@/constants/theme';
  import { useTheme } from '@/hooks/use-theme';
  import { useIdentity } from '@/hooks/use-identity';

  export default function OnboardingScreen() {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { state, rename } = useIdentity();

    const initial = state.status === 'ready' ? state.identity.handle : '';
    const [value, setValue] = useState(initial);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    if (state.status !== 'ready') return <ThemedView style={{ flex: 1 }} />;

    const confirm = async (next: string) => {
      setError(null);
      setBusy(true);
      try {
        if (next !== state.identity.handle) await rename(next);
        router.replace('/');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    };

    return (
      <ThemedView style={[styles.root, { paddingTop: insets.top + Spacing.six, paddingBottom: insets.bottom + Spacing.four }]}>
        <View style={styles.body}>
          <ThemedText type="subtitle">Welcome to SuiteTalk</ThemedText>
          <ThemedText themeColor="textSecondary">
            We've picked a handle for you. Keep it, or change it now. (You can rename later.)
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.inputWrap}>
            <TextInput
              style={[styles.input, { color: theme.text }]}
              value={value}
              onChangeText={setValue}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </ThemedView>
          {error ? <ThemedText themeColor="textSecondary">{error}</ThemedText> : null}

          <Pressable disabled={busy} onPress={() => confirm(value)}>
            <ThemedView type="backgroundSelected" style={styles.button}>
              <ThemedText type="smallBold">{busy ? 'Saving…' : 'Continue'}</ThemedText>
            </ThemedView>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  const styles = StyleSheet.create({
    root: { flex: 1, paddingHorizontal: Spacing.four },
    body: { gap: Spacing.three },
    inputWrap: { borderRadius: Spacing.three, paddingHorizontal: Spacing.three },
    input: { fontSize: 16, paddingVertical: Spacing.three },
    button: {
      paddingVertical: Spacing.two,
      paddingHorizontal: Spacing.four,
      borderRadius: Spacing.three,
      alignSelf: 'flex-start',
    },
  });
  ```

- [ ] **Step 2: Route to onboarding when `isFresh`**

  In `src/app/index.tsx`, add at the top of the imports:

  ```tsx
  import { Redirect } from 'expo-router';
  ```

  Inside `ChatScreen()`, immediately after the `const { state: idState }` line, add:

  ```tsx
  if (idState.status === 'ready' && idState.identity.isFresh) {
    return <Redirect href="/onboarding" />;
  }
  ```

- [ ] **Step 3: Runtime verification**

  1. **Reset the identity** so this device looks fresh: in Expo Go, shake the phone → "Reload" isn't enough (it preserves storage). Easiest reset: in the iOS Settings app, delete Expo Go and reinstall, OR add a one-time debug button to clear AsyncStorage (skip for now if you don't want to).

     Alternative: temporarily clear the cache by adding `await AsyncStorage.removeItem('suitetalk.identity.v1')` at the top of `getIdentity` for one run, then remove it.

     Also delete the existing `users/{uid}` doc in the Firebase console so the server-side path goes through `setDoc`.

  2. Open the app. Expected: onboarding screen appears with the generated handle pre-filled.
  3. Edit the value to e.g. `test-name-1`. Press Continue. Expected: redirected to the chat screen; header reads `YOU ARE test-name-1`.
  4. Firestore console: `users/{uid}.handle === "test-name-1"`.
  5. Force-quit and reopen. Expected: chat screen loads directly (no onboarding), header reads `test-name-1`.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/onboarding.tsx src/app/index.tsx
  git commit -m "Add onboarding screen for fresh installs"
  ```

---

## Task 8: Firestore security rules (minimal but safe)

**Files:**
- Create: `firestore.rules`

Test-mode rules in Firebase expire after 30 days and allow anyone to read/write everything. Replace them with rules that match our actual model.

- [ ] **Step 1: Create `firestore.rules` at the repo root**

  ```
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      // Users may read any handle (needed for displaying authors), and only
      // write their own user doc.
      match /users/{uid} {
        allow read: if request.auth != null;
        allow create, update: if request.auth != null && request.auth.uid == uid;
      }

      // Notes: any authenticated user can read; writes are added later in
      // Phase 2 (server writes them; clients only read for MVP).
      match /notes/{noteId} {
        allow read: if request.auth != null;
        allow write: if false; // tightened in Phase 2
      }
    }
  }
  ```

- [ ] **Step 2: Publish the rules**

  Two ways. Pick one:

  - **Via console (easier):** Firebase Console → **Firestore Database → Rules** tab → paste the file contents → **Publish**.
  - **Via CLI:** install `firebase-tools` (`pnpm dlx firebase-tools` once), run `firebase login`, `firebase use --add` (pick your project), then `firebase deploy --only firestore:rules`.

- [ ] **Step 3: Verify rules don't break the app**

  Reload the app in Expo Go. Expected: handle still renders. Try renaming from the onboarding screen (force a fresh install or clear cache as in Task 7, Step 3). Expected: success.

  If renaming fails with "Missing or insufficient permissions", double-check the rules were published and the `users/{uid}` match path is correct.

- [ ] **Step 4: Commit**

  ```bash
  git add firestore.rules
  git commit -m "Add minimal firestore security rules for identity"
  ```

---

## Task 9: Optional rename-from-chat affordance

Skip this task if you're tight on time — onboarding already handles initial rename.

**Files:**
- Modify: `src/app/index.tsx`

- [ ] **Step 1: Make the handle line tappable, route to `/onboarding`**

  Wrap the `YOU ARE <handle>` block in a `Pressable` that navigates to `/onboarding`. Onboarding works for rename-after-the-fact too because `useIdentity` always returns the latest handle.

- [ ] **Step 2: Verify**

  Tap the handle in the chat header. Expected: onboarding screen appears with the current handle pre-filled. Change it, press Continue, land back on chat with the new handle visible.

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/index.tsx
  git commit -m "Allow handle rename from chat header"
  ```

---

## Phase 1 acceptance checklist

Before moving to Phase 2 (Feed), verify all of:

- [ ] First launch on a clean install shows the onboarding screen with a generated handle.
- [ ] After Continue, the handle appears in the chat header.
- [ ] A `users/{uid}` doc exists in Firestore with `handle` and `createdAt`.
- [ ] Force-quitting and relaunching skips onboarding and shows the same handle.
- [ ] Renaming (via onboarding or chat header) updates both Firestore and the UI.
- [ ] Firestore rules are published; an unauthenticated request from a browser to read `users/` fails.
- [ ] `pnpm test` passes (handle-generator tests).
- [ ] `pnpm exec tsc --noEmit` shows no new errors in identity-related files.
- [ ] No secrets in committed files (`.env.local` still gitignored).

When all checks pass, you're ready to write the Phase 2 plan (Feed: Firestore subscription + render notes).

---

## Out of scope for Phase 1 (deferred)

- Note writes — Phase 2.
- Webhook fan-out — Phase 3.
- Leaderboard — Phase 4.
- Handle uniqueness server-side enforcement — defer until users collide in practice.
- Account recovery if AsyncStorage clears (user gets a new identity) — acceptable for MVP.
