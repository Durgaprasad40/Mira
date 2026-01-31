import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Image,
  TextInput,
  Dimensions,
  RefreshControl,
  Modal,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { DEMO_INCOGNITO_PROFILES, DEMO_TOD_POSTS } from '@/lib/demoData';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import { ReportModal } from '@/components/private/ReportModal';
import type { IncognitoProfile, TruthOrDarePost, IncognitoChatRoom, DesireCategory } from '@/types';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

type SectionTab = 'discover' | 'tod' | 'rooms' | 'chats' | 'profile';

const DEMO_CHAT_ROOMS: IncognitoChatRoom[] = [
  { id: 'room_1', name: 'Late Night Talks', language: 'English', memberCount: 128, onlineCount: 34, latestMessage: 'Anyone still awake?', icon: 'moon', color: '#6C5CE7' },
  { id: 'room_2', name: 'Mumbai Meetups', language: 'Hindi', memberCount: 256, onlineCount: 67, latestMessage: 'Best cafe in Bandra?', icon: 'location', color: '#E17055' },
  { id: 'room_3', name: 'Book Club', language: 'English', memberCount: 89, onlineCount: 12, latestMessage: 'Just finished Atomic Habits', icon: 'book', color: '#00B894' },
  { id: 'room_4', name: 'Fitness Buddies', language: 'English', memberCount: 175, onlineCount: 45, latestMessage: 'Morning run tomorrow?', icon: 'fitness', color: '#FDCB6E' },
  { id: 'room_5', name: 'Music Lovers', language: 'English', memberCount: 312, onlineCount: 89, latestMessage: 'New Prateek Kuhad drop!', icon: 'musical-notes', color: '#E84393' },
  { id: 'room_6', name: 'Travel Stories', language: 'English', memberCount: 198, onlineCount: 28, latestMessage: 'Goa tips for first timers?', icon: 'airplane', color: '#0984E3' },
];

const ALL_DESIRE_CATEGORIES: DesireCategory[] = ['romantic', 'adventurous', 'intellectual', 'social', 'creative', 'spiritual'];

