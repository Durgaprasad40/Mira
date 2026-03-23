/*
 * LOCKED (DISCOVER TAB)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - No logic/UI changes allowed
 */
import { DiscoverCardStack } from "@/components/screens/DiscoverCardStack";
import { useScreenTrace } from "@/lib/devTrace";

export default function HomeScreen() {
  useScreenTrace("HOME");
  return <DiscoverCardStack />;
}
