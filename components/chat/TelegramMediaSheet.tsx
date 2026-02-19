/**
 * TelegramMediaSheet - Telegram-style bottom sheet for camera + gallery media selection.
 *
 * Features:
 * - Camera tile at top (expandable to full camera view)
 * - Gallery grid with recent photos + videos (Dev Build only)
 * - "All Photos" tile when MediaLibrary shows limited results
 * - Photo capture (tap shutter)
 * - Video capture (long press shutter, max 30s)
 * - Preview with OK/Retake
 * - Routes selected/captured media to existing Secure Photo flow
 * - Pagination/infinite scroll for gallery grid
 *
 * Environment Handling:
 * - EXPO GO: Auto-launches camera immediately; small gallery link available
 * - DEV BUILD: Uses expo-media-library for Telegram-style grid with pagination
 *
 * Android 13+ Permission Handling:
 * - Detects accessPrivileges: 'all' | 'limited' | 'none'
 * - Shows banner for LIMITED access with "Open Settings" + "Refresh" buttons
 * - Only "all" access provides the full Telegram grid experience
 *
 * Hybrid Approach:
 * - MediaLibrary grid shows recent thumbnails (best effort)
 * - "All Photos" tile always provides access to full system gallery picker
 * - Guarantees users can access ALL photos/videos even if MediaLibrary is limited
 *
 * Safety:
 * - mountedRef guards all setState after async operations
 * - busy state prevents duplicate permission requests
 * - All async calls wrapped in try/catch (no unhandled rejections)
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  FlatList,
  Dimensions,
  Alert,
  ActivityIndicator,
  Linking,
  AppState,
} from 'react-native';
import { Image } from 'expo-image';
import { CameraView, Camera } from 'expo-camera';
import type { CameraType } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/lib/constants';
import Constants from 'expo-constants';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.7;
const THUMBNAIL_SIZE = (SCREEN_WIDTH - 6) / 3; // Telegram-style: 1px edge + 2px gaps
const MAX_VIDEO_DURATION_MS = 30000; // 30 seconds

// Pagination config
const INITIAL_FETCH_COUNT = 200;
const LOAD_MORE_COUNT = 100;

// Show "All Photos" tile if total count is below this threshold
const SHOW_ALL_PHOTOS_THRESHOLD = 80;

// Detect Expo Go vs Dev Build
const isExpoGo = Constants.appOwnership === 'expo';

interface TelegramMediaSheetProps {
  visible: boolean;
  onSelectMedia: (uri: string, type: 'photo' | 'video') => void;
  onClose: () => void;
}

interface GalleryAsset {
  id: string;
  uri: string;
  mediaType: 'photo' | 'video';
  duration?: number;
}

// Special items for camera tile and "All Photos" tile
interface GalleryItem extends GalleryAsset {
  isCameraTile?: boolean;
  isAllPhotosTile?: boolean;
}

// Permission states
type PermissionState =
  | 'checking'      // Initial state, checking permissions
  | 'denied'        // One or both permissions not granted
  | 'granted';      // Both permissions granted, ready to show UI

// Access privilege states (Android 13+)
type AccessPrivilege = 'all' | 'limited' | 'none';

export function TelegramMediaSheet({
  visible,
  onSelectMedia,
  onClose,
}: TelegramMediaSheetProps) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);

  // Safety refs
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const expoGoLaunchRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const systemPickerRef = useRef(false);

  // Permission state
  const [permissionState, setPermissionState] = useState<PermissionState>('checking');
  const [accessPrivilege, setAccessPrivilege] = useState<AccessPrivilege>('all');
  const [busy, setBusy] = useState(false);

  // State
  const [cameraExpanded, setCameraExpanded] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<CameraType>('back');
  const [galleryAssets, setGalleryAssets] = useState<GalleryAsset[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Pagination state
  const [endCursor, setEndCursor] = useState<string | undefined>(undefined);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  // Camera mode: Photo or Video (explicit toggle, no long-press)
  const [cameraMode, setCameraMode] = useState<'photo' | 'video'>('photo');

  // Recording state machine: idle -> starting -> recording -> stopping
  type RecordingState = 'idle' | 'starting' | 'recording' | 'stopping';
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Legacy isRecording for backward compatibility (derived from state machine)
  const isRecording = recordingState === 'recording' || recordingState === 'starting' || recordingState === 'stopping';

  // Video recording refs for robust promise-based recording
  const recordStartAtRef = useRef<number | null>(null); // Timestamp when recording started
  const recordingActiveRef = useRef(false); // True while recordAsync is in progress (prevents race)
  const recordStoppedRef = useRef(false); // True when stop was requested (to differentiate from error)
  const recordPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null); // The recordAsync promise
  const micPermissionChecked = useRef(false); // Track if mic permission was already checked this session
  const hasMicPermission = useRef(false); // Cached mic permission result
  const stopRecordingFnRef = useRef<() => void>(() => {}); // Latest handleStopRecording for interval

  // Preview state
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<'photo' | 'video'>('photo');

  // Determine if we should show "All Photos" tile
  // Show it when MediaLibrary returns few items OR no more pages
  const shouldShowAllPhotosTile =
    galleryAssets.length > 0 &&
    (totalCount < SHOW_ALL_PHOTOS_THRESHOLD || (!hasNextPage && galleryAssets.length < totalCount));

  // Camera tile - always first item in grid
  const cameraTileItem: GalleryItem = { id: '__camera_tile__', uri: '', mediaType: 'photo', isCameraTile: true };

  // Build the grid data: camera tile first, then gallery assets, then optional "All Photos" tile
  const gridData: GalleryItem[] = [
    cameraTileItem,
    ...galleryAssets,
    ...(shouldShowAllPhotosTile ? [{ id: '__all_photos__', uri: '', mediaType: 'photo' as const, isAllPhotosTile: true }] : []),
  ];

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Stop any active recording on unmount
      if (recordingActiveRef.current && cameraRef.current) {
        try {
          cameraRef.current.stopRecording();
        } catch {
          // Ignore
        }
      }
      recordingActiveRef.current = false;
      recordStoppedRef.current = false;
      recordStartAtRef.current = null;
      recordPromiseRef.current = null;
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, []);

  // Reset state when sheet closes (fix stuck loading)
  useEffect(() => {
    if (!visible) {
      // Sheet closed - reset all Expo Go state
      expoGoLaunchRef.current = false;
      busyRef.current = false;
      loadingMoreRef.current = false;
      systemPickerRef.current = false;
      if (mountedRef.current) {
        setBusy(false);
        setIsLoadingMore(false);
      }
    }
  }, [visible]);

  // EXPO GO: Auto-launch camera immediately when sheet opens
  useEffect(() => {
    if (visible && isExpoGo && !expoGoLaunchRef.current && !previewUri) {
      expoGoLaunchRef.current = true;
      void launchExpoGoCamera();
    }
  }, [visible, previewUri]);

  // DEV BUILD: Check permissions when sheet opens
  useEffect(() => {
    if (visible && !isExpoGo && permissionState === 'checking') {
      void checkExistingPermissions();
    }
  }, [visible, permissionState]);

  // AppState listener: invalidate mic permission cache when returning from Settings
  useEffect(() => {
    if (!visible) return;

    const handleAppStateChange = (nextState: string) => {
      if (nextState === 'active' && mountedRef.current) {
        // User returned to app - if mic was denied, invalidate cache so next
        // video recording attempt re-checks via checkMicPermission()
        if (micPermissionChecked.current && !hasMicPermission.current) {
          micPermissionChecked.current = false;
          console.log('[TelegramMediaSheet] Mic permission cache invalidated for re-check');
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [visible]);

  // EXPO GO: Launch camera directly
  const launchExpoGoCamera = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);

    try {
      // Request camera permission if needed
      const { granted } = await ImagePicker.getCameraPermissionsAsync();
      if (!granted) {
        const { granted: newGranted } = await ImagePicker.requestCameraPermissionsAsync();
        if (!newGranted) {
          // Permission denied - close sheet
          closeExpoGoSheet();
          return;
        }
      }

      if (!mountedRef.current) return;

      // Launch camera immediately
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.8,
        allowsEditing: false,
        videoMaxDuration: 30,
      });

      if (!mountedRef.current) return;

      if (result.canceled || !result.assets || result.assets.length === 0) {
        // User cancelled or no assets - close sheet
        closeExpoGoSheet();
      } else {
        // Media captured - show preview
        const asset = result.assets[0];
        setBusy(false);
        busyRef.current = false;
        setPreviewUri(asset.uri);
        setPreviewType(asset.type === 'video' ? 'video' : 'photo');
      }
    } catch (error) {
      console.warn('[TelegramMediaSheet] launchExpoGoCamera failed:', error);
      closeExpoGoSheet();
    }
  };

  // EXPO GO: Launch gallery picker (via small link)
  const launchExpoGoGallery = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);

    try {
      // Request permission if needed
      const { granted } = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (!granted) {
        const { granted: newGranted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!newGranted) {
          closeExpoGoSheet();
          return;
        }
      }

      if (!mountedRef.current) return;

      // Launch gallery picker with photos + videos
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 1,
        allowsEditing: false,
      });

      if (!mountedRef.current) return;

      if (result.canceled || !result.assets || result.assets.length === 0) {
        // User cancelled - close sheet
        closeExpoGoSheet();
      } else {
        // Media selected - show preview
        const asset = result.assets[0];
        setBusy(false);
        busyRef.current = false;
        setPreviewUri(asset.uri);
        setPreviewType(asset.type === 'video' ? 'video' : 'photo');
      }
    } catch (error) {
      console.warn('[TelegramMediaSheet] launchExpoGoGallery failed:', error);
      closeExpoGoSheet();
    }
  };

  // EXPO GO: Clean close helper (prevents stuck state)
  const closeExpoGoSheet = () => {
    // Reset state first
    expoGoLaunchRef.current = false;
    busyRef.current = false;
    if (mountedRef.current) {
      setBusy(false);
    }
    // Close on next tick to avoid race conditions
    setTimeout(() => {
      if (mountedRef.current) {
        onClose();
      }
    }, 0);
  };

  // DEV BUILD: CHECK existing permissions (no prompts) - called on sheet open
  const checkExistingPermissions = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);

    try {
      // Step 1: Check camera permission (no prompt)
      let cameraGranted = false;
      try {
        const cameraStatus = await Camera.getCameraPermissionsAsync();
        cameraGranted = cameraStatus.granted;
        console.warn('[TelegramMediaSheet][Assets] Camera permission:', {
          granted: cameraStatus.granted,
          status: cameraStatus.status,
          canAskAgain: cameraStatus.canAskAgain,
        });
      } catch (err) {
        console.warn('[TelegramMediaSheet][Assets] getCameraPermissionsAsync failed:', err);
      }

      if (!mountedRef.current) return;

      // Step 2: Check media library permission (Dev Build only)
      let mediaGranted = false;
      let mediaAccessPrivileges: AccessPrivilege = 'none';
      try {
        const mediaStatus = await MediaLibrary.getPermissionsAsync();
        mediaGranted = mediaStatus.granted;
        // Android 13+ returns accessPrivileges: 'all' | 'limited' | 'none'
        const rawPrivileges = (mediaStatus as any).accessPrivileges;
        if (rawPrivileges === 'all' || rawPrivileges === 'limited' || rawPrivileges === 'none') {
          mediaAccessPrivileges = rawPrivileges;
        } else if (mediaGranted) {
          // Fallback for older Android or iOS
          mediaAccessPrivileges = 'all';
        }
        console.warn('[TelegramMediaSheet][Assets] MediaLibrary permission:', {
          granted: mediaStatus.granted,
          status: mediaStatus.status,
          accessPrivileges: mediaAccessPrivileges,
          canAskAgain: mediaStatus.canAskAgain,
        });
      } catch (err) {
        console.warn('[TelegramMediaSheet][Assets] MediaLibrary.getPermissionsAsync failed:', err);
      }

      if (!mountedRef.current) return;

      // Update access privilege state
      setAccessPrivilege(mediaAccessPrivileges);

      // If both granted (even with limited access), load assets and show UI
      if (cameraGranted && mediaGranted) {
        await loadGalleryAssets();
        if (!mountedRef.current) return;
        setPermissionState('granted');
      } else {
        // At least one permission missing - show grant screen
        setPermissionState('denied');
      }
    } catch (error) {
      console.warn('[TelegramMediaSheet][Assets] checkExistingPermissions error:', error);
      if (mountedRef.current) {
        setPermissionState('denied');
      }
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
      busyRef.current = false;
    }
  };

  // DEV BUILD: Diagnose album visibility
  const diagnoseAlbums = async () => {
    try {
      // Get all albums including smart albums (Camera Roll, etc.)
      const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });

      // Log album count
      console.warn('[TelegramMediaSheet][Albums] Total albums:', albums.length);

      // Log top 5 albums by asset count
      const sortedAlbums = [...albums].sort((a, b) => (b.assetCount || 0) - (a.assetCount || 0));
      const top5 = sortedAlbums.slice(0, 5);
      console.warn('[TelegramMediaSheet][Albums] Top 5 albums:',
        top5.map(a => ({ title: a.title, assetCount: a.assetCount }))
      );

      // Calculate total assets across all albums
      const totalAlbumAssets = albums.reduce((sum, a) => sum + (a.assetCount || 0), 0);
      console.warn('[TelegramMediaSheet][Albums] Total assets across all albums:', totalAlbumAssets);

      return albums;
    } catch (error) {
      console.warn('[TelegramMediaSheet][Albums] getAlbumsAsync failed:', error);
      return [];
    }
  };

  // DEV BUILD: Load gallery assets (initial load with photos + videos)
  const loadGalleryAssets = async () => {
    if (!mountedRef.current || isExpoGo) return;
    setIsLoadingAssets(true);

    // Reset pagination state
    setEndCursor(undefined);
    setHasNextPage(false);
    setTotalCount(0);

    try {
      // First, diagnose album visibility
      await diagnoseAlbums();

      console.warn('[TelegramMediaSheet][Assets] Loading assets (photos + videos, no album restriction)...');

      // Query all assets without album restriction
      const assets = await MediaLibrary.getAssetsAsync({
        first: INITIAL_FETCH_COUNT,
        sortBy: [MediaLibrary.SortBy.creationTime],
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        // No album specified = query all accessible assets
      });

      console.warn('[TelegramMediaSheet][Assets] Initial load result:', {
        totalCount: assets.totalCount,
        assetsLength: assets.assets.length,
        firstAssetUri: assets.assets[0]?.uri ?? 'none',
        hasNextPage: assets.hasNextPage,
        endCursor: assets.endCursor,
      });

      if (!mountedRef.current) return;

      // Update pagination state
      setEndCursor(assets.endCursor);
      setHasNextPage(assets.hasNextPage);
      setTotalCount(assets.totalCount);

      // Dedupe by id and set assets
      const uniqueAssets = dedupeAssetsById(assets.assets);
      setGalleryAssets(
        uniqueAssets.map((a) => ({
          id: a.id,
          uri: a.uri,
          mediaType: a.mediaType === MediaLibrary.MediaType.video ? 'video' : 'photo',
          duration: a.duration,
        }))
      );

      console.warn('[TelegramMediaSheet][Assets] Gallery assets set:', uniqueAssets.length);
    } catch (error) {
      console.warn('[TelegramMediaSheet][Assets] getAssetsAsync failed:', error);
      if (mountedRef.current) {
        setGalleryAssets([]);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoadingAssets(false);
      }
    }
  };

  // DEV BUILD: Load more assets (pagination)
  const loadMoreAssets = async () => {
    if (!mountedRef.current || isExpoGo) return;
    if (!hasNextPage || !endCursor) return;
    if (loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      console.warn('[TelegramMediaSheet][Assets] Loading more assets after cursor:', endCursor);
      const assets = await MediaLibrary.getAssetsAsync({
        first: LOAD_MORE_COUNT,
        after: endCursor,
        sortBy: [MediaLibrary.SortBy.creationTime],
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      });

      console.warn('[TelegramMediaSheet][Assets] Load more result:', {
        assetsLength: assets.assets.length,
        hasNextPage: assets.hasNextPage,
        endCursor: assets.endCursor,
      });

      if (!mountedRef.current) return;

      // Update pagination state
      setEndCursor(assets.endCursor);
      setHasNextPage(assets.hasNextPage);

      // Dedupe and append new assets
      const newAssets = assets.assets.map((a) => ({
        id: a.id,
        uri: a.uri,
        mediaType: a.mediaType === MediaLibrary.MediaType.video ? 'video' as const : 'photo' as const,
        duration: a.duration,
      }));

      setGalleryAssets((prev) => {
        const existingIds = new Set(prev.map((a) => a.id));
        const uniqueNew = newAssets.filter((a) => !existingIds.has(a.id));
        return [...prev, ...uniqueNew];
      });
    } catch (error) {
      console.warn('[TelegramMediaSheet][Assets] loadMoreAssets failed:', error);
    } finally {
      loadingMoreRef.current = false;
      if (mountedRef.current) {
        setIsLoadingMore(false);
      }
    }
  };

  // Dedupe assets by id
  const dedupeAssetsById = (assets: MediaLibrary.Asset[]): MediaLibrary.Asset[] => {
    const seen = new Set<string>();
    return assets.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  };

  // DEV BUILD: Open system picker for ALL photos/videos
  const handleOpenSystemPicker = async () => {
    if (systemPickerRef.current || busyRef.current) return;
    systemPickerRef.current = true;
    setBusy(true);

    try {
      console.warn('[TelegramMediaSheet][Assets] Opening system picker...');

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 1,
        allowsEditing: false,
      });

      if (!mountedRef.current) return;

      if (result.canceled || !result.assets || result.assets.length === 0) {
        // User cancelled - stay on sheet, don't close
        console.warn('[TelegramMediaSheet][Assets] System picker cancelled');
      } else {
        // Media selected - show preview
        const asset = result.assets[0];
        console.warn('[TelegramMediaSheet][Assets] System picker selected:', asset.type);
        setPreviewUri(asset.uri);
        setPreviewType(asset.type === 'video' ? 'video' : 'photo');
      }
    } catch (error) {
      console.warn('[TelegramMediaSheet][Assets] System picker failed:', error);
    } finally {
      systemPickerRef.current = false;
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  };

  // DEV BUILD: Refresh gallery - re-check permissions and reload assets
  const handleRefreshGallery = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);

    try {
      // Re-check media library permission to get fresh accessPrivileges
      let mediaAccessPrivileges: AccessPrivilege = 'none';
      try {
        const mediaStatus = await MediaLibrary.getPermissionsAsync();
        const rawPrivileges = (mediaStatus as any).accessPrivileges;
        if (rawPrivileges === 'all' || rawPrivileges === 'limited' || rawPrivileges === 'none') {
          mediaAccessPrivileges = rawPrivileges;
        } else if (mediaStatus.granted) {
          mediaAccessPrivileges = 'all';
        }
        console.warn('[TelegramMediaSheet][Assets] Refresh - MediaLibrary permission:', {
          granted: mediaStatus.granted,
          accessPrivileges: mediaAccessPrivileges,
        });
      } catch (err) {
        console.warn('[TelegramMediaSheet][Assets] Refresh - getPermissionsAsync failed:', err);
      }

      if (!mountedRef.current) return;

      // Update access privilege state
      setAccessPrivilege(mediaAccessPrivileges);

      // Reload assets
      await loadGalleryAssets();
    } catch (error) {
      console.warn('[TelegramMediaSheet][Assets] handleRefreshGallery error:', error);
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
      busyRef.current = false;
    }
  };

  // DEV BUILD: Open settings for limited access
  const handleOpenSettings = () => {
    try {
      Linking.openSettings();
    } catch {
      // Ignore errors
    }
  };

  // DEV BUILD: Handle "Grant Permissions" button - REQUEST permissions here
  const handleGrantPermissions = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);

    try {
      // Request camera permission
      let cameraGranted = false;
      try {
        const cameraStatus = await Camera.getCameraPermissionsAsync();
        if (cameraStatus.granted) {
          cameraGranted = true;
        } else {
          const result = await Camera.requestCameraPermissionsAsync();
          cameraGranted = result.granted;
        }
        console.warn('[TelegramMediaSheet][Assets] Camera permission after request:', cameraGranted);
      } catch (err) {
        console.warn('[TelegramMediaSheet][Assets] Camera permission request failed:', err);
      }

      if (!mountedRef.current) return;

      // Request media library permission (photos + videos)
      let mediaGranted = false;
      let mediaAccessPrivileges: AccessPrivilege = 'none';
      try {
        const mediaStatus = await MediaLibrary.getPermissionsAsync();
        if (mediaStatus.granted) {
          mediaGranted = true;
          const rawPrivileges = (mediaStatus as any).accessPrivileges;
          mediaAccessPrivileges = rawPrivileges === 'all' || rawPrivileges === 'limited' ? rawPrivileges : 'all';
        } else {
          // Request full access (false = don't request write-only)
          const result = await MediaLibrary.requestPermissionsAsync(false);
          mediaGranted = result.granted;
          const rawPrivileges = (result as any).accessPrivileges;
          if (rawPrivileges === 'all' || rawPrivileges === 'limited' || rawPrivileges === 'none') {
            mediaAccessPrivileges = rawPrivileges;
          } else if (mediaGranted) {
            mediaAccessPrivileges = 'all';
          }
        }
        console.warn('[TelegramMediaSheet][Assets] MediaLibrary permission after request:', {
          granted: mediaGranted,
          accessPrivileges: mediaAccessPrivileges,
        });
      } catch (err) {
        console.warn('[TelegramMediaSheet][Assets] MediaLibrary permission request failed:', err);
      }

      if (!mountedRef.current) return;

      // Update access privilege state
      setAccessPrivilege(mediaAccessPrivileges);

      if (cameraGranted && mediaGranted) {
        // Both granted - load assets and show UI
        await loadGalleryAssets();
        if (!mountedRef.current) return;
        setPermissionState('granted');
      } else {
        // Still missing permissions - offer to open settings
        Alert.alert(
          'Permissions Required',
          'Camera and gallery permissions are required. Please enable them in Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => { try { Linking.openSettings(); } catch {} } },
          ]
        );
        if (mountedRef.current) {
          setPermissionState('denied');
        }
      }
    } catch (error) {
      console.warn('[TelegramMediaSheet][Assets] handleGrantPermissions error:', error);
      if (mountedRef.current) {
        setPermissionState('denied');
      }
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
      busyRef.current = false;
    }
  };

  // Check/request mic permission for video recording using Camera API (cached to avoid repeated prompts)
  const checkMicPermission = async (): Promise<boolean> => {
    // Return cached result if already checked this session
    if (micPermissionChecked.current) {
      return hasMicPermission.current;
    }

    try {
      // First check current status without prompting (use Camera API for video recording)
      let micStatus = await Camera.getMicrophonePermissionsAsync();
      console.log('[TelegramMediaSheet][Video] Mic permission status:', micStatus.status);

      if (micStatus.granted) {
        micPermissionChecked.current = true;
        hasMicPermission.current = true;
        return true;
      }

      // Only request if can ask again (avoid re-prompting if denied)
      if (micStatus.canAskAgain) {
        console.log('[TelegramMediaSheet][Video] Requesting mic permission...');
        micStatus = await Camera.requestMicrophonePermissionsAsync();
        micPermissionChecked.current = true;
        hasMicPermission.current = micStatus.granted;
        console.log('[TelegramMediaSheet][Video] Mic permission result:', micStatus.granted);
        return hasMicPermission.current;
      }

      // Permission was denied previously and can't ask again
      console.log('[TelegramMediaSheet][Video] Mic permission denied, cannot ask again');
      micPermissionChecked.current = true;
      hasMicPermission.current = false;
      return false;
    } catch (error) {
      console.warn('[TelegramMediaSheet][Video] Mic permission check failed:', error);
      micPermissionChecked.current = true;
      hasMicPermission.current = false;
      return false;
    }
  };

  // Expand camera to full screen (Dev Build only)
  const handleExpandCamera = () => {
    setCameraExpanded(true);
  };

  // Take photo
  const handleTakePhoto = async () => {
    if (!cameraRef.current) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
      });
      if (!mountedRef.current) return;
      if (photo?.uri) {
        setPreviewUri(photo.uri);
        setPreviewType('photo');
      }
    } catch (error) {
      console.warn('[TelegramMediaSheet] Photo capture failed:', error);
      if (mountedRef.current) {
        Alert.alert('Error', 'Failed to capture photo. Please try again.');
      }
    }
  };

  // Minimum recording duration to avoid "stopped before data" errors
  const MIN_RECORDING_DURATION_MS = 600;

  // Start video recording (tap in Video mode)
  const handleStartRecording = async () => {
    console.log('[TelegramMediaSheet][Video] Start pressed, current state:', recordingState);

    // Guard: only start from idle state
    if (recordingState !== 'idle') {
      console.log('[TelegramMediaSheet][Video] Not in idle state, ignoring start');
      return;
    }

    // Guard: already recording (ref-based check for race conditions)
    if (recordingActiveRef.current) {
      console.log('[TelegramMediaSheet][Video] Already recording (ref), ignoring');
      return;
    }

    if (!cameraRef.current) {
      console.log('[TelegramMediaSheet][Video] No camera ref');
      return;
    }

    // Transition to 'starting' state
    setRecordingState('starting');

    // Mark recording as active
    recordingActiveRef.current = true;
    recordStoppedRef.current = false;
    recordStartAtRef.current = Date.now();

    try {
      // Check mic permission BEFORE starting recording (cached)
      const hasMic = await checkMicPermission();
      if (!mountedRef.current) {
        recordingActiveRef.current = false;
        setRecordingState('idle');
        return;
      }

      console.log('[TelegramMediaSheet][Video] Mic permission:', hasMic ? 'granted' : 'denied');

      // Update UI state
      setRecordingDuration(0);

      console.log('[TelegramMediaSheet][Video] Recording started at:', recordStartAtRef.current);

      // Transition to 'recording' state
      setRecordingState('recording');

      // Start duration timer
      recordingTimerRef.current = setInterval(() => {
        if (!mountedRef.current || recordStartAtRef.current === null) {
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          return;
        }
        const elapsed = Date.now() - recordStartAtRef.current;
        setRecordingDuration(elapsed);

        if (elapsed >= MAX_VIDEO_DURATION_MS) {
          stopRecordingFnRef.current();
        }
      }, 100);

      // Create and store the promise - this resolves when recording stops
      // Note: expo-camera recordAsync doesn't support 'mute' option,
      // but proper mic permission handling should prevent the error
      recordPromiseRef.current = cameraRef.current.recordAsync({
        maxDuration: MAX_VIDEO_DURATION_MS / 1000,
      });

      // Await the promise
      const video = await recordPromiseRef.current;

      // Recording complete - calculate duration
      const duration = recordStartAtRef.current ? Date.now() - recordStartAtRef.current : 0;
      const wasStoppedByUser = recordStoppedRef.current;

      console.log('[TelegramMediaSheet][Video] recordAsync resolved, uri:', video?.uri, 'duration:', duration, 'stoppedByUser:', wasStoppedByUser);

      // Clean up refs
      recordingActiveRef.current = false;
      recordStoppedRef.current = false;
      recordStartAtRef.current = null;
      recordPromiseRef.current = null;

      if (!mountedRef.current) return;

      // Show preview if we have a valid video URI
      if (video?.uri) {
        console.log('[TelegramMediaSheet][Video] Preview opened, uri:', video.uri);
        setPreviewUri(video.uri);
        setPreviewType('video');
      } else {
        console.log('[TelegramMediaSheet][Video] No video URI returned');
      }
    } catch (error: any) {
      // Clean up refs on error
      const duration = recordStartAtRef.current ? Date.now() - recordStartAtRef.current : 0;
      const wasStoppedByUser = recordStoppedRef.current;
      const hadMicPermission = hasMicPermission.current;

      recordingActiveRef.current = false;
      recordStoppedRef.current = false;
      recordStartAtRef.current = null;
      recordPromiseRef.current = null;

      const errorMsg = error?.message || String(error);
      const isStoppedBeforeData = errorMsg.includes('stopped before any data') || errorMsg.includes('Recording was stopped');

      // Determine cause and show appropriate message
      if (duration < MIN_RECORDING_DURATION_MS) {
        // Too short - treat as cancel (no error message)
        console.log('[TelegramMediaSheet][Video] Recording too short, cancelled (duration:', duration, ')');
      } else if (isStoppedBeforeData && !hadMicPermission) {
        // Likely mic permission issue - show helpful message
        console.warn('[TelegramMediaSheet][Video] Failed likely due to mic permission, duration:', duration);
        if (mountedRef.current) {
          Alert.alert(
            'Microphone Required',
            'Video recording requires microphone access. Please enable microphone permission in Settings.',
            [{ text: 'OK' }]
          );
        }
      } else if (isStoppedBeforeData && duration >= MIN_RECORDING_DURATION_MS) {
        // Stopped before data but duration was valid - likely recorder didn't start properly
        console.warn('[TelegramMediaSheet][Video] Failed - recorder may not have started, duration:', duration, 'hasMic:', hadMicPermission);
        if (mountedRef.current) {
          Alert.alert(
            'Recording Failed',
            'Video recording failed to start. Please try again or check app permissions.',
            [{ text: 'OK' }]
          );
        }
      } else {
        // Other unexpected error
        console.warn('[TelegramMediaSheet][Video] Recording error:', errorMsg, 'duration:', duration, 'stoppedByUser:', wasStoppedByUser);
        if (mountedRef.current && !wasStoppedByUser) {
          Alert.alert('Recording Error', 'Failed to record video. Please try again.');
        }
      }
    } finally {
      if (mountedRef.current) {
        setRecordingState('idle');
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  // Stop video recording (tap in Video mode when recording)
  const handleStopRecording = useCallback(() => {
    console.log('[TelegramMediaSheet][Video] Stop requested, current state:', recordingState);

    // Only allow stop when in 'recording' state (not 'starting' or 'stopping')
    if (recordingState !== 'recording') {
      console.log('[TelegramMediaSheet][Video] Not in recording state, ignoring stop');
      return;
    }

    // Double-check with ref (race condition guard)
    if (!recordingActiveRef.current) {
      console.log('[TelegramMediaSheet][Video] Not recording (ref), ignoring stop');
      return;
    }

    const duration = recordStartAtRef.current ? Date.now() - recordStartAtRef.current : 0;
    console.log('[TelegramMediaSheet][Video] Stop confirmed, duration:', duration);

    // Transition to 'stopping' state
    setRecordingState('stopping');

    // Mark that stop was requested by user
    recordStoppedRef.current = true;

    // If too short, log it (but still stop - the error will be handled gracefully)
    if (duration < MIN_RECORDING_DURATION_MS) {
      console.log('[TelegramMediaSheet][Video] Quick stop (<600ms), will cancel');
    }

    // Stop the camera recording - this will cause recordAsync to resolve
    if (cameraRef.current) {
      try {
        cameraRef.current.stopRecording();
      } catch (e) {
        console.log('[TelegramMediaSheet][Video] stopRecording error (ignored):', e);
      }
    }

    // Clean up timer (recording state cleaned in finally of handleStartRecording)
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, [recordingState]);

  // Keep stopRecordingFnRef up to date for interval callback (avoids stale closure)
  useEffect(() => {
    stopRecordingFnRef.current = handleStopRecording;
  }, [handleStopRecording]);

  // Handle gallery item press (Dev Build only)
  const handleGalleryItemPress = (item: GalleryItem) => {
    if (item.isAllPhotosTile) {
      void handleOpenSystemPicker();
    } else {
      setPreviewUri(item.uri);
      setPreviewType(item.mediaType);
    }
  };

  // Confirm selection (OK button)
  const handleConfirm = () => {
    if (previewUri) {
      onSelectMedia(previewUri, previewType);
      resetState();
    }
  };

  // Retake (discard and go back)
  const handleRetake = () => {
    setPreviewUri(null);
    setPreviewType('photo');
    // In Expo Go, re-launch camera
    if (isExpoGo) {
      expoGoLaunchRef.current = false;
    }
  };

  // Reset all state
  // Safely stop recording if active (for close/unmount scenarios)
  const safeStopRecording = () => {
    if (recordingActiveRef.current && cameraRef.current) {
      try {
        cameraRef.current.stopRecording();
      } catch {
        // Ignore - recording may already be stopped
      }
    }
    recordingActiveRef.current = false;
    recordStoppedRef.current = false;
    recordStartAtRef.current = null;
    recordPromiseRef.current = null;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const resetState = () => {
    // Stop any active recording first
    safeStopRecording();

    setPreviewUri(null);
    setPreviewType('photo');
    setCameraExpanded(false);
    setCameraMode('photo'); // Reset to Photo mode
    setRecordingState('idle');
    setRecordingDuration(0);
    setPermissionState('checking');
    setAccessPrivilege('all');
    setGalleryAssets([]);
    setEndCursor(undefined);
    setHasNextPage(false);
    setTotalCount(0);
    setBusy(false);
    setIsLoadingMore(false);
    busyRef.current = false;
    loadingMoreRef.current = false;
    expoGoLaunchRef.current = false;
    systemPickerRef.current = false;
    // Note: mic permission cache is intentionally NOT reset (persists per session)
  };

  // Close sheet
  const handleClose = () => {
    // Stop recording safely before closing
    safeStopRecording();
    resetState();
    onClose();
  };

  // Toggle camera facing
  const toggleCameraFacing = () => {
    setCameraFacing((prev) => (prev === 'back' ? 'front' : 'back'));
  };

  // Format duration for display
  const formatDuration = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  // Handle FlatList end reached for pagination
  const handleEndReached = () => {
    if (hasNextPage && !isLoadingMore && !isLoadingAssets) {
      void loadMoreAssets();
    }
  };

  // Render item for FlatList
  const renderItem = ({ item }: { item: GalleryItem }) => {
    // Camera tile (first item in grid)
    if (item.isCameraTile) {
      return (
        <TouchableOpacity
          style={styles.thumbnailContainer}
          onPress={handleExpandCamera}
          activeOpacity={0.7}
        >
          <View style={styles.cameraTileGridContent}>
            <Ionicons name="camera" size={28} color={COLORS.white} />
            <Text style={styles.cameraTileGridText}>Camera</Text>
          </View>
        </TouchableOpacity>
      );
    }

    // "All Photos" tile
    if (item.isAllPhotosTile) {
      return (
        <TouchableOpacity
          style={styles.allPhotosTile}
          onPress={() => handleGalleryItemPress(item)}
          activeOpacity={0.7}
          disabled={busy}
        >
          <View style={styles.allPhotosTileContent}>
            <Ionicons name="folder-open-outline" size={28} color={COLORS.primary} />
            <Text style={styles.allPhotosTileText}>All Photos</Text>
          </View>
        </TouchableOpacity>
      );
    }

    // Regular gallery item
    return (
      <TouchableOpacity
        style={styles.thumbnailContainer}
        onPress={() => handleGalleryItemPress(item)}
        activeOpacity={0.7}
      >
        <Image
          source={{ uri: item.uri }}
          style={styles.thumbnail}
          contentFit="cover"
        />
        {item.mediaType === 'video' && (
          <View style={styles.videoBadge}>
            <Ionicons name="videocam" size={12} color={COLORS.white} />
            {item.duration != null && (
              <Text style={styles.videoDuration}>
                {formatDuration(item.duration * 1000)}
              </Text>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // Render footer for FlatList (loading more indicator)
  const renderFooter = () => {
    if (!isLoadingMore) return null;
    return (
      <View style={styles.loadMoreContainer}>
        <ActivityIndicator size="small" color={COLORS.primary} />
      </View>
    );
  };

  // Video Preview Player component (uses expo-video for playback)
  const VideoPreviewPlayer = ({ uri }: { uri: string }) => {
    const player = useVideoPlayer(uri, (p) => {
      p.loop = false;
      p.play();
    });

    const [isPlaying, setIsPlaying] = useState(true);

    const togglePlayback = () => {
      if (player.playing) {
        player.pause();
        setIsPlaying(false);
      } else {
        player.play();
        setIsPlaying(true);
      }
    };

    return (
      <Pressable style={styles.videoPreviewContainer} onPress={togglePlayback}>
        <VideoView
          player={player}
          style={styles.videoPreview}
          contentFit="contain"
          nativeControls={false}
        />
        {!isPlaying && (
          <View style={styles.videoPlayButton}>
            <Ionicons name="play" size={48} color={COLORS.white} />
          </View>
        )}
      </Pressable>
    );
  };

  if (!visible) return null;

  // Preview screen (shared by Expo Go and Dev Build)
  if (previewUri) {
    return (
      <Modal visible={visible} transparent animationType="slide">
        <View style={styles.previewContainer}>
          {previewType === 'video' ? (
            <VideoPreviewPlayer uri={previewUri} />
          ) : (
            <Image
              source={{ uri: previewUri }}
              style={styles.previewImage}
              contentFit="contain"
            />
          )}
          {previewType === 'video' && (
            <View style={[styles.videoIndicator, { top: insets.top + 60 }]}>
              <Ionicons name="videocam" size={20} color={COLORS.white} />
              <Text style={styles.videoIndicatorText}>Video</Text>
            </View>
          )}
          <View style={[styles.previewActions, { paddingBottom: insets.bottom + 20 }]}>
            <TouchableOpacity style={styles.retakeButton} onPress={handleRetake}>
              <Ionicons name="refresh" size={24} color={COLORS.white} />
              <Text style={styles.retakeText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmButton} onPress={handleConfirm}>
              <Ionicons name="checkmark" size={24} color={COLORS.white} />
              <Text style={styles.confirmText}>OK</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.closeButton, { top: insets.top + 10 }]}
            onPress={handleClose}
          >
            <Ionicons name="close" size={28} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  // EXPO GO: Minimal loading overlay while camera launches (with gallery link)
  if (isExpoGo) {
    return (
      <Modal visible={visible} transparent animationType="fade">
        <View style={styles.expoGoOverlay}>
          {busy ? (
            <ActivityIndicator size="large" color={COLORS.white} />
          ) : (
            <View style={styles.expoGoContent}>
              <Text style={styles.expoGoText}>Opening camera...</Text>
            </View>
          )}
          {/* Small gallery link */}
          <TouchableOpacity
            style={[styles.expoGoGalleryLink, { bottom: insets.bottom + 40 }]}
            onPress={launchExpoGoGallery}
            disabled={busy}
          >
            <Ionicons name="images-outline" size={20} color={COLORS.white} />
            <Text style={styles.expoGoGalleryText}>Pick from Gallery</Text>
          </TouchableOpacity>
          {/* Close button */}
          <TouchableOpacity
            style={[styles.closeButton, { top: insets.top + 10 }]}
            onPress={handleClose}
          >
            <Ionicons name="close" size={28} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  // Handle shutter button press based on camera mode
  const handleShutterPress = () => {
    if (cameraMode === 'photo') {
      // Photo mode: take photo
      handleTakePhoto();
    } else {
      // Video mode: toggle recording (tap to start/stop)
      if (recordingState === 'idle') {
        handleStartRecording();
      } else if (recordingState === 'recording') {
        handleStopRecording();
      }
      // If 'starting' or 'stopping', ignore (wait for state transition)
    }
  };

  // DEV BUILD: Expanded camera view
  if (cameraExpanded) {
    return (
      <Modal visible={visible} transparent animationType="slide">
        <View style={styles.expandedCameraContainer}>
          <CameraView
            ref={cameraRef}
            style={styles.expandedCamera}
            facing={cameraFacing}
            mode={cameraMode === 'video' ? 'video' : 'picture'}
          />

          {/* Recording banner (only in Video mode when recording) */}
          {isRecording && (
            <View style={[styles.recordingBanner, { top: insets.top + 10 }]}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>
                {formatDuration(recordingDuration)} / 0:30
              </Text>
            </View>
          )}

          <View style={[styles.cameraControls, { paddingBottom: insets.bottom + 20 }]}>
            {/* Back button - far left */}
            <TouchableOpacity
              style={styles.cameraControlButton}
              onPress={() => setCameraExpanded(false)}
              disabled={isRecording}
            >
              <Ionicons name="arrow-back" size={28} color={COLORS.white} />
            </TouchableOpacity>

            {/* Center row: [Photo toggle] [Shutter] [Video toggle] */}
            <View style={styles.shutterRow}>
              {/* Photo mode toggle - left of shutter */}
              {recordingState === 'idle' && (
                <TouchableOpacity
                  style={[styles.modeIconButton, cameraMode === 'photo' && styles.modeIconButtonActive]}
                  onPress={() => setCameraMode('photo')}
                >
                  <Ionicons
                    name="camera"
                    size={22}
                    color={cameraMode === 'photo' ? COLORS.white : 'rgba(255,255,255,0.5)'}
                  />
                </TouchableOpacity>
              )}

              {/* Shutter button: tap-based for both modes */}
              <TouchableOpacity
                style={[
                  styles.shutterButton,
                  cameraMode === 'video' && styles.shutterButtonVideo,
                  isRecording && styles.shutterButtonRecording,
                ]}
                onPress={handleShutterPress}
                disabled={recordingState === 'starting' || recordingState === 'stopping'}
                activeOpacity={0.7}
              >
                {isRecording ? (
                  <View style={styles.shutterInnerRecording} />
                ) : cameraMode === 'video' ? (
                  <View style={styles.shutterInnerVideo} />
                ) : (
                  <View style={styles.shutterInner} />
                )}
              </TouchableOpacity>

              {/* Video mode toggle - right of shutter */}
              {recordingState === 'idle' && (
                <TouchableOpacity
                  style={[styles.modeIconButton, cameraMode === 'video' && styles.modeIconButtonActive]}
                  onPress={() => setCameraMode('video')}
                >
                  <Ionicons
                    name="videocam"
                    size={22}
                    color={cameraMode === 'video' ? COLORS.white : 'rgba(255,255,255,0.5)'}
                  />
                </TouchableOpacity>
              )}
            </View>

            {/* Camera flip - far right */}
            <TouchableOpacity
              style={styles.cameraControlButton}
              onPress={toggleCameraFacing}
              disabled={isRecording}
            >
              <Ionicons name="camera-reverse" size={28} color={COLORS.white} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.closeButton, { top: insets.top + 10 }]}
            onPress={handleClose}
            disabled={isRecording}
          >
            <Ionicons name="close" size={28} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  // DEV BUILD: Loading/checking state
  if (permissionState === 'checking' || busy) {
    return (
      <Modal visible={visible} transparent animationType="slide">
        <Pressable style={styles.overlay} onPress={handleClose}>
          <Pressable
            style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.handle} />
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  // DEV BUILD: Permission denied screen
  if (permissionState === 'denied') {
    return (
      <Modal visible={visible} transparent animationType="slide">
        <Pressable style={styles.overlay} onPress={handleClose}>
          <Pressable
            style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.handle} />

            <View style={styles.permissionContainer}>
              <View style={styles.permissionIconRow}>
                <Ionicons name="camera" size={32} color={COLORS.primary} />
                <Text style={styles.permissionPlus}>+</Text>
                <Ionicons name="images" size={32} color={COLORS.primary} />
              </View>
              <Text style={styles.permissionTitle}>Allow Camera & Gallery</Text>
              <Text style={styles.permissionSubtitle}>
                Camera and gallery access is required to take photos, record videos, and select media.
              </Text>
              <TouchableOpacity
                style={styles.grantButton}
                onPress={handleGrantPermissions}
                disabled={busy}
              >
                <Text style={styles.grantButtonText}>Grant Permissions</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  // DEV BUILD: Main Telegram UI (camera tile in grid + gallery)
  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={styles.overlay} onPress={handleClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />

          {/* Limited access banner */}
          {accessPrivilege === 'limited' && (
            <View style={styles.limitedAccessBanner}>
              <View style={styles.limitedAccessContent}>
                <Ionicons name="alert-circle-outline" size={18} color={COLORS.warning} />
                <Text style={styles.limitedAccessText}>
                  Limited access. To show all photos/videos, set Photos permission to "Allow all".
                </Text>
              </View>
              <View style={styles.limitedAccessButtons}>
                <TouchableOpacity
                  style={styles.openSettingsButton}
                  onPress={handleOpenSettings}
                >
                  <Text style={styles.openSettingsText}>Open Settings</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.refreshSmallButton}
                  onPress={handleRefreshGallery}
                  disabled={busy}
                >
                  <Ionicons name="refresh" size={16} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Gallery grid (camera tile is first item) */}
          <View style={styles.galleryContainer}>
            {isLoadingAssets ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={COLORS.primary} />
              </View>
            ) : (
              <FlatList
                data={gridData}
                numColumns={3}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                contentContainerStyle={styles.galleryContent}
                showsVerticalScrollIndicator={false}
                onEndReached={handleEndReached}
                onEndReachedThreshold={0.5}
                ListFooterComponent={renderFooter}
                ListEmptyComponent={
                  <View style={styles.emptyGalleryInline}>
                    <Ionicons name="images-outline" size={32} color={COLORS.textLight} />
                    <Text style={styles.emptyGalleryText}>No photos or videos</Text>
                  </View>
                }
              />
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    height: SHEET_HEIGHT,
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 12,
  },

  // Loading state
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Expo Go overlay (while camera launches)
  expoGoOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expoGoContent: {
    alignItems: 'center',
  },
  expoGoText: {
    fontSize: 16,
    color: COLORS.white,
    opacity: 0.7,
  },
  expoGoGalleryLink: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
  },
  expoGoGalleryText: {
    fontSize: 14,
    color: COLORS.white,
    opacity: 0.9,
  },

  // Empty gallery
  emptyGallery: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyGalleryInline: {
    width: '100%',
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyGalleryText: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  allPhotosButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 25,
  },
  allPhotosButtonText: {
    fontSize: 15,
    color: COLORS.white,
    fontWeight: '600',
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 8,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 20,
  },
  refreshButtonText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },

  // Limited access banner
  limitedAccessBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255, 193, 7, 0.15)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 193, 7, 0.3)',
  },
  limitedAccessContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  limitedAccessText: {
    fontSize: 11,
    color: COLORS.text,
    flex: 1,
    lineHeight: 15,
  },
  limitedAccessButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 8,
  },
  openSettingsButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
  },
  openSettingsText: {
    fontSize: 11,
    color: COLORS.white,
    fontWeight: '600',
  },
  refreshSmallButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 14,
  },

  // Permission screen
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  permissionIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },
  permissionPlus: {
    fontSize: 24,
    color: COLORS.textLight,
    fontWeight: '300',
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  permissionSubtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  grantButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    backgroundColor: COLORS.primary,
    borderRadius: 25,
  },
  grantButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },

  // Camera tile (grid cell style - same size as thumbnails)
  cameraTileGridContent: {
    flex: 1,
    margin: 1,
    borderRadius: 2,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  cameraTileGridText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.white,
  },

  // Gallery
  galleryContainer: {
    flex: 1,
    marginTop: 12,
  },
  galleryContent: {
    paddingHorizontal: 1,
  },
  thumbnailContainer: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    padding: 1,
  },
  thumbnail: {
    flex: 1,
    borderRadius: 2,
    backgroundColor: COLORS.backgroundDark,
  },
  videoBadge: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  videoDuration: {
    fontSize: 10,
    color: COLORS.white,
    fontWeight: '500',
  },

  // "All Photos" tile
  allPhotosTile: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    padding: 1,
  },
  allPhotosTileContent: {
    flex: 1,
    borderRadius: 2,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  allPhotosTileText: {
    fontSize: 11,
    color: COLORS.primary,
    fontWeight: '600',
    textAlign: 'center',
  },

  // Load more footer
  loadMoreContainer: {
    paddingVertical: 16,
    alignItems: 'center',
  },

  // Expanded camera
  expandedCameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  expandedCamera: {
    flex: 1,
  },

  // Camera controls
  cameraControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 20,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  cameraControlButton: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterButtonRecording: {
    borderColor: COLORS.error,
  },
  shutterButtonVideo: {
    borderColor: COLORS.error,
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.white,
  },
  shutterInnerVideo: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.error,
  },
  shutterInnerRecording: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: COLORS.error,
  },

  // Shutter row (Photo toggle + Shutter + Video toggle)
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },

  // Mode toggle buttons (44x44 touch targets)
  modeIconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeIconButtonActive: {
    backgroundColor: COLORS.primary,
  },

  // Recording banner
  recordingBanner: {
    position: 'absolute',
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.error,
    marginRight: 8,
  },
  recordingText: {
    fontSize: 14,
    color: COLORS.white,
    fontWeight: '600',
  },

  // Instruction
  instructionContainer: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  instructionText: {
    fontSize: 13,
    color: COLORS.white,
    opacity: 0.7,
  },

  // Close button
  closeButton: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Preview
  previewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewImage: {
    flex: 1,
  },
  videoPreviewContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPreview: {
    flex: 1,
    width: '100%',
  },
  videoPlayButton: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoIndicator: {
    position: 'absolute',
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  videoIndicatorText: {
    fontSize: 14,
    color: COLORS.white,
    fontWeight: '600',
  },
  previewActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 20,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 25,
  },
  retakeText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: COLORS.primary,
    borderRadius: 25,
  },
  confirmText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
});
