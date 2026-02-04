import { useLocalSearchParams } from 'expo-router';
import ChatScreenInner from '@/components/screens/ChatScreenInner';

/** Standalone chat route — used from messages list, matches, etc. */
export default function ChatScreen() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();

  // DEV guard: catch navigation bugs where conversationId is missing.
  // In production this is a no-op; the non-null assertion below is safe
  // because Expo Router guarantees the [id] param exists for this route.
  if (__DEV__ && !conversationId) {
    console.warn('[ChatScreen] navigated without conversationId — check the calling router.push/replace');
  }

  return <ChatScreenInner conversationId={conversationId!} />;
}
