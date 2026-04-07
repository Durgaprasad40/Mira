/*
 * LOCKED (DESIRE LAND SCREEN)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - No logic/UI changes allowed
 */
import { DiscoverCardStack } from "@/components/screens/DiscoverCardStack";
import { useScreenTrace } from "@/lib/devTrace";

export default function DesireLandScreen() {
  useScreenTrace("P2_DESIRE_LAND");
  return <DiscoverCardStack theme="dark" mode="phase2" />;
}
