// Web stub. The native firebase.ts re-exports @react-native-firebase auth and
// firestore handles. On web there's no equivalent (those packages are
// iOS/Android-only), so these are throwing stubs. They should never be reached
// because identity.web.ts and notes.web.ts replace the consumers; this exists
// only so Metro doesn't try to bundle the native package on web.

function unsupported(): never {
  throw new Error('firebase is unsupported on web in this build');
}

export const auth = unsupported as unknown as () => never;
export const firestore = unsupported as unknown as () => never;
