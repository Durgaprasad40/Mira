/**
 * Phase-2 Safety Support Screen
 *
 * Shows existing support cases and allows creating new ones.
 * Tapping a case opens the case thread for messaging.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { Id } from '@/convex/_generated/dataModel';

const C = INCOGNITO_COLORS;

// Support categories
const CATEGORIES = [
  {
    value: 'scam_extortion',
    label: 'Scam or Extortion',
    icon: 'warning-outline',
    description: 'Someone is trying to scam you or demanding money/favors',
  },
  {
    value: 'non_consensual_sharing',
    label: 'Non-consensual Sharing',
    icon: 'lock-closed-outline',
    description: 'Someone shared or threatened to share intimate content without consent',
  },
  {
    value: 'physical_safety',
    label: 'Physical Safety',
    icon: 'shield-outline',
    description: 'You feel physically unsafe or have been threatened',
  },
  {
    value: 'harassment_stalking',
    label: 'Harassment or Stalking',
    icon: 'eye-off-outline',
    description: 'Persistent unwanted contact or stalking behavior',
  },
  {
    value: 'other_safety',
    label: 'Other Safety Concern',
    icon: 'help-circle-outline',
    description: 'Another serious safety issue not listed above',
  },
] as const;

type CategoryValue = (typeof CATEGORIES)[number]['value'];

// Category labels for display
const CATEGORY_LABELS: Record<string, string> = {
  scam_extortion: 'Scam / Extortion',
  non_consensual_sharing: 'Non-consensual Sharing',
  physical_safety: 'Physical Safety',
  harassment_stalking: 'Harassment / Stalking',
  other_safety: 'Other Safety',
};

// Status colors
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  submitted: { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B' },
  in_review: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3B82F6' },
  resolved: { bg: 'rgba(16, 185, 129, 0.15)', text: '#10B981' },
  closed: { bg: 'rgba(107, 114, 128, 0.15)', text: '#6B7280' },
};

interface RelatedUser {
  userId: string;
  displayName: string;
  photoUrl: string | null;
}

interface SupportRequest {
  requestId: string;
  category: string;
  status: string;
  createdAt: number;
  lastMessageAt?: number;
  relatedUser?: RelatedUser | null;
}

interface SelectableUser {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  sourceType: string;
  lastInteractionAt: number;
}

// Categories that require person selection
const PERSON_REQUIRED_CATEGORIES: CategoryValue[] = [
  'scam_extortion',
  'non_consensual_sharing',
  'harassment_stalking',
];

// Source type labels
const SOURCE_TYPE_LABELS: Record<string, string> = {
  blocked: 'Blocked',
  reported: 'Reported',
  recent_chat: 'Recent chat',
};

export default function SafetySupportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();

  const [showNewCaseForm, setShowNewCaseForm] = useState(false);
  const [showPersonPicker, setShowPersonPicker] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<CategoryValue | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<SelectableUser | null>(null);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch existing support cases
  const casesData = useQuery(
    api.support.getMySupportRequests,
    !isDemoMode && userId ? { authUserId: userId } : 'skip'
  );

  // Fetch selectable users for person picker
  const selectableUsersData = useQuery(
    api.support.getSelectableUsersForSupportCase,
    !isDemoMode && userId && showNewCaseForm ? { authUserId: userId } : 'skip'
  );

  const createSupportRequest = useMutation(api.support.createSupportRequest);

  const selectableUsers = selectableUsersData?.users || [];
  const isLoadingSelectableUsers = selectableUsersData === undefined && showNewCaseForm;

  const cases = casesData?.requests || [];
  const isLoadingCases = casesData === undefined;

  const isPersonRequired = selectedCategory && PERSON_REQUIRED_CATEGORIES.includes(selectedCategory);

  const handleCreateCase = async () => {
    if (!selectedCategory || !description.trim() || !userId || isSubmitting) return;

    // Check if person is required but not selected
    if (isPersonRequired && !selectedPerson) {
      Alert.alert(
        'Person Required',
        'Please select the person involved in this incident so we can investigate properly.'
      );
      return;
    }

    if (description.trim().length < 20) {
      Alert.alert(
        'More Details Needed',
        'Please provide at least 20 characters describing your situation so we can help you better.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      if (!isDemoMode) {
        const result = await createSupportRequest({
          authUserId: userId,
          category: selectedCategory,
          description: description.trim(),
          relatedUserId: selectedPerson?.userId as Id<'users'> | undefined,
        });

        if (!result.success) {
          if (result.error === 'rate_limited') {
            Alert.alert(
              'Request Limit Reached',
              result.message || 'Please wait before submitting another request.'
            );
            return;
          }
          Alert.alert('Error', 'Failed to create support case. Please try again.');
          return;
        }

        // Navigate to the new case thread
        if (result.requestId) {
          setShowNewCaseForm(false);
          setSelectedCategory(null);
          setSelectedPerson(null);
          setDescription('');
          router.push({
            pathname: '/(main)/(private)/settings/support-case-thread',
            params: { requestId: result.requestId },
          });
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[SafetySupport] Create error:', error);
      }
      Alert.alert('Error', 'Failed to create support case. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenCase = (requestId: string) => {
    router.push({
      pathname: '/(main)/(private)/settings/support-case-thread',
      params: { requestId },
    });
  };

  const formatRelativeTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const canSubmit =
    selectedCategory &&
    description.trim().length >= 20 &&
    !isSubmitting &&
    (!isPersonRequired || selectedPerson);

  // New Case Form View
  if (showNewCaseForm) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={[styles.container, { paddingTop: insets.top }]}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setShowNewCaseForm(false)} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={24} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>New Support Case</Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView
            style={styles.content}
            contentContainerStyle={{
              paddingBottom: selectedCategory ? insets.bottom + 120 : insets.bottom + 20,
            }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Category Selection */}
            <Text style={styles.sectionTitle}>What's happening?</Text>
            <View style={styles.categoriesContainer}>
              {CATEGORIES.map((cat) => {
                const isSelected = selectedCategory === cat.value;
                return (
                  <TouchableOpacity
                    key={cat.value}
                    style={[styles.categoryCard, isSelected && styles.categoryCardSelected]}
                    onPress={() => setSelectedCategory(cat.value)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.categoryHeader}>
                      <View style={[styles.categoryIcon, isSelected && styles.categoryIconSelected]}>
                        <Ionicons
                          name={cat.icon as any}
                          size={20}
                          color={isSelected ? C.primary : C.textLight}
                        />
                      </View>
                      <View style={styles.categoryInfo}>
                        <Text style={[styles.categoryLabel, isSelected && styles.categoryLabelSelected]}>
                          {cat.label}
                        </Text>
                        <Text style={styles.categoryDescription}>{cat.description}</Text>
                      </View>
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={22} color={C.primary} />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Person Selection */}
            {selectedCategory && (
              <View style={styles.personSection}>
                <View style={styles.personSectionHeader}>
                  <Text style={styles.sectionTitle}>
                    Person Involved {isPersonRequired ? '(Required)' : '(Optional)'}
                  </Text>
                </View>
                <Text style={styles.sectionHint}>
                  Select the person involved so we can investigate properly.
                </Text>

                {/* Selected Person Display */}
                {selectedPerson ? (
                  <View style={styles.selectedPersonCard}>
                    <View style={styles.selectedPersonInfo}>
                      {selectedPerson.photoUrl ? (
                        <Image source={{ uri: selectedPerson.photoUrl }} style={styles.personAvatar} />
                      ) : (
                        <View style={[styles.personAvatar, styles.personAvatarPlaceholder]}>
                          <Ionicons name="person" size={20} color={C.textLight} />
                        </View>
                      )}
                      <View style={styles.personDetails}>
                        <Text style={styles.personName}>{selectedPerson.displayName}</Text>
                        <Text style={styles.personSourceLabel}>
                          {SOURCE_TYPE_LABELS[selectedPerson.sourceType] || selectedPerson.sourceType}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => setSelectedPerson(null)}
                      style={styles.removePersonBtn}
                    >
                      <Ionicons name="close-circle" size={22} color={C.textLight} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.selectPersonBtn}
                    onPress={() => setShowPersonPicker(true)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="person-add-outline" size={20} color={C.primary} />
                    <Text style={styles.selectPersonBtnText}>Select Person</Text>
                    <Ionicons name="chevron-forward" size={18} color={C.textLight} />
                  </TouchableOpacity>
                )}

                {/* Person Picker Modal-like section */}
                {showPersonPicker && (
                  <View style={styles.personPickerContainer}>
                    <View style={styles.personPickerHeader}>
                      <Text style={styles.personPickerTitle}>Select Person</Text>
                      <TouchableOpacity onPress={() => setShowPersonPicker(false)}>
                        <Ionicons name="close" size={22} color={C.text} />
                      </TouchableOpacity>
                    </View>

                    {isLoadingSelectableUsers && (
                      <View style={styles.personPickerLoading}>
                        <ActivityIndicator size="small" color={C.primary} />
                        <Text style={styles.loadingText}>Loading contacts...</Text>
                      </View>
                    )}

                    {!isLoadingSelectableUsers && selectableUsers.length === 0 && (
                      <View style={styles.personPickerEmpty}>
                        <Ionicons name="people-outline" size={32} color={C.textLight} />
                        <Text style={styles.emptyText}>
                          No recent contacts found. You can proceed without selecting a person.
                        </Text>
                      </View>
                    )}

                    {!isLoadingSelectableUsers && selectableUsers.length > 0 && (
                      <ScrollView style={styles.personList} showsVerticalScrollIndicator={false}>
                        {selectableUsers.map((user: SelectableUser) => (
                          <TouchableOpacity
                            key={user.userId}
                            style={styles.personListItem}
                            onPress={() => {
                              setSelectedPerson(user);
                              setShowPersonPicker(false);
                            }}
                            activeOpacity={0.7}
                          >
                            {user.photoUrl ? (
                              <Image source={{ uri: user.photoUrl }} style={styles.personAvatar} />
                            ) : (
                              <View style={[styles.personAvatar, styles.personAvatarPlaceholder]}>
                                <Ionicons name="person" size={20} color={C.textLight} />
                              </View>
                            )}
                            <View style={styles.personDetails}>
                              <Text style={styles.personName}>{user.displayName}</Text>
                              <Text style={styles.personSourceLabel}>
                                {SOURCE_TYPE_LABELS[user.sourceType] || user.sourceType}
                              </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={C.textLight} />
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}

                    {!isPersonRequired && (
                      <TouchableOpacity
                        style={styles.skipPersonBtn}
                        onPress={() => setShowPersonPicker(false)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.skipPersonBtnText}>Skip for now</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Description Input */}
            {selectedCategory && !showPersonPicker && (
              <View style={styles.descriptionSection}>
                <Text style={styles.sectionTitle}>Tell us more</Text>
                <Text style={styles.sectionHint}>
                  Please describe your situation so we can help you better. Include any relevant details.
                </Text>
                <TextInput
                  style={styles.descriptionInput}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Describe what happened..."
                  placeholderTextColor={C.textLight}
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                  maxLength={2000}
                />
                <Text style={styles.charCount}>{description.length}/2000</Text>
              </View>
            )}

            {/* Submit Button */}
            {selectedCategory && !showPersonPicker && (
              <TouchableOpacity
                style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
                onPress={handleCreateCase}
                disabled={!canSubmit}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.submitBtnText}>Create Support Case</Text>
                )}
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // Main View - Cases List
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Safety Support</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Info Banner - Updated text per requirements */}
        <View style={styles.infoBanner}>
          <Ionicons name="shield-checkmark-outline" size={20} color={C.primary} />
          <Text style={styles.infoText}>
            Report scam, blackmail, coercion, fake profiles, or non-consensual threats. You can contact the Mira Safety Team and share evidence here.
          </Text>
        </View>

        {/* Create New Case Button */}
        <TouchableOpacity
          style={styles.createCaseBtn}
          onPress={() => setShowNewCaseForm(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="add-circle-outline" size={22} color={C.primary} />
          <Text style={styles.createCaseBtnText}>Create New Support Case</Text>
        </TouchableOpacity>

        {/* Cases List */}
        <Text style={styles.sectionTitle}>Your Support Cases</Text>

        {isLoadingCases && (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        )}

        {!isLoadingCases && cases.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={40} color={C.textLight} />
            <Text style={styles.emptyTitle}>No Support Cases</Text>
            <Text style={styles.emptyText}>
              Create a support case if you need help with a safety concern.
            </Text>
          </View>
        )}

        {!isLoadingCases && cases.length > 0 && (
          <View style={styles.casesList}>
            {cases.map((caseItem: SupportRequest) => {
              const statusStyle = STATUS_COLORS[caseItem.status] || STATUS_COLORS.submitted;
              const displayTime = caseItem.lastMessageAt || caseItem.createdAt;
              return (
                <TouchableOpacity
                  key={caseItem.requestId}
                  style={styles.caseCard}
                  onPress={() => handleOpenCase(caseItem.requestId)}
                  activeOpacity={0.7}
                >
                  <View style={styles.caseCardHeader}>
                    <Text style={styles.caseCategoryLabel}>
                      {CATEGORY_LABELS[caseItem.category] || caseItem.category}
                    </Text>
                    <View style={[styles.caseStatusBadge, { backgroundColor: statusStyle.bg }]}>
                      <Text style={[styles.caseStatusText, { color: statusStyle.text }]}>
                        {caseItem.status.replace('_', ' ')}
                      </Text>
                    </View>
                  </View>
                  {/* Show related person if available */}
                  {caseItem.relatedUser && (
                    <View style={styles.caseRelatedPerson}>
                      <Text style={styles.caseRelatedLabel}>Regarding:</Text>
                      <View style={styles.caseRelatedInfo}>
                        {caseItem.relatedUser.photoUrl ? (
                          <Image
                            source={{ uri: caseItem.relatedUser.photoUrl }}
                            style={styles.caseRelatedAvatar}
                          />
                        ) : (
                          <View style={[styles.caseRelatedAvatar, styles.caseRelatedAvatarPlaceholder]}>
                            <Ionicons name="person" size={12} color={C.textLight} />
                          </View>
                        )}
                        <Text style={styles.caseRelatedName}>{caseItem.relatedUser.displayName}</Text>
                      </View>
                    </View>
                  )}
                  <View style={styles.caseCardFooter}>
                    <Text style={styles.caseTimeText}>{formatRelativeTime(displayTime)}</Text>
                    <Ionicons name="chevron-forward" size={18} color={C.textLight} />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Privacy Note */}
        <View style={styles.privacyNote}>
          <Ionicons name="lock-closed-outline" size={16} color={C.textLight} />
          <Text style={styles.privacyText}>
            Your support cases are confidential. We will never share your identity with the reported user.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: C.text,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    backgroundColor: C.primary + '15',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.primary + '30',
    marginBottom: 16,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: C.text,
    lineHeight: 18,
  },
  createCaseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.primary,
    borderStyle: 'dashed',
    marginBottom: 24,
  },
  createCaseBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.primary,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    marginBottom: 12,
  },
  loadingState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
  },
  emptyText: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  casesList: {
    gap: 10,
    marginBottom: 20,
  },
  caseCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
  },
  caseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  caseCategoryLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    flex: 1,
  },
  caseStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  caseStatusText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  caseCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  caseTimeText: {
    fontSize: 12,
    color: C.textLight,
  },
  sectionHint: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
    marginBottom: 12,
  },
  categoriesContainer: {
    gap: 10,
    marginBottom: 24,
  },
  categoryCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: C.surface,
  },
  categoryCardSelected: {
    borderColor: C.primary,
    backgroundColor: C.primary + '10',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  categoryIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryIconSelected: {
    backgroundColor: C.primary + '20',
  },
  categoryInfo: {
    flex: 1,
  },
  categoryLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    marginBottom: 2,
  },
  categoryLabelSelected: {
    color: C.primary,
  },
  categoryDescription: {
    fontSize: 12,
    color: C.textLight,
    lineHeight: 16,
  },
  descriptionSection: {
    marginBottom: 20,
  },
  descriptionInput: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: C.text,
    minHeight: 140,
    lineHeight: 22,
  },
  charCount: {
    fontSize: 11,
    color: C.textLight,
    textAlign: 'right',
    marginTop: 6,
  },
  submitBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    backgroundColor: C.surface,
    borderRadius: 10,
    marginTop: 8,
  },
  privacyText: {
    flex: 1,
    fontSize: 12,
    color: C.textLight,
    lineHeight: 16,
  },
  // Person selection styles
  personSection: {
    marginBottom: 20,
  },
  personSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectPersonBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  selectPersonBtnText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 15,
    fontWeight: '500',
    color: C.text,
  },
  selectedPersonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.primary + '15',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: C.primary + '30',
  },
  selectedPersonInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  personAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  personAvatarPlaceholder: {
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personDetails: {
    marginLeft: 12,
    flex: 1,
  },
  personName: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },
  personSourceLabel: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 2,
  },
  removePersonBtn: {
    padding: 4,
  },
  personPickerContainer: {
    marginTop: 12,
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    maxHeight: 300,
  },
  personPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  personPickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
  },
  personPickerLoading: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: C.textLight,
  },
  personPickerEmpty: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 10,
  },
  personList: {
    maxHeight: 200,
  },
  personListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  skipPersonBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  skipPersonBtnText: {
    fontSize: 14,
    color: C.textLight,
    fontWeight: '500',
  },
  // Case related person styles
  caseRelatedPerson: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  caseRelatedLabel: {
    fontSize: 12,
    color: C.textLight,
  },
  caseRelatedInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  caseRelatedAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  caseRelatedAvatarPlaceholder: {
    backgroundColor: C.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caseRelatedName: {
    fontSize: 13,
    fontWeight: '500',
    color: C.text,
  },
});
