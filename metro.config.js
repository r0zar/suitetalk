// Metro config — disables the strict "exports" field resolution that conflicts
// with Firebase JS SDK v10's React Native conditional export. Without this,
// Metro picks the wrong @firebase/auth bundle and you get "Component auth has
// not been registered yet" at runtime.
//
// Reference: https://github.com/firebase/firebase-js-sdk/issues/7878

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push('cjs');
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