export default function PrivateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeSection, setActiveSection] = useState<SectionTab>('discover');
  const [refreshing, setRefreshing] = useState(false);
  const pendingCount = usePrivateChatStore((s) => s.pendingDares.length);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const sections: { key: SectionTab; label: string; icon: string; badge?: number }[] = [
    { key: 'discover', label: 'Desire', icon: 'compass' },
    { key: 'tod', label: 'T or D', icon: 'flame', badge: pendingCount },
    { key: 'rooms', label: 'Rooms', icon: 'chatbubbles' },
    { key: 'chats', label: 'Chats', icon: 'mail' },
    { key: 'profile', label: 'Me', icon: 'person-circle' },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="eye-off" size={24} color={C.primary} />
        <Text style={styles.headerTitle}>Private</Text>
        <View style={styles.headerRight}>
          {activeSection === 'tod' && (
            <TouchableOpacity onPress={() => router.push('/(main)/incognito-create-tod' as any)}>
              <Ionicons name="add-circle" size={28} color={C.primary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Section Tabs */}
      <View style={styles.tabBar}>
        {sections.map((s) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.tab, activeSection === s.key && styles.tabActive]}
            onPress={() => setActiveSection(s.key)}
          >
            <View style={{ position: 'relative' }}>
              <Ionicons
                name={s.icon as any}
                size={18}
                color={activeSection === s.key ? C.primary : C.textLight}
              />
              {(s.badge ?? 0) > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{s.badge}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.tabLabel, activeSection === s.key && styles.tabLabelActive]}>
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {activeSection === 'discover' && <DesireLandSection router={router} refreshing={refreshing} onRefresh={onRefresh} />}
      {activeSection === 'tod' && <TodSection router={router} refreshing={refreshing} onRefresh={onRefresh} />}
      {activeSection === 'rooms' && <RoomsSection router={router} />}
      {activeSection === 'chats' && <ChatsSection router={router} />}
      {activeSection === 'profile' && <PrivateProfileSection />}
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   A) DESIRE LAND — Private Discovery
   ═══════════════════════════════════════════════════════════════ */
function DesireLandSection({ router, refreshing, onRefresh }: { router: any; refreshing: boolean; onRefresh: () => void }) {
  const profiles = DEMO_INCOGNITO_PROFILES;
  const isUnlocked = usePrivateChatStore((s) => s.isUnlocked);
  const blockedIds = usePrivateChatStore((s) => s.blockedUserIds);
  const [sendTodTarget, setSendTodTarget] = useState<IncognitoProfile | null>(null);
  const [reportTarget, setReportTarget] = useState<IncognitoProfile | null>(null);
  const blockUser = usePrivateChatStore((s) => s.blockUser);

  const filtered = profiles.filter((p) => !blockedIds.includes(p.id));

  const renderProfile = ({ item }: { item: IncognitoProfile }) => {
    const unlocked = isUnlocked(item.id);
    return (
      <View style={styles.profileCard}>
        <Image
          source={{ uri: item.photoUrl }}
          style={styles.profileImage}
          blurRadius={item.faceUnblurred ? 0 : 15}
        />
        {item.isOnline && <View style={styles.onlineDot} />}
        <View style={styles.profileInfo}>
          <Text style={styles.profileUsername} numberOfLines={1}>{item.username}</Text>
          <Text style={styles.profileAge}>{item.age} · {item.distance} mi</Text>
          <View style={styles.desireRow}>
            {item.desireCategories.slice(0, 2).map((cat) => (
              <View key={cat} style={styles.desireChip}>
                <Text style={styles.desireChipText}>{cat}</Text>
              </View>
            ))}
          </View>
          {item.desires[0] && (
            <Text style={styles.desireText} numberOfLines={1}>"{item.desires[0]}"</Text>
          )}
          {/* Action buttons */}
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={styles.cardActionBtn}
              onPress={() => setSendTodTarget(item)}
            >
              <Ionicons name="flash" size={14} color={C.primary} />
              <Text style={styles.cardActionText}>T&D</Text>
            </TouchableOpacity>
            {unlocked ? (
              <TouchableOpacity
                style={[styles.cardActionBtn, styles.cardActionBtnChat]}
                onPress={() => {
                  const convo = usePrivateChatStore.getState().conversations.find(
                    (c) => c.participantId === item.id
                  );
                  if (convo) router.push(`/(main)/incognito-chat?id=${convo.id}` as any);
                }}
              >
                <Ionicons name="chatbubble" size={14} color="#FFFFFF" />
                <Text style={styles.cardActionTextChat}>Chat</Text>
              </TouchableOpacity>
            ) : (
              <View style={[styles.cardActionBtn, styles.cardActionBtnLocked]}>
                <Ionicons name="lock-closed" size={12} color={C.textLight} />
                <Text style={styles.cardActionTextLocked}>Locked</Text>
              </View>
            )}
          </View>
          {/* Report */}
          <TouchableOpacity
            style={styles.cardReportBtn}
            onPress={() => setReportTarget(item)}
          >
            <Ionicons name="ellipsis-horizontal" size={16} color={C.textLight} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <>
      <FlatList
        data={filtered}
        numColumns={2}
        keyExtractor={(item) => item.id}
        renderItem={renderProfile}
        contentContainerStyle={styles.gridContent}
        columnWrapperStyle={styles.gridRow}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="eye-off-outline" size={64} color={C.textLight} />
            <Text style={styles.emptyTitle}>No profiles yet</Text>
          </View>
        }
      />
      {/* Send T&D Modal */}
      {sendTodTarget && (
        <SendTodModal
          target={sendTodTarget}
          onClose={() => setSendTodTarget(null)}
        />
      )}
      {/* Report Modal */}
      {reportTarget && (
        <ReportModal
          visible
          targetName={reportTarget.username}
          onClose={() => setReportTarget(null)}
          onReport={() => setReportTarget(null)}
          onBlock={() => { blockUser(reportTarget.id); setReportTarget(null); }}
        />
      )}
    </>
  );
}

/* ─── Send T&D Modal (inline from Desire Land) ─── */
function SendTodModal({ target, onClose }: { target: IncognitoProfile; onClose: () => void }) {
  const [type, setType] = useState<'truth' | 'dare'>('truth');
  const [content, setContent] = useState('');
  const sendDare = usePrivateChatStore((s) => s.sendDare);

  const handleSend = () => {
    if (content.trim().length < 5) return;
    sendDare({
      id: `sd_${Date.now()}`,
      targetId: target.id,
      targetUsername: target.username,
      type,
      content: content.trim(),
      status: 'pending',
      createdAt: Date.now(),
    });
    Alert.alert('Sent!', `Your ${type} was sent anonymously to ${target.username}.`);
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Send to {target.username}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={C.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.todTypeRow}>
            <TouchableOpacity
              style={[styles.todTypeBtn, type === 'truth' && styles.todTypeBtnTruth]}
              onPress={() => setType('truth')}
            >
              <Text style={[styles.todTypeBtnText, type === 'truth' && styles.todTypeBtnTextActive]}>Truth</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.todTypeBtn, type === 'dare' && styles.todTypeBtnDare]}
              onPress={() => setType('dare')}
            >
              <Text style={[styles.todTypeBtnText, type === 'dare' && styles.todTypeBtnTextActive]}>Dare</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.modalInput}
            placeholder={type === 'truth' ? 'Ask a question...' : 'Write a dare...'}
            placeholderTextColor={C.textLight}
            multiline
            maxLength={200}
            value={content}
            onChangeText={setContent}
          />
          <Text style={styles.modalHint}>Sent anonymously. Identity revealed only if they accept.</Text>
          <TouchableOpacity
            style={[styles.modalSendBtn, content.trim().length < 5 && styles.modalSendBtnDisabled]}
            onPress={handleSend}
            disabled={content.trim().length < 5}
          >
            <Text style={styles.modalSendBtnText}>Send Anonymously</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════
   B) TRUTH OR DARE — Feed + Pending Dares
   ═══════════════════════════════════════════════════════════════ */
