/*
 * LOCKED (MESSAGES CHAT SCREEN)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ChatScreenInner, { ChatSource } from '@/components/screens/ChatScreenInner';
import { AppErrorBoundary } from '@/components/safety';
import { COLORS } from '@/lib/constants';

function normalizeConversationId(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  if (!normalized || normalized === 'undefined' || normalized === 'null') {
    return null;
  }

  return normalized;
}

function normalizeChatSource(value: string | string[] | undefined): ChatSource {
  if (typeof value !== 'string') return 'messages';

  switch (value) {
    case 'messages':
    case 'discover':
    case 'confession':
    case 'notification':
    case 'match':
      return value;
    default:
      return 'messages';
  }
}

/** Chat route nested inside the Messages tab — keeps the tab bar active.
 *  Defaults to source='messages' when accessed from the Messages list,
 *  but accepts source param for notifications, match celebration, etc. */
export default function MessagesTabChatScreen() {
  const router = useRouter();
  const { conversationId, source } = useLocalSearchParams<{
    conversationId?: string | string[];
    source?: string | string[];
  }>();
  const safeConversationId = normalizeConversationId(conversationId);
  const chatSource = normalizeChatSource(source);

  return (
    <AppErrorBoundary name="MessagesTabChat">
      {safeConversationId ? (
        <ChatScreenInner conversationId={safeConversationId} source={chatSource} />
      ) : (
        <View style={styles.container}>
          <Ionicons name="chatbubble-ellipses-outline" size={44} color={COLORS.textLight} />
          <Text style={styles.title}>Unable to open this conversation.</Text>
          <Text style={styles.subtitle}>
            This link is missing a valid conversation ID.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace('/(main)/(tabs)/messages')}
          >
            <Text style={styles.buttonText}>Go back</Text>
          </TouchableOpacity>
        </View>
      )}
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: COLORS.background,
  },
  title: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  button: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
});
