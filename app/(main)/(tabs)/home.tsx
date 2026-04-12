/*
 * LOCKED (DISCOVER ENTRY)
 * Discover is the unified Cards/Browse entry point.
 * Do NOT split Discover and Explore again unless Durga Prasad explicitly unlocks it.
 */
import DiscoverUnifiedSurface from "@/components/discover/DiscoverUnifiedSurface";

export default function HomeScreen() {
  return <DiscoverUnifiedSurface initialMode="cards" />;
}
