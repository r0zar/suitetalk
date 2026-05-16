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