function TodSection({ router, refreshing, onRefresh }: { router: any; refreshing: boolean; onRefresh: () => void }) {
  const [subTab, setSubTab] = useState<'feed' | 'pending'>('feed');
  const pendingDares = usePrivateChatStore((s) => s.pendingDares);
  const acceptDare = usePrivateChatStore((s) => s.acceptDare);
  const declineDare = usePrivateChatStore((s) => s.declineDare);
  const posts = DEMO_TOD_POSTS;

  return (
    <View style={{ flex: 1 }}>
      {/* Sub-tabs: Feed | Pending */}
      <View style={styles.subTabBar}>
        <TouchableOpacity
          style={[styles.subTab, subTab === 'feed' && styles.subTabActive]}
          onPress={() => setSubTab('feed')}
        >
          <Text style={[styles.subTabText, subTab === 'feed' && styles.subTabTextActive]}>Feed</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.subTab, subTab === 'pending' && styles.subTabActive]}
          onPress={() => setSubTab('pending')}
        >
          <Text style={[styles.subTabText, subTab === 'pending' && styles.subTabTextActive]}>
            Pending {pendingDares.length > 0 ? `(${pendingDares.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {subTab === 'feed' ? (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TodPostCard item={item} />}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="flame-outline" size={64} color={C.textLight} />
              <Text style={styles.emptyTitle}>No posts yet</Text>
            </View>
          }
        />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.listContent}>
          {pendingDares.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="hourglass-outline" size={64} color={C.textLight} />
              <Text style={styles.emptyTitle}>No pending dares</Text>
              <Text style={styles.emptySubtitle}>When someone sends you a Truth or Dare, it appears here</Text>
            </View>
          ) : (
            pendingDares.map((dare) => (
              <View key={dare.id} style={styles.pendingCard}>
                <View style={styles.pendingHeader}>
                  <View style={styles.pendingAvatarWrap}>
                    <Ionicons name="help-circle" size={36} color={C.textLight} />
                  </View>
                  <View style={styles.pendingInfo}>
                    <Text style={styles.pendingFrom}>Anonymous sender</Text>
                    <View style={[styles.todTypeBadgeSmall, { backgroundColor: dare.type === 'truth' ? '#6C5CE7' : '#E17055' }]}>
                      <Text style={styles.todTypeBadgeText}>{dare.type.toUpperCase()}</Text>
                    </View>
                  </View>
                  <Text style={styles.pendingTime}>{getTimeAgo(dare.createdAt)}</Text>
                </View>
                <Text style={styles.pendingContent}>{dare.content}</Text>
                <View style={styles.pendingActions}>
                  <TouchableOpacity
                    style={styles.declineBtn}
                    onPress={() => declineDare(dare.id)}
                  >
                    <Text style={styles.declineBtnText}>Decline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.acceptBtn}
                    onPress={() => {
                      acceptDare(dare.id);
                      Alert.alert(
                        'Accepted!',
                        `${dare.senderUsername} has been revealed. Check your Private Chats!`
                      );
                    }}
                  >
                    <Text style={styles.acceptBtnText}>Accept</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

function TodPostCard({ item }: { item: TruthOrDarePost }) {
  const isTruth = item.type === 'truth';
  return (
    <View style={styles.todCard}>
      <View style={styles.todHeader}>
        <Image source={{ uri: item.authorPhotoUrl }} style={styles.todAvatar} blurRadius={item.isAnonymous ? 15 : 0} />
        <View style={styles.todAuthorInfo}>
          <Text style={styles.todAuthorName}>{item.isAnonymous ? 'Anonymous' : item.authorName}</Text>
          <Text style={styles.todTime}>{getTimeAgo(item.createdAt)}</Text>
        </View>
        <View style={[styles.todTypeBadge, { backgroundColor: isTruth ? '#6C5CE7' : '#E17055' }]}>
          <Text style={styles.todTypeText}>{isTruth ? 'TRUTH' : 'DARE'}</Text>
        </View>
      </View>
      <Text style={styles.todContent}>{item.content}</Text>
      <View style={styles.todFooter}>
        <View style={styles.todAction}>
          <Ionicons name="chatbubble-outline" size={18} color={C.textLight} />
          <Text style={styles.todActionText}>{item.responseCount} responses</Text>
        </View>
      </View>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   D) ROOMS
   ═══════════════════════════════════════════════════════════════ */
function RoomsSection({ router }: { router: any }) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.listContent}>
      {DEMO_CHAT_ROOMS.map((room) => (
        <TouchableOpacity
          key={room.id}
          style={styles.roomCard}
          onPress={() => router.push(`/(main)/incognito-room/${room.id}` as any)}
          activeOpacity={0.8}
        >
          <View style={[styles.roomIcon, { backgroundColor: room.color + '20' }]}>
            <Ionicons name={room.icon as any} size={24} color={room.color} />
          </View>
          <View style={styles.roomInfo}>
            <Text style={styles.roomName}>{room.name}</Text>
            <Text style={styles.roomLatest} numberOfLines={1}>{room.latestMessage}</Text>
          </View>
          <View style={styles.roomMeta}>
            <View style={styles.roomOnline}>
              <View style={styles.onlineIndicator} />
              <Text style={styles.roomOnlineText}>{room.onlineCount}</Text>
            </View>
            <Text style={styles.roomMembers}>{room.memberCount} members</Text>
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

/* ═══════════════════════════════════════════════════════════════
   C) CHATS — Unlocked Private Conversations
   ═══════════════════════════════════════════════════════════════ */
function ChatsSection({ router }: { router: any }) {
  const conversations = usePrivateChatStore((s) => s.conversations);
  const blockUser = usePrivateChatStore((s) => s.blockUser);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);

  const connectionIcon = (source: string) => {
    switch (source) {
      case 'tod': return 'flame';
      case 'room': return 'chatbubbles';
      case 'desire': return 'heart';
      case 'friend': return 'people';
      default: return 'chatbubble';
    }
  };

  return (
    <>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.listContent}>
        {conversations.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="lock-open-outline" size={64} color={C.textLight} />
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptySubtitle}>Accept a Truth or Dare or connect in a Room to start chatting</Text>
          </View>
        ) : (
          conversations.map((convo) => (
            <TouchableOpacity
              key={convo.id}
              style={styles.chatRow}
              onPress={() => router.push(`/(main)/incognito-chat?id=${convo.id}` as any)}
              onLongPress={() => setReportTarget({ id: convo.participantId, name: convo.participantName })}
              activeOpacity={0.8}
            >
              <View style={styles.chatAvatarWrap}>
                <Image source={{ uri: convo.participantPhotoUrl }} style={styles.chatAvatar} blurRadius={10} />
                <View style={[styles.connectionBadge, { backgroundColor: C.surface }]}>
                  <Ionicons name={connectionIcon(convo.connectionSource) as any} size={10} color={C.primary} />
                </View>
              </View>
              <View style={styles.chatInfo}>
                <View style={styles.chatNameRow}>
                  <Text style={styles.chatName}>{convo.participantName}</Text>
                  <Text style={styles.chatTime}>{getTimeAgo(convo.lastMessageAt)}</Text>
                </View>
                <Text style={styles.chatLastMsg} numberOfLines={1}>{convo.lastMessage}</Text>
              </View>
              {convo.unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>{convo.unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
      {reportTarget && (
        <ReportModal
          visible
          targetName={reportTarget.name}
          onClose={() => setReportTarget(null)}
          onReport={() => setReportTarget(null)}
          onBlock={() => { blockUser(reportTarget.id); setReportTarget(null); }}
        />
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   E) PRIVATE PROFILE — Separate Persona
   ═══════════════════════════════════════════════════════════════ */
function PrivateProfileSection() {
  const { profile, setProfile, markSetup, isSetup } = usePrivateProfileStore();
  const [editing, setEditing] = useState(!isSetup);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio);
  const [selectedDesires, setSelectedDesires] = useState<DesireCategory[]>(profile.desireCategories);
  const [blurPhoto, setBlurPhoto] = useState(profile.blurPhoto);

  const toggleDesire = (cat: DesireCategory) => {
    setSelectedDesires((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleSave = () => {
    if (username.trim().length < 3) {
      Alert.alert('Username too short', 'Must be at least 3 characters.');
      return;
    }
    setProfile({
      username: username.trim(),
      bio: bio.trim(),
      desireCategories: selectedDesires,
      blurPhoto,
    });
    markSetup();
    setEditing(false);
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.profileContent}>
      {/* Avatar preview */}
      <View style={styles.profileAvatarSection}>
        <View style={styles.profileAvatarCircle}>
          <Ionicons name="person" size={48} color={C.textLight} />
        </View>
        <Text style={styles.profileDisplayName}>{profile.username}</Text>
        <View style={styles.blurBadge}>
          <Ionicons name={profile.blurPhoto ? 'eye-off' : 'eye'} size={14} color={C.primary} />
          <Text style={styles.blurBadgeText}>{profile.blurPhoto ? 'Photo blurred' : 'Photo visible'}</Text>
        </View>
      </View>

      {editing ? (
        <>
          {/* Username */}
          <Text style={styles.fieldLabel}>Private Username</Text>
          <TextInput
            style={styles.fieldInput}
            value={username}
            onChangeText={setUsername}
            maxLength={20}
            placeholder="Choose a username..."
            placeholderTextColor={C.textLight}
          />

          {/* Bio */}
          <Text style={styles.fieldLabel}>Private Bio</Text>
          <TextInput
            style={[styles.fieldInput, { minHeight: 80, textAlignVertical: 'top' }]}
            value={bio}
            onChangeText={setBio}
            maxLength={150}
            multiline
            placeholder="Tell people about your private side..."
            placeholderTextColor={C.textLight}
          />

          {/* Desire Categories */}
          <Text style={styles.fieldLabel}>Desire Categories</Text>
          <View style={styles.desirePicker}>
            {ALL_DESIRE_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.desirePickerChip, selectedDesires.includes(cat) && styles.desirePickerChipActive]}
                onPress={() => toggleDesire(cat)}
              >
                <Text style={[styles.desirePickerText, selectedDesires.includes(cat) && styles.desirePickerTextActive]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Blur toggle */}
          <TouchableOpacity style={styles.blurToggle} onPress={() => setBlurPhoto(!blurPhoto)}>
            <View style={styles.blurToggleLeft}>
              <Ionicons name="eye-off" size={20} color={C.textLight} />
              <Text style={styles.blurToggleLabel}>Blur my photo by default</Text>
            </View>
            <Ionicons
              name={blurPhoto ? 'checkbox' : 'square-outline'}
              size={22}
              color={blurPhoto ? C.primary : C.textLight}
            />
          </TouchableOpacity>

          <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
            <Text style={styles.saveBtnText}>Save Profile</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {/* View mode */}
          {profile.bio ? (
            <View style={styles.viewField}>
              <Text style={styles.viewFieldLabel}>Bio</Text>
              <Text style={styles.viewFieldValue}>{profile.bio}</Text>
            </View>
          ) : null}

          {profile.desireCategories.length > 0 && (
            <View style={styles.viewField}>
              <Text style={styles.viewFieldLabel}>Desires</Text>
              <View style={styles.desireRow}>
                {profile.desireCategories.map((cat) => (
                  <View key={cat} style={styles.desireChip}>
                    <Text style={styles.desireChipText}>{cat}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
            <Ionicons name="create-outline" size={18} color={C.primary} />
            <Text style={styles.editBtnText}>Edit Private Profile</Text>
          </TouchableOpacity>

          <View style={styles.privacyNote}>
            <Ionicons name="shield-checkmark" size={18} color={C.textLight} />
            <Text style={styles.privacyNoteText}>
              This profile is separate from your main profile and only visible inside the Private tab.
            </Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

/* ─── Helpers ─── */
function getTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/* ─── Styles ─── */
const C = INCOGNITO_COLORS;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },

  /* Header */
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: C.text, flex: 1, marginLeft: 10 },
  headerRight: { width: 32, alignItems: 'flex-end' },

  /* Section Tabs */
  tabBar: {
    flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: C.surface, gap: 2,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, borderRadius: 20, gap: 4,
  },
  tabActive: { backgroundColor: C.primary + '20' },
  tabLabel: { fontSize: 11, fontWeight: '500', color: C.textLight },
  tabLabelActive: { color: C.primary, fontWeight: '600' },
  tabBadge: {
    position: 'absolute', top: -6, right: -8, minWidth: 16, height: 16,
    borderRadius: 8, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center',
  },
  tabBadgeText: { fontSize: 9, fontWeight: '700', color: '#FFFFFF' },

  /* Sub-tabs (T&D) */
  subTabBar: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, gap: 8,
  },
  subTab: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: C.surface },
  subTabActive: { backgroundColor: C.primary },
  subTabText: { fontSize: 13, fontWeight: '500', color: C.textLight },
  subTabTextActive: { color: '#FFFFFF' },

  /* Grid (Discover) */
  gridContent: { padding: 16 },
  gridRow: { justifyContent: 'space-between' },
  profileCard: {
    width: CARD_WIDTH, borderRadius: 12, overflow: 'hidden',
    backgroundColor: C.surface, marginBottom: 16,
  },
  profileImage: { width: '100%', height: CARD_WIDTH * 1.2, backgroundColor: C.accent },
  onlineDot: {
    position: 'absolute', top: 10, right: 10, width: 10, height: 10,
    borderRadius: 5, backgroundColor: '#00B894', borderWidth: 2, borderColor: C.surface,
  },
  profileInfo: { padding: 10 },
  profileUsername: { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 2 },
  profileAge: { fontSize: 12, color: C.textLight, marginBottom: 6 },
  desireRow: { flexDirection: 'row', gap: 4, marginBottom: 6, flexWrap: 'wrap' },
  desireChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: C.primary + '20' },
  desireChipText: { fontSize: 10, color: C.primary, fontWeight: '500', textTransform: 'capitalize' },
  desireText: { fontSize: 11, color: C.textLight, fontStyle: 'italic', lineHeight: 15, marginBottom: 6 },

  /* Card actions */
  cardActions: { flexDirection: 'row', gap: 6, marginTop: 4 },
  cardActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 6, borderRadius: 8, backgroundColor: C.primary + '15',
  },
  cardActionBtnChat: { backgroundColor: C.primary },
  cardActionBtnLocked: { backgroundColor: C.accent + '30' },
  cardActionText: { fontSize: 11, fontWeight: '600', color: C.primary },
  cardActionTextChat: { fontSize: 11, fontWeight: '600', color: '#FFFFFF' },
  cardActionTextLocked: { fontSize: 10, color: C.textLight },
  cardReportBtn: { position: 'absolute', top: 4, right: 4, padding: 4 },

  /* Truth or Dare */
  todCard: { backgroundColor: C.surface, borderRadius: 12, padding: 16, marginBottom: 12 },
  todHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  todAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.accent },
  todAuthorInfo: { flex: 1, marginLeft: 10 },
  todAuthorName: { fontSize: 14, fontWeight: '600', color: C.text },
  todTime: { fontSize: 11, color: C.textLight },
  todTypeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  todTypeText: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },
  todContent: { fontSize: 15, color: C.text, lineHeight: 22, marginBottom: 12 },
  todFooter: { flexDirection: 'row', alignItems: 'center' },
  todAction: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  todActionText: { fontSize: 12, color: C.textLight },

  /* Pending dares */
  pendingCard: { backgroundColor: C.surface, borderRadius: 12, padding: 16, marginBottom: 12 },
  pendingHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  pendingAvatarWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  pendingInfo: { flex: 1, marginLeft: 10 },
  pendingFrom: { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 4 },
  todTypeBadgeSmall: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, alignSelf: 'flex-start' },
  todTypeBadgeText: { fontSize: 9, fontWeight: '700', color: '#FFFFFF' },
  pendingTime: { fontSize: 11, color: C.textLight },
  pendingContent: { fontSize: 15, color: C.text, lineHeight: 22, marginBottom: 16 },
  pendingActions: { flexDirection: 'row', gap: 12 },
  declineBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    backgroundColor: C.accent + '40',
  },
  declineBtnText: { fontSize: 14, fontWeight: '600', color: C.textLight },
  acceptBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    backgroundColor: C.primary,
  },
  acceptBtnText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },

  /* Rooms */
  roomCard: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    backgroundColor: C.surface, borderRadius: 12, marginBottom: 10,
  },
  roomIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  roomInfo: { flex: 1, marginLeft: 12 },
  roomName: { fontSize: 15, fontWeight: '600', color: C.text, marginBottom: 2 },
  roomLatest: { fontSize: 12, color: C.textLight },
  roomMeta: { alignItems: 'flex-end' },
  roomOnline: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  onlineIndicator: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00B894' },
  roomOnlineText: { fontSize: 11, color: '#00B894', fontWeight: '500' },
  roomMembers: { fontSize: 10, color: C.textLight },

  /* Chats */
  chatRow: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    backgroundColor: C.surface, borderRadius: 12, marginBottom: 8,
  },
  chatAvatarWrap: { position: 'relative' },
  chatAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.accent },
  connectionBadge: {
    position: 'absolute', bottom: -2, right: -2, width: 20, height: 20,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.background,
  },
  chatInfo: { flex: 1, marginLeft: 12 },
  chatNameRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  chatName: { fontSize: 14, fontWeight: '600', color: C.text },
  chatTime: { fontSize: 11, color: C.textLight },
  chatLastMsg: { fontSize: 13, color: C.textLight },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 8,
  },
  unreadText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },

  /* Profile section */
  profileContent: { padding: 20 },
  profileAvatarSection: { alignItems: 'center', marginBottom: 24 },
  profileAvatarCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  profileDisplayName: { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 6 },
  blurBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  blurBadgeText: { fontSize: 12, color: C.primary },

  fieldLabel: { fontSize: 13, fontWeight: '600', color: C.textLight, marginTop: 16, marginBottom: 6 },
  fieldInput: {
    backgroundColor: C.surface, borderRadius: 10, padding: 12,
    fontSize: 14, color: C.text,
  },
  desirePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  desirePickerChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.surface,
  },
  desirePickerChipActive: { backgroundColor: C.primary + '20', borderColor: C.primary },
  desirePickerText: { fontSize: 13, color: C.textLight, textTransform: 'capitalize' },
  desirePickerTextActive: { color: C.primary, fontWeight: '600' },
  blurToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14, backgroundColor: C.surface, borderRadius: 10, marginTop: 16,
  },
  blurToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  blurToggleLabel: { fontSize: 14, color: C.text },
  saveBtn: {
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginTop: 24,
  },
  saveBtnText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },

  viewField: { marginBottom: 16 },
  viewFieldLabel: { fontSize: 12, fontWeight: '600', color: C.textLight, marginBottom: 6 },
  viewFieldValue: { fontSize: 14, color: C.text, lineHeight: 20 },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: 12, backgroundColor: C.surface, marginTop: 16,
  },
  editBtnText: { fontSize: 14, fontWeight: '600', color: C.primary },
  privacyNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 14, backgroundColor: C.surface, borderRadius: 10, marginTop: 20,
  },
  privacyNoteText: { flex: 1, fontSize: 12, color: C.textLight, lineHeight: 18 },

  /* Modals */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: C.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  todTypeRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  todTypeBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    backgroundColor: C.surface,
  },
  todTypeBtnTruth: { backgroundColor: '#6C5CE7' },
  todTypeBtnDare: { backgroundColor: '#E17055' },
  todTypeBtnText: { fontSize: 14, fontWeight: '600', color: C.textLight },
  todTypeBtnTextActive: { color: '#FFFFFF' },
  modalInput: {
    backgroundColor: C.surface, borderRadius: 10, padding: 14,
    fontSize: 14, color: C.text, minHeight: 80, textAlignVertical: 'top',
  },
  modalHint: { fontSize: 11, color: C.textLight, marginTop: 8, fontStyle: 'italic' },
  modalSendBtn: {
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginTop: 16,
  },
  modalSendBtnDisabled: { backgroundColor: C.surface },
  modalSendBtnText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },

  /* Shared */
  listContent: { padding: 16 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: 40, marginTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: C.text, marginTop: 16, marginBottom: 8 },
  emptySubtitle: { fontSize: 13, color: C.textLight, textAlign: 'center' },
});
