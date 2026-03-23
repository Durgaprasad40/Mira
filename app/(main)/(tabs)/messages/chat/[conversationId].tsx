/*
 * LOCKED (MESSAGES CHAT SCREEN)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - No logic/UI changes allowed
 */
import { useLocalSearchParams } from 'expo-router';
import ChatScreenInner, { ChatSource } from '@/components/screens/ChatScreenInner';
import { AppErrorBoundary } from '@/components/safety';

/** Chat route nested inside the Messages tab — keeps the tab bar active.
 *  Defaults to source='messages' when accessed from the Messages list,
 *  but accepts source param for notifications, match celebration, etc. */
export default function MessagesTabChatScreen() {
  const { conversationId, source } = useLocalSearchParams<{ conversationId: string; source?: string }>();
  // Default to 'messages' if no source is provided (typical Messages list navigation)
  const chatSource: ChatSource = (source as ChatSource) || 'messages';
  return (
    <AppErrorBoundary name="MessagesTabChat">
      <ChatScreenInner conversationId={conversationId!} source={chatSource} />
    </AppErrorBoundary>
  );
}
