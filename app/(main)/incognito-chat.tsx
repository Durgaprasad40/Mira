/*
 * LEGACY REDIRECT — Phase-2 chat thread has moved.
 *
 * The canonical Phase-2 thread now lives at:
 *   app/(main)/(private)/(tabs)/chats/[id].tsx
 *
 * This file is kept only because a few surfaces outside the controlled-rewrite
 * scope (e.g. components/screens/DiscoverCardStack.tsx,
 * components/discover/NotificationPopover.tsx, app/(main)/notifications.tsx)
 * still push to `/(main)/incognito-chat?id=...`. Those callers will silently
 * land on the new route via this redirect.
 *
 * Do not add UI here. Do not extend this file. New work goes in chats/[id].tsx.
 */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function IncognitoChatRedirect() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = params.id;
  const id =
    typeof rawId === 'string' && rawId.trim()
      ? rawId.trim()
      : Array.isArray(rawId) && rawId[0]
        ? String(rawId[0]).trim()
        : null;

  if (!id) {
    return <Redirect href={'/(main)/(private)/(tabs)/chats' as any} />;
  }

  return (
    <Redirect href={`/(main)/(private)/(tabs)/chats/${id}` as any} />
  );
}
