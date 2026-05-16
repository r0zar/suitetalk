import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const theme = useTheme();
  const isWeb = Platform.OS === 'web';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.text,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.background,
          borderTopColor: theme.backgroundElement,
        },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Feed' }} />
      <Tabs.Screen name="leaderboard" options={{ title: 'Leaderboard' }} />
      <Tabs.Screen
        name="debug"
        options={{
          title: 'Debug',
          // Web-only: hide the Debug tab on iOS/Android by setting href: null,
          // which skips the trigger entirely (the route still exists but isn't
          // surfaced in the tab bar).
          href: isWeb ? '/debug' : null,
        }}
      />
    </Tabs>
  );
}
