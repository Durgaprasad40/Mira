import { useLocalSearchParams } from 'expo-router';
import ChatScreenInner, { ChatSource } from '@/components/screens/ChatScreenInner';
import { AppErrorBoundary } from '@/components/safety';

/** Standalone chat route — used from discover, matches, confessions, etc. */
export default function ChatScreen() {
  const { id: conversationId, source } = useLocalSearchParams<{ id: string; source?: string }>();

  // DEV guard: catch navigation bugs where conversationId is missing.
  // In production this is a no-op; the non-null assertion below is safe
  // because Expo Router guarantees the [id] param exists for this route.
  if (__DEV__ && !conversationId) {
    console.warn('[ChatScreen] navigated without conversationId — check the calling router.push/replace');
  }

  return (
    <AppErrorBoundary name="ChatScreen">
      <ChatScreenInner conversationId={conversationId!} source={source as ChatSource} />
    </AppErrorBoundary>
  );
}
