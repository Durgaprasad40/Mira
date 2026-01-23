import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { COLORS } from '@/lib/constants';
import { PhotoCarousel } from './PhotoCarousel';
import { MatchQualityIndicator } from './MatchQualityIndicator';

export interface ProfileCardProps {
  name: string;
  age: number;
  bio?: string;
  city?: string;
  isVerified?: boolean;
  distance?: number;
  photos: { url: string }[];
  matchQuality?: number; // 0-5 score
  showCarousel?: boolean;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({
  name,
  age,
  bio,
  city,
  isVerified,
  distance,
  photos,
  matchQuality,
  showCarousel = false,
}) => {
  const mainPhoto = photos[0];

  return (
    <View style={styles.card}>
      {showCarousel && photos.length > 1 ? (
        <PhotoCarousel photos={photos} height={styles.card.height} />
      ) : mainPhoto ? (
        <Image
          source={{ uri: mainPhoto.url }}
          style={styles.image}
          contentFit="cover"
        />
      ) : null}

      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.headerRow}>
          <View>
            <View style={styles.nameRow}>
              <Text style={styles.name}>
                {name}, {age}
              </Text>
              {isVerified && <Text style={styles.verified}>✔︎</Text>}
            </View>
            {!!city && <Text style={styles.city}>{city}</Text>}
          </View>
          {!!distance && (
            <Text style={styles.distance}>{distance.toFixed(0)} km away</Text>
          )}
        </View>

        {!!bio && (
          <Text style={styles.bio} numberOfLines={3}>
            {bio}
          </Text>
        )}
        {matchQuality !== undefined && (
          <View style={styles.matchQualityContainer}>
            <MatchQualityIndicator score={matchQuality} />
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundDark,
    flex: 1,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.white,
    marginRight: 6,
  },
  verified: {
    fontSize: 16,
    color: COLORS.primary,
  },
  city: {
    fontSize: 14,
    color: COLORS.white,
  },
  distance: {
    fontSize: 14,
    color: COLORS.white,
  },
  bio: {
    fontSize: 14,
    color: COLORS.white,
  },
  matchQualityContainer: {
    marginTop: 8,
  },
});

