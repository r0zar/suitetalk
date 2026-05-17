// Dynamic Expo config. Used in place of app.json so we can resolve the
// GoogleService-Info.plist path from an env var on EAS builders (where the file
// secret is materialized to a tmp path) while still using the local copy in
// development.

module.exports = () => ({
  expo: {
    name: 'suitetalk',
    slug: 'suitetalk',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'suitetalk',
    userInterfaceStyle: 'automatic',
    ios: {
      icon: './assets/expo.icon',
      bundleIdentifier: 'com.suitetalk.app',
      googleServicesFile:
        process.env.GOOGLE_SERVICES_INFO_PLIST ?? './GoogleService-Info.plist',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#208AEF',
          android: {
            image: './assets/images/splash-icon.png',
            imageWidth: 76,
          },
        },
      ],
      'expo-font',
      'expo-web-browser',
      '@react-native-firebase/app',
      '@react-native-firebase/auth',
      [
        'expo-build-properties',
        {
          ios: {
            useFrameworks: 'static',
            // Work around RNFirebase v24 + Expo SDK 54 build break: when
            // useFrameworks: static is set, RNFB iOS targets need
            // non-modular React headers allowed AND a few Firebase pods need
            // explicit modular_headers configuration to avoid duplicate
            // interface errors. See
            // https://github.com/invertase/react-native-firebase/issues/8657
            extraPods: [
              { name: 'FirebaseFirestoreInternal', modular_headers: true },
              { name: 'FirebaseCore', modular_headers: true },
              { name: 'FirebaseCoreExtension', modular_headers: true },
              { name: 'FirebaseAppCheckInterop', modular_headers: true },
              { name: 'FirebaseAuthInterop', modular_headers: true },
              { name: 'FirebaseCoreInternal', modular_headers: true },
              { name: 'GoogleUtilities', modular_headers: true },
              { name: 'RecaptchaInterop', modular_headers: true },
            ],
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: '114c69ae-faed-4208-b996-a7835c6af30e',
      },
    },
    owner: 'rozar',
  },
});
