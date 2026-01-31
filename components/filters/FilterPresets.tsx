import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui';
import { useAuthStore, useSubscriptionStore } from '@/stores';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';

interface FilterPresetsProps {
  visible: boolean;
  onClose: () => void;
  onLoadPreset: (filters: any) => void;
}

export function FilterPresets({ visible, onClose, onLoadPreset }: FilterPresetsProps) {
  const { userId } = useAuthStore();
  const { tier } = useSubscriptionStore();
  const isPremium = tier === 'premium';
  const [showCreate, setShowCreate] = useState(false);
  const [presetName, setPresetName] = useState('');

  const presets = useQuery(
    api.filterPresets.getPresets,
    userId ? { userId: userId as any } : 'skip'
  );

  const savePreset = useMutation(api.filterPresets.savePreset);
  const deletePreset = useMutation(api.filterPresets.deletePreset);

  const handleSave = async () => {
    if (!presetName.trim()) {
      Alert.alert('Error', 'Please enter a name for your preset');
      return;
    }

    // Get current filters from filter store
    // This would need to be passed as props or accessed via store
    const currentFilters = {
      relationshipIntents: [],
      activities: [],
      ageMin: 18,
      ageMax: 50,
      maxDistance: 25,
    };

    try {
      await savePreset({
        userId: userId as any,
        name: presetName.trim(),
        filters: currentFilters,
      });
      setPresetName('');
      setShowCreate(false);
      Alert.alert('Success', 'Preset saved!');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to save preset');
    }
  };

  const handleDelete = async (presetId: string) => {
    Alert.alert(
      'Delete Preset',
      'Are you sure you want to delete this preset?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePreset({ presetId: presetId as any, userId: userId as any });
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete preset');
            }
          },
        },
      ]
    );
  };

  if (!isPremium && presets && presets.length >= 3) {
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Filter Presets</Text>
            <View style={styles.placeholder} />
          </View>
          <View style={styles.upgradePrompt}>
            <Ionicons name="lock-closed" size={48} color={COLORS.primary} />
            <Text style={styles.upgradeTitle}>Upgrade to Save More Presets</Text>
            <Text style={styles.upgradeText}>
              Free users can save up to 3 presets. Upgrade to Premium for unlimited presets!
            </Text>
            <Button
              title="Upgrade to Premium"
              variant="primary"
              onPress={() => {
                onClose();
                // Navigate to subscription
              }}
              style={styles.upgradeButton}
            />
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Saved Presets</Text>
          <TouchableOpacity onPress={() => setShowCreate(true)}>
            <Ionicons name="add" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        {showCreate ? (
          <View style={styles.createContainer}>
            <Text style={styles.createTitle}>Create New Preset</Text>
            <TextInput
              style={styles.nameInput}
              placeholder="Preset name (e.g., Weekend Coffee Dates)"
              value={presetName}
              onChangeText={setPresetName}
              placeholderTextColor={COLORS.textLight}
            />
            <View style={styles.createActions}>
              <Button
                title="Cancel"
                variant="outline"
                onPress={() => {
                  setShowCreate(false);
                  setPresetName('');
                }}
              />
              <Button title="Save" variant="primary" onPress={handleSave} />
            </View>
          </View>
        ) : (
          <ScrollView style={styles.content}>
            {presets && presets.length > 0 ? (
              presets.map((preset) => (
                <TouchableOpacity
                  key={preset._id}
                  style={styles.presetCard}
                  onPress={() => {
                    onLoadPreset(preset.filters);
                    onClose();
                  }}
                >
                  <View style={styles.presetInfo}>
                    <Text style={styles.presetName}>{preset.name}</Text>
                    <Text style={styles.presetDetails}>
                      {preset.filters.relationshipIntents?.length || 0} intents •{' '}
                      {preset.filters.activities?.length || 0} activities
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDelete(preset._id)}
                    style={styles.deleteButton}
                  >
                    <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.emptyContainer}>
                <Ionicons name="bookmark-outline" size={64} color={COLORS.textLight} />
                <Text style={styles.emptyTitle}>No presets saved</Text>
                <Text style={styles.emptySubtitle}>
                  Save your favorite filter combinations for quick access
                </Text>
                <Button
                  title="Create Your First Preset"
                  variant="primary"
                  onPress={() => setShowCreate(true)}
                  style={styles.createFirstButton}
                />
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  placeholder: {
    width: 24,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  presetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    marginBottom: 12,
  },
  presetInfo: {
    flex: 1,
  },
  presetName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  presetDetails: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  deleteButton: {
    padding: 8,
  },
  createContainer: {
    padding: 16,
  },
  createTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  nameInput: {
    padding: 16,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 16,
  },
  createActions: {
    flexDirection: 'row',
    gap: 12,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 24,
  },
  createFirstButton: {
    minWidth: 200,
  },
  upgradePrompt: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  upgradeTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  upgradeText: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  upgradeButton: {
    minWidth: 200,
  },
});
