import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';

export default function DaresScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();

  const pendingDares = useQuery(
    api.dares.getPendingDares,
    userId ? { userId: userId as any } : 'skip'
  );

  const daresSent = useQuery(
    api.dares.getDaresSent,
    userId ? { userId: userId as any } : 'skip'
  );

  const acceptDare = useMutation(api.dares.acceptDare);
  const declineDare = useMutation(api.dares.declineDare);

  const handleAccept = async (dareId: string) => {
    if (!userId) return;

    Alert.alert(
      'Accept Dare?',
      'Accepting this dare will reveal both identities and create a match!',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          onPress: async () => {
            try {
              const result = await acceptDare({
                dareId: dareId as any,
                userId: userId as any,
              });
              Alert.alert(
                '🎉 It\'s a Match!',
                `You matched with ${result.fromUser.name}!`,
                [
                  {
                    text: 'Start Chatting',
                    onPress: () => router.push('/(main)/(tabs)/messages'),
                  },
                ]
              );
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to accept dare');
            }
          },
        },
      ]
    );
  };

  const handleDecline = async (dareId: string) => {
    if (!userId) return;

    Alert.alert('Decline Dare?', 'Are you sure you want to decline this dare?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: async () => {
          try {
            await declineDare({
              dareId: dareId as any,
              userId: userId as any,
            });
          } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to decline dare');
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Truth or Dare</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.tabs}>
        <Text style={styles.tabTitle}>Pending Dares</Text>
      </View>

      <FlatList
        data={pendingDares || []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.dareCard}>
            <View style={styles.dareHeader}>
              <Ionicons name="dice" size={24} color={COLORS.secondary} />
              <Text style={styles.dareTitle}>Anonymous Dare</Text>
            </View>
            <Text style={styles.dareContent}>{item.content}</Text>
            <View style={styles.dareActions}>
              <Button
                title="Decline"
                variant="outline"
                onPress={() => handleDecline(item.id)}
                style={styles.declineButton}
              />
              <Button
                title="Accept & Match"
                variant="primary"
                onPress={() => handleAccept(item.id)}
                style={styles.acceptButton}
              />
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="dice-outline" size={64} color={COLORS.textLight} />
            <Text style={styles.emptyTitle}>No pending dares</Text>
            <Text style={styles.emptySubtitle}>
              Dares you receive will appear here
            </Text>
          </View>
        }
      />
    </View>
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
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  tabs: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tabTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  dareCard: {
    backgroundColor: COLORS.backgroundDark,
    margin: 16,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  dareTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginLeft: 12,
  },
  dareContent: {
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 24,
    marginBottom: 20,
  },
  dareActions: {
    flexDirection: 'row',
    gap: 12,
  },
  declineButton: {
    flex: 1,
  },
  acceptButton: {
    flex: 1,
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
    lineHeight: 20,
  },
});
