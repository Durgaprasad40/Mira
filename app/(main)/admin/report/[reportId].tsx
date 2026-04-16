import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import VideoPlayerModal from '@/components/chatroom/VideoPlayerModal';
import { useAuthStore } from '@/stores/authStore';

type Evidence = { storageId: string; type: 'photo' | 'video'; url: string | null };
type BehaviorFlag = {
  flagId: string;
  flagType: string;
  severity: 'low' | 'medium' | 'high';
  description?: string;
  createdAt: number;
};
type ReportDetail = {
  reportId: string;
  reporter: { userId: string; name: string; photoUrl: string | null };
  reportedUser: { userId: string; name: string; photoUrl: string | null };
  reason: string;
  description?: string;
  evidence: Evidence[];
  reportedUserFlags: BehaviorFlag[];
  status: string;
  createdAt: number;
};

function formatReason(reason: string) {
  return reason.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatFlagType(flagType: string) {
  return flagType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function severityColors(sev: 'low' | 'medium' | 'high') {
  if (sev === 'high') return { fg: COLORS.error || '#EF4444', bg: (COLORS.error || '#EF4444') + '15', border: (COLORS.error || '#EF4444') + '40' };
  if (sev === 'medium') return { fg: '#F59E0B', bg: '#F59E0B15', border: '#F59E0B40' };
  return { fg: COLORS.textLight, bg: COLORS.background, border: COLORS.border };
}

export default function AdminReportDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ reportId?: string }>();
  const reportId = params.reportId;
  const token = useAuthStore((s) => s.token);

  const updateReportStatus = useMutation(api.moderationReports.updateReportStatus);

  const data = useQuery(
    api.moderationReports.getReportById,
    reportId && token ? { token, reportId: reportId as any } : 'skip'
  ) as ReportDetail | null | undefined;

  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const isLoading = reportId ? data === undefined : false;

  const createdAtLabel = useMemo(() => {
    if (!data?.createdAt) return '';
    return new Date(data.createdAt).toLocaleString();
  }, [data?.createdAt]);

  if (!reportId) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Report</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={56} color={COLORS.textLight} />
          <Text style={styles.centerTitle}>Missing report id</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Report</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading report...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!data) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Report</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.center}>
          <Ionicons name="document-text-outline" size={56} color={COLORS.textLight} />
          <Text style={styles.centerTitle}>Report not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleSetStatus = async (status: 'reviewed' | 'resolved') => {
    if (!reportId || isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    try {
      if (!token) {
        Alert.alert('Error', 'Missing session token.');
        return;
      }
      const res = await updateReportStatus({ token, reportId: reportId as any, status });
      if ((res as any)?.success === false) {
        Alert.alert('Error', 'Failed to update report status.');
      }
    } catch {
      Alert.alert('Error', 'Failed to update report status.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Report Detail</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.metaRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{data.status}</Text>
          </View>
          <Text style={styles.metaText}>{createdAtLabel}</Text>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[
              styles.actionButton,
              (data.status !== 'pending' || isUpdatingStatus) && styles.actionButtonDisabled,
            ]}
            onPress={() => handleSetStatus('reviewed')}
            disabled={data.status !== 'pending' || isUpdatingStatus}
            activeOpacity={0.8}
          >
            {isUpdatingStatus ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.primary} />
                <Text style={styles.actionButtonText}>Mark as Reviewed</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.resolveButton,
              (data.status === 'resolved' || isUpdatingStatus) && styles.actionButtonDisabled,
            ]}
            onPress={() => handleSetStatus('resolved')}
            disabled={data.status === 'resolved' || isUpdatingStatus}
            activeOpacity={0.8}
          >
            {isUpdatingStatus ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="flag-outline" size={18} color="#FFF" />
                <Text style={styles.resolveButtonText}>Resolve Report</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Reported user</Text>
          <View style={styles.userRow}>
            {data.reportedUser.photoUrl ? (
              <Image source={{ uri: data.reportedUser.photoUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Ionicons name="person" size={20} color={COLORS.textLight} />
              </View>
            )}
            <View style={styles.userInfo}>
              <Text style={styles.userName}>{data.reportedUser.name}</Text>
              <Text style={styles.userId}>ID: {String(data.reportedUser.userId).slice(-10)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Flags</Text>
          {data.reportedUserFlags.length === 0 ? (
            <Text style={styles.bodyText}>No active flags.</Text>
          ) : (
            <View style={styles.flagsList}>
              {data.reportedUserFlags.map((f) => {
                const c = severityColors(f.severity);
                return (
                  <View key={f.flagId} style={styles.flagRow}>
                    <View style={[styles.flagBadge, { backgroundColor: c.bg, borderColor: c.border }]}>
                      <Text style={[styles.flagBadgeText, { color: c.fg }]}>{f.severity}</Text>
                    </View>
                    <View style={styles.flagBody}>
                      <Text style={styles.flagTitle}>{formatFlagType(f.flagType)}</Text>
                      {!!f.description?.trim() && (
                        <Text style={styles.flagDesc}>{f.description.trim()}</Text>
                      )}
                      <Text style={styles.flagTime}>
                        {new Date(f.createdAt).toLocaleString()}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Reporter</Text>
          <View style={styles.userRow}>
            {data.reporter.photoUrl ? (
              <Image source={{ uri: data.reporter.photoUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Ionicons name="person" size={20} color={COLORS.textLight} />
              </View>
            )}
            <View style={styles.userInfo}>
              <Text style={styles.userName}>{data.reporter.name}</Text>
              <Text style={styles.userId}>ID: {String(data.reporter.userId).slice(-10)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Reason</Text>
          <Text style={styles.bodyText}>{formatReason(data.reason)}</Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.bodyText}>
            {data.description?.trim() ? data.description.trim() : 'No description provided.'}
          </Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Evidence</Text>
          {data.evidence.length === 0 ? (
            <Text style={styles.bodyText}>No evidence attached.</Text>
          ) : (
            <View style={styles.evidenceGrid}>
              {data.evidence.map((e) => {
                const key = `${e.type}:${e.storageId}`;
                if (!e.url) {
                  return (
                    <View key={key} style={[styles.evidenceTile, styles.evidenceMissing]}>
                      <Ionicons name="alert-circle-outline" size={20} color={COLORS.textLight} />
                      <Text style={styles.evidenceMissingText}>Missing URL</Text>
                    </View>
                  );
                }

                if (e.type === 'photo') {
                  return (
                    <Image
                      key={key}
                      source={{ uri: e.url }}
                      style={styles.evidenceTile}
                      contentFit="cover"
                    />
                  );
                }

                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.evidenceTile, styles.videoTile]}
                    onPress={() => setActiveVideoUrl(e.url)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="play-circle" size={42} color="#FFFFFF" />
                    <Text style={styles.videoLabel}>Video</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      <VideoPlayerModal
        visible={!!activeVideoUrl}
        videoUri={activeVideoUrl || ''}
        onClose={() => setActiveVideoUrl(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: COLORS.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  centerTitle: { marginTop: 12, fontSize: 16, fontWeight: '600', color: COLORS.text },
  loadingText: { marginTop: 12, fontSize: 14, color: COLORS.textLight },
  content: { padding: 12, paddingBottom: 24, gap: 10 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  actionsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 4 },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  actionButtonText: { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  resolveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.error || '#EF4444',
    borderWidth: 1,
    borderColor: COLORS.error || '#EF4444',
  },
  resolveButtonText: { fontSize: 14, fontWeight: '800', color: '#FFF' },
  actionButtonDisabled: { opacity: 0.5 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  badgeText: { fontSize: 12, fontWeight: '700', color: COLORS.textLight, textTransform: 'capitalize' },
  metaText: { fontSize: 12, color: COLORS.textLight },
  sectionCard: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted, marginBottom: 8, textTransform: 'uppercase' },
  bodyText: { fontSize: 14, color: COLORS.text, lineHeight: 20 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.background },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  userInfo: { flex: 1, gap: 2 },
  userName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  userId: { fontSize: 12, color: COLORS.textLight },
  evidenceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  evidenceTile: {
    width: 110,
    height: 110,
    borderRadius: 10,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  evidenceMissing: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  evidenceMissingText: { fontSize: 12, color: COLORS.textLight },
  videoTile: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  videoLabel: { marginTop: 6, fontSize: 12, fontWeight: '700', color: '#FFF' },
  flagsList: { gap: 10 },
  flagRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  flagBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  flagBadgeText: { fontSize: 12, fontWeight: '800', textTransform: 'capitalize' },
  flagBody: { flex: 1, gap: 2 },
  flagTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  flagDesc: { fontSize: 13, color: COLORS.text, lineHeight: 18 },
  flagTime: { marginTop: 2, fontSize: 12, color: COLORS.textLight },
});

