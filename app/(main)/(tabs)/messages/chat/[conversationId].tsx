import { useLocalSearchParams } from 'expo-router';
import ChatScreenInner from '@/components/screens/ChatScreenInner';

/** Chat route nested inside the Messages tab — keeps the tab bar active. */
export default function MessagesTabChatScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  return <ChatScreenInner conversationId={conversationId!} />;
}
