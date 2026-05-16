import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { fetch as expoFetch } from 'expo/fetch';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DebugFab } from '@/components/debug-fab';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useIdentity } from '@/hooks/use-identity';
import { useTheme } from '@/hooks/use-theme';
import { generateAPIUrl } from '@/utils';

export default function ChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState('');

  const { state: idState } = useIdentity();
  if (idState.status === 'ready' && idState.identity.isFresh) {
    return <Redirect href="/onboarding" />;
  }
  const handle = idState.status === 'ready' ? idState.identity.handle : '...';

  const { messages, error, sendMessage } = useChat({
    transport: new DefaultChatTransport({
      fetch: expoFetch as unknown as typeof globalThis.fetch,
      api: generateAPIUrl('/api/chat'),
    }),
    onError: (err) => console.error(err, 'ERROR'),
  });

  return (
    <ThemedView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
        keyboardVerticalOffset={insets.top}>
        <ThemedView
          style={[
            styles.container,
            { paddingTop: insets.top + Spacing.three, paddingBottom: insets.bottom + Spacing.three },
          ]}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two }}>
            <ThemedText type="smallBold" themeColor="textSecondary">YOU ARE</ThemedText>
            <ThemedText type="smallBold">{handle}</ThemedText>
          </View>
          {error ? (
            <ThemedText themeColor="textSecondary">{error.message}</ThemedText>
          ) : null}

          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled">
            {messages.length === 0 ? (
              <ThemedView style={styles.emptyState}>
                <ThemedText type="subtitle">Chat</ThemedText>
                <ThemedText themeColor="textSecondary">Say something to get started.</ThemedText>
              </ThemedView>
            ) : (
              messages.map((m) => (
                <ThemedView
                  key={m.id}
                  type="backgroundElement"
                  style={styles.messageBubble}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    {m.role}
                  </ThemedText>
                  {m.parts.map((part, i) => {
                    switch (part.type) {
                      case 'text':
                        return <ThemedText key={`${m.id}-${i}`}>{part.text}</ThemedText>;
                      case 'tool-weather':
                        return (
                          <ThemedText key={`${m.id}-${i}`} type="code">
                            {JSON.stringify(part, null, 2)}
                          </ThemedText>
                        );
                      default:
                        return null;
                    }
                  })}
                </ThemedView>
              ))
            )}
          </ScrollView>

          <ThemedView type="backgroundElement" style={styles.inputWrapper}>
            <TextInput
              style={[styles.input, { color: theme.text }]}
              placeholder="Say something..."
              placeholderTextColor={theme.textSecondary}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={(e) => {
                e.preventDefault();
                if (!input.trim()) return;
                sendMessage({ text: input });
                setInput('');
              }}
              returnKeyType="send"
            />
          </ThemedView>
        </ThemedView>
      </KeyboardAvoidingView>
      <DebugFab />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  scrollContent: {
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  messageBubble: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  inputWrapper: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  input: {
    fontSize: 16,
    paddingVertical: Spacing.three,
  },
});
