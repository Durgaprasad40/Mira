import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { MyPromptCard, MyTruthDarePrompt } from '@/components/truthdare/MyPromptCard';

const PHASE2_TOD_HOME_ROUTE = '/(main)/(private)/(tabs)/truth-or-dare';

const PREMIUM = {
  bgDeep: '#0D0D1A',
  bgBase: '#141428',
  bgElevated: '#1C1C36',
  bgHighlight: '#252545',
  coral: '#E94560',
  coralSoft: '#FF6B8A',
  textPrimary: '#F5F5F7',
  textSecondary: '#B8B8C7',
  textMuted: '#6E6E82',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
};

function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonPill} />
      <View style={styles.skeletonLineWide} />
      <View style={styles.skeletonLine} />
      <View style={styles.skeletonMetaRow}>
        <View style={styles.skeletonMeta} />
        <View style={styles.skeletonMeta} />
      </View>
    </View>
  );
}

export default function MyTruthOrDareScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const authUserId = useAuthStore((s) => s.userId);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [queryPaused, setQueryPaused] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const queryResumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returningToTodRef = useRef(false);

  const myPromptsQuery = useQuery(
    api.truthDare.getMyPrompts,
    authUserId && !queryPaused ? { authUserId } : 'skip',
  );

  const prompts = useMemo(
    () => ((myPromptsQuery ?? []) as MyTruthDarePrompt[]),
    [myPromptsQuery],
  );
  const isLoading = myPromptsQuery === undefined && !loadTimedOut;

  useEffect(() => {
    if (myPromptsQuery !== undefined) {
      setIsRefreshing(false);
      setLoadTimedOut(false);
      return;
    }

    const timer = setTimeout(() => {
      setLoadTimedOut(true);
      setIsRefreshing(false);
    }, 8000);

    return () => clearTimeout(timer);
  }, [myPromptsQuery]);

  useEffect(() => {
    return () => {
      if (queryResumeTimeoutRef.current) {
        clearTimeout(queryResumeTimeoutRef.current);
        queryResumeTimeoutRef.current = null;
      }
    };
  }, []);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    setLoadTimedOut(false);
    setQueryPaused(true);
    if (queryResumeTimeoutRef.current) {
      clearTimeout(queryResumeTimeoutRef.current);
    }
    queryResumeTimeoutRef.current = setTimeout(() => {
      setQueryPaused(false);
      queryResumeTimeoutRef.current = null;
    }, 80);
  }, []);

  const goBackToTruthOrDare = useCallback(() => {
    if (returningToTodRef.current) return;
    returningToTodRef.current = true;
    router.replace(PHASE2_TOD_HOME_ROUTE as any);
    setTimeout(() => {
      returningToTodRef.current = false;
    }, 500);
  }, [router]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event: any) => {
      if (returningToTodRef.current) return;
      const actionType = event.data?.action?.type;
      if (actionType !== 'POP' && actionType !== 'GO_BACK') return;

      event.preventDefault();
      goBackToTruthOrDare();
    });

    return unsubscribe;
  }, [goBackToTruthOrDare, navigation]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        goBackToTruthOrDare();
        return true;
      });

      return () => subscription.remove();
    }, [goBackToTruthOrDare]),
  );

  const openPromptThread = useCallback((promptId: string) => {
    router.push({
      pathname: '/(main)/prompt-thread' as any,
      params: { promptId, source: 'phase2-tod-mine' },
    });
  }, [router]);

  const createPrompt = useCallback(() => {
    router.push('/(main)/incognito-create-tod' as any);
  }, [router]);

  const renderPrompt = useCallback(
    ({ item }: { item: MyTruthDarePrompt }) => (
      <MyPromptCard prompt={item} onPress={openPromptThread} />
    ),
    [openPromptThread],
  );

  return (
    <LinearGradient
      colors={[PREMIUM.bgDeep, PREMIUM.bgBase] as const}
      style={[styles.container, { paddingTop: insets.top }]}
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={goBackToTruthOrDare}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={PREMIUM.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Truth or Dare</Text>
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={createPrompt}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Create a prompt"
        >
          <Ionicons name="add" size={22} color={PREMIUM.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.hintBanner}>
        <Ionicons name="information-circle-outline" size={16} color={PREMIUM.coralSoft} />
        <Text style={styles.hintText}>Your prompts and response counts appear here.</Text>
      </View>

      {isLoading ? (
        <View style={styles.listContent}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : loadTimedOut && prompts.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="refresh-circle-outline" size={52} color={PREMIUM.textMuted} />
          <Text style={styles.emptyTitle}>Could not load your prompts</Text>
          <Text style={styles.emptySubtitle}>Try again in a moment.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={refresh} activeOpacity={0.85}>
            {isRefreshing ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="refresh" size={18} color="#FFF" />
            )}
            <Text style={styles.primaryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : prompts.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="document-text-outline" size={52} color={PREMIUM.textMuted} />
          <Text style={styles.emptyTitle}>You haven't posted yet</Text>
          <Text style={styles.emptySubtitle}>Create a Truth or Dare prompt when you're ready.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={createPrompt} activeOpacity={0.85}>
            <Ionicons name="add" size={18} color="#FFF" />
            <Text style={styles.primaryButtonText}>Create a prompt</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={prompts}
          keyExtractor={(item) => String(item._id)}
          renderItem={renderPrompt}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refresh}
              tintColor={PREMIUM.coral}
              colors={[PREMIUM.coral]}
            />
          }
        />
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: PREMIUM.borderSubtle,
  },
  headerIconButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PREMIUM.bgElevated,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  headerTitle: {
    flex: 1,
    color: PREMIUM.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  hintBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 16,
    backgroundColor: PREMIUM.bgHighlight,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  hintText: {
    flex: 1,
    color: PREMIUM.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  listContent: {
    paddingTop: 6,
    paddingBottom: 32,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 60,
  },
  emptyTitle: {
    color: PREMIUM.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    color: PREMIUM.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: PREMIUM.coral,
  },
  primaryButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
  },
  skeletonCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 20,
    backgroundColor: PREMIUM.bgElevated,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  skeletonPill: {
    width: 82,
    height: 24,
    borderRadius: 999,
    backgroundColor: PREMIUM.bgHighlight,
    marginBottom: 16,
  },
  skeletonLineWide: {
    width: '92%',
    height: 16,
    borderRadius: 8,
    backgroundColor: PREMIUM.bgHighlight,
    marginBottom: 10,
  },
  skeletonLine: {
    width: '68%',
    height: 16,
    borderRadius: 8,
    backgroundColor: PREMIUM.bgHighlight,
    marginBottom: 18,
  },
  skeletonMetaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  skeletonMeta: {
    width: 70,
    height: 14,
    borderRadius: 7,
    backgroundColor: PREMIUM.bgHighlight,
  },
});
