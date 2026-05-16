// React Native Firebase auto-initializes via the GoogleService-Info.plist /
// google-services.json files at native build time, so we don't pass a config
// object here. The modular API is imported lazily by consumers from
// @react-native-firebase/auth and @react-native-firebase/firestore.
//
// This module exists so the rest of the app has a single source of truth for
// auth + firestore handles, mirroring the JS-SDK layout.
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';

export { auth, firestore };
