import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { useLocation } from '@/hooks/useLocation';
import { Toast } from '@/components/ui/Toast';

type PrivacyZone = {
  _id: Id<'privacyZones'>;
  label: string;
  radiusMeters: number;
  createdAt: number;
  updatedAt: number;
};

const LABEL_OPTIONS = ['Home', 'Hostel', 'Work', 'College', 'Gym', 'Other'];
const RADIUS_OPTIONS = [200, 500, 1000];
const MAX_ZONES = 3;

export default function PrivacyZonesScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const { forceGetCurrentLocation, isLoading: isLocating } = useLocation();

  const [selectedLabel, setSelectedLabel] = useState('Home');
  const [selectedRadius, setSelectedRadius] = useState(500);
  const [pendingZoneId, setPendingZoneId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const shouldQuery = !isDemoMode && !!userId;
  const zonesQuery = useQuery(
    api.crossedPaths.listPrivacyZones,
    shouldQuery ? { authUserId: userId! } : 'skip',
  );
  const zones = useMemo(
    () => (Array.isArray(zonesQuery) ? (zonesQuery as PrivacyZone[]) : []),
    [zonesQuery],
  );

  const upsertPrivacyZone = useMutation(api.crossedPaths.upsertPrivacyZone);
  const deletePrivacyZone = useMutation(api.crossedPaths.deletePrivacyZone);

  const isLoading = shouldQuery && zonesQuery === undefined;
  const existingSelectedZone = zones.find(
    (zone) => zone.label.toLowerCase() === selectedLabel.toLowerCase(),
  );
  const canAddNewZone = zones.length < MAX_ZONES || !!existingSelectedZone;

  const handleSaveCurrentLocation = async () => {
    if (isDemoMode) {
      Toast.show('Privacy Zones are available in live mode.');
      return;
    }
    if (!userId) {
      Toast.show('Please log in to manage Privacy Zones.');
      return;
    }
    if (!canAddNewZone) {
      Toast.show(`You can create up to ${MAX_ZONES} Privacy Zones.`);
      return;
    }

    setIsSaving(true);
    try {
      const location = await forceGetCurrentLocation();
      if (!location) {
        Toast.show('Could not get your current location.');
        return;
      }

      const payload: {
        authUserId: string;
        zoneId?: Id<'privacyZones'>;
        label: string;
        latitude: number;
        longitude: number;
        radiusMeters: number;
      } = {
        authUserId: userId,
        label: selectedLabel,
        latitude: location.latitude,
        longitude: location.longitude,
        radiusMeters: selectedRadius,
      };
      if (existingSelectedZone) {
        payload.zoneId = existingSelectedZone._id;
      }

      await upsertPrivacyZone(payload);

      Toast.show(
        existingSelectedZone
          ? `${selectedLabel} zone updated`
          : `${selectedLabel} zone added`,
      );
    } catch (error: any) {
      Toast.show(error?.message || 'Could not save Privacy Zone.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (zone: PrivacyZone) => {
    if (!userId || pendingZoneId) return;

    Alert.alert(
      'Delete Privacy Zone?',
      `${zone.label} will stop protecting this area.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setPendingZoneId(zone._id);
            try {
              await deletePrivacyZone({
                authUserId: userId,
                zoneId: zone._id,
              });
              Toast.show(`${zone.label} zone deleted`);
            } catch (error: any) {
              Toast.show(error?.message || 'Could not delete Privacy Zone.');
            } finally {
              setPendingZoneId((current) => (current === zone._id ? null : current));
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy Zones</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={styles.explanation}>
            Mira will not record crossed paths inside these private areas.
          </Text>
          <Text style={styles.countText}>{zones.length}/{MAX_ZONES} zones protected</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Zones</Text>
          {isLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.emptyText}>Loading Privacy Zones...</Text>
            </View>
          ) : zones.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="shield-outline" size={34} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>No Privacy Zones yet</Text>
              <Text style={styles.emptyText}>Save your current location to protect it.</Text>
            </View>
          ) : (
            <View style={styles.zoneList}>
              {zones.map((zone) => (
                <View key={zone._id} style={styles.zoneRow}>
                  <View style={styles.zoneIcon}>
                    <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.primary} />
                  </View>
                  <View style={styles.zoneInfo}>
                    <Text style={styles.zoneLabel}>{zone.label}</Text>
                    <Text style={styles.zoneMeta}>{zone.radiusMeters}m radius</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.iconButton}
                    onPress={() => handleDelete(zone)}
                    disabled={pendingZoneId === zone._id}
                    accessibilityLabel={`Delete ${zone.label} Privacy Zone`}
                  >
                    {pendingZoneId === zone._id ? (
                      <ActivityIndicator size="small" color={COLORS.error} />
                    ) : (
                      <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                    )}
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {existingSelectedZone ? 'Update Zone' : 'Add Zone'}
          </Text>

          <Text style={styles.fieldLabel}>Label</Text>
          <View style={styles.optionWrap}>
            {LABEL_OPTIONS.map((label) => {
              const selected = selectedLabel === label;
              return (
                <TouchableOpacity
                  key={label}
                  style={[styles.optionChip, selected && styles.optionChipSelected]}
                  onPress={() => setSelectedLabel(label)}
                  accessibilityLabel={`Use ${label} label`}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>Radius</Text>
          <View style={styles.radiusRow}>
            {RADIUS_OPTIONS.map((radius) => {
              const selected = selectedRadius === radius;
              return (
                <TouchableOpacity
                  key={radius}
                  style={[styles.radiusOption, selected && styles.radiusOptionSelected]}
                  onPress={() => setSelectedRadius(radius)}
                  accessibilityLabel={`${radius} meter radius`}
                >
                  <Text style={[styles.radiusText, selected && styles.radiusTextSelected]}>
                    {radius}m
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[
              styles.saveButton,
              (!canAddNewZone || isSaving || isLocating) && styles.saveButtonDisabled,
            ]}
            onPress={handleSaveCurrentLocation}
            disabled={!canAddNewZone || isSaving || isLocating}
            accessibilityLabel="Save current location as Privacy Zone"
          >
            {isSaving || isLocating ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Ionicons name="navigate-outline" size={18} color={COLORS.white} />
            )}
            <Text style={styles.saveButtonText}>
              {existingSelectedZone ? 'Update Current Location' : 'Use Current Location'}
            </Text>
          </TouchableOpacity>

          {!canAddNewZone && (
            <Text style={styles.limitText}>
              Delete a zone before adding another private area.
            </Text>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  content: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  explanation: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 21,
  },
  countText: {
    marginTop: 8,
    fontSize: 13,
    color: COLORS.textMuted,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    paddingHorizontal: 12,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 18,
    textAlign: 'center',
  },
  zoneList: {
    gap: 10,
  },
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.background,
  },
  zoneIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySubtle,
    marginRight: 12,
  },
  zoneInfo: {
    flex: 1,
    minWidth: 0,
  },
  zoneLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  zoneMeta: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textMuted,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  optionChip: {
    minHeight: 38,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.background,
  },
  optionChipSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primarySubtle,
  },
  optionText: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  optionTextSelected: {
    color: COLORS.primaryDark,
  },
  radiusRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 18,
  },
  radiusOption: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  radiusOptionSelected: {
    backgroundColor: COLORS.primary,
  },
  radiusText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  radiusTextSelected: {
    color: COLORS.white,
  },
  saveButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
  },
  saveButtonDisabled: {
    opacity: 0.55,
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.white,
  },
  limitText: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
});
