# Photo Lifecycle Documentation

**CRITICAL PRODUCTION RULES - READ BEFORE MODIFYING PHOTO CODE**

## Overview

This document defines the **NON-NEGOTIABLE** rules for photo storage and handling in the Mira app. These rules were established after a **CRITICAL DATA LOSS INCIDENT** where users' profile photos were being automatically deleted on app restart.

## Source of Truth

### Backend is Source of Truth

- **Convex backend**: The ONLY source of truth for all profile photos
- **Local storage (AsyncStorage)**: Cache ONLY for offline viewing
- **File system (`file://` URIs)**: Temporary cache that can be cleared by OS

```
┌─────────────────┐
│  Convex Backend │ ◄─── SOURCE OF TRUTH (permanent, never auto-delete)
└─────────────────┘
        │
        │ one-way sync
        ▼
┌─────────────────┐
│  AsyncStorage   │ ◄─── Cache (URIs only, can be out of sync)
└─────────────────┘
        │
        │ references
        ▼
┌─────────────────┐
│  FileSystem     │ ◄─── Volatile cache (OS can delete anytime)
└─────────────────┘
```

## Photo Upload Flow

### When User Adds a Photo

1. **User selects photo** from gallery or camera
2. **Process image** (resize, compress) → creates temp cache URI
3. **Copy to persistent directory** (`FileSystem.documentDirectory + 'mira/photos/'`)
4. **Upload to Convex storage immediately**:
   - Generate upload URL via `api.photos.generateUploadUrl`
   - Upload blob to Convex storage
   - Receive `storageId` (permanent reference)
5. **Call `api.photos.addPhoto` mutation** with storageId
6. **Store local URI in AsyncStorage** (for offline preview)
7. **Display photo to user** from local cache

### Critical Safety Rules

✅ **DO**:
- Upload to Convex immediately when photo is added
- Store both storageId (backend) and local URI (cache)
- Download from Convex if local file missing
- Show "Re-upload" UI if backend has no storageId and local file missing

❌ **NEVER**:
- Delete AsyncStorage URIs based on file existence checks
- Delete Convex storageIds for any reason except explicit user deletion
- Filter photos during hydration/migration
- Assume local file:// URIs are permanent

## App Startup Flow

### 1. Store Hydration (from AsyncStorage)

```typescript
// stores/onboardingStore.ts - onRehydrateStorage
onRehydrateStorage: () => (state) => {
  // ✅ SAFE: Normalize photos array to 9 slots
  const normalized = normalizePhotos(state.photos);

  // ✅ PRODUCTION-SAFE: Keep ALL URIs (no filtering)
  // Missing files are flagged at render time, not deleted here
  useOnboardingStore.setState({ photos: normalized });

  // ❌ NEVER DO THIS:
  // const valid = state.photos.filter(isValidUri); // DELETES photos!
}
```

### 2. Photo Sync from Backend

```typescript
// app/_layout.tsx - PhotoSyncManager
// After all stores hydrate:
// 1. Fetch photos from Convex (source of truth)
// 2. Download any missing files to local cache
// 3. Update local stores with Convex data (ONE-WAY: backend → local)
```

### 3. Render Photos

```typescript
// Before rendering each photo:
const fileState = await getPhotoFileState(uri);

if (fileState === 'exists') {
  // ✅ Render image
  <Image source={{ uri }} />
} else if (fileState === 'missing') {
  // ✅ Show re-upload UI (do NOT auto-delete URI)
  <MissingPhotoPlaceholder onReupload={() => ...} />
} else {
  // ✅ Show empty state
  <AddPhotoButton />
}
```

## What Happens When Local File Missing

### Scenario: OS Clears Cache (Low Storage)

1. **Detection**: `FileSystem.getInfoAsync(uri)` returns `exists: false`
2. **Action**: Flag photo as missing (set UI state)
3. **Display**: Show "Re-upload" button to user
4. **Backend Check**: Query Convex for storageId
   - If storageId exists: Download from Convex → restore local cache
   - If no storageId: User must re-upload (original never reached backend)
5. **NEVER**: Auto-delete the URI from AsyncStorage

### Scenario: App Restart After OS Cleaned Files

```
Before restart:
  - AsyncStorage: ["file://photo1.jpg", "file://photo2.jpg"]
  - FileSystem: [photo1.jpg missing, photo2.jpg exists]
  - Convex: [storageId1, storageId2]

After restart (CORRECT behavior):
  1. Hydrate: Load ["file://photo1.jpg", "file://photo2.jpg"] from AsyncStorage ✅
  2. Sync: Fetch [storageId1, storageId2] from Convex ✅
  3. Check: photo1.jpg missing locally → re-download from Convex ✅
  4. Display: Both photos visible ✅

After restart (WRONG behavior - NEVER DO THIS):
  1. Hydrate: Load ["file://photo1.jpg", "file://photo2.jpg"] ❌
  2. Filter: Check file existence → remove photo1.jpg ❌ DATA LOSS!
  3. Store: ["file://photo2.jpg"] ❌ PERMANENT DATA LOSS!
  4. Display: Only photo2 visible ❌ USER SEES MISSING PHOTOS!
```

## Migration Rules

### Safe Migration Pattern

```typescript
// ✅ SAFE: Add new fields, preserve existing data
onRehydrateStorage: () => (state) => {
  if (state) {
    // Normalize structure (ensure length = 9)
    const normalized = normalizePhotos(state.photos);

    // Add new fields if needed
    const migrated = {
      ...state,
      photos: normalized,
      // NEW: Add storageIds array (parallel to photos array)
      photoStorageIds: state.photoStorageIds || Array(9).fill(null),
    };

    useOnboardingStore.setState(migrated);
  }
}
```

### Unsafe Migration Patterns (NEVER DO THIS)

```typescript
// ❌ DANGEROUS: Filtering based on file existence
onRehydrateStorage: () => (state) => {
  const validPhotos = state.photos.filter((uri) => {
    const exists = FileSystem.getInfoSync(uri).exists; // BLOCKING + DELETES DATA
    return exists;
  });
  // This DELETES photos permanently! ❌
}

// ❌ DANGEROUS: Filtering based on URI format
onRehydrateStorage: () => (state) => {
  const validPhotos = state.photos.filter((uri) => {
    return !uri.includes('/cache/'); // DELETES cache URIs!
  });
  // This DELETES photos that were temporarily in cache! ❌
}

// ❌ DANGEROUS: Replacing array instead of merging
onRehydrateStorage: () => (state) => {
  useOnboardingStore.setState({
    photos: createEmptyPhotoSlots(), // DELETES all photos! ❌
  });
}
```

## Events That MUST NOT Delete Photos

### ❌ NEVER delete photos during:

1. **App startup/relaunch**
   - Rationale: User expects photos to persist
   - Correct action: Sync from backend, download missing files

2. **Store hydration from AsyncStorage**
   - Rationale: Hydration is for loading data, not validation
   - Correct action: Normalize structure only (length, null-fill)

3. **OS low storage cleanup**
   - Rationale: Local files may be deleted, but backend has permanent copies
   - Correct action: Re-download from Convex when needed

4. **App update**
   - Rationale: Users expect data to survive updates
   - Correct action: Preserve all AsyncStorage data, sync from backend

5. **Migration code**
   - Rationale: Migrations can go wrong, causing permanent data loss
   - Correct action: Only add fields, never filter/delete

6. **File existence checks**
   - Rationale: Files can be missing temporarily (OS cleanup, corrupted fs)
   - Correct action: Flag as missing, allow re-download or re-upload

7. **URI format validation**
   - Rationale: URIs can temporarily be in cache during processing
   - Correct action: Warn in dev mode, but preserve URI

## Developer Checklist

Before modifying photo-related code, ask yourself:

- [ ] Am I deleting photo URIs based on file existence? (**NEVER DO THIS**)
- [ ] Am I filtering photos during hydration? (**NEVER DO THIS**)
- [ ] Am I assuming local files are permanent? (**WRONG ASSUMPTION**)
- [ ] Am I checking Convex backend as source of truth? (**REQUIRED**)
- [ ] Am I allowing users to re-upload missing photos? (**REQUIRED**)
- [ ] Am I logging warnings instead of auto-deleting? (**REQUIRED**)

## File References

### Key Files

- `stores/onboardingStore.ts`: Local photo state (cache)
- `stores/demoStore.ts`: Demo profile photos (cache)
- `convex/photos.ts`: Backend photo mutations/queries (source of truth)
- `services/photoSync.ts`: Sync layer (backend ↔ local)
- `lib/photoFileGuard.ts`: File existence checks (read-only)
- `app/(onboarding)/photo-upload.tsx`: Primary photo upload
- `app/(onboarding)/additional-photos.tsx`: Additional photos upload

### Critical Code Sections

1. **Hydration** (NEVER delete data):
   - `stores/onboardingStore.ts:396-421` - onRehydrateStorage
   - `stores/demoStore.ts:1250-1277` - REMOVED destructive filter

2. **File Guards** (read-only, never mutate):
   - `lib/photoFileGuard.ts` - All functions are read-only

3. **Sync** (one-way: backend → local):
   - `services/photoSync.ts:syncPhotosFromBackend()` - Downloads from Convex
   - `app/_layout.tsx:PhotoSyncManager` - Auto-sync on startup

4. **Upload** (write to backend immediately):
   - `services/photoSync.ts:uploadPhotoToBackend()` - Upload to Convex
   - `app/(onboarding)/photo-upload.tsx:247-354` - Verification photo upload

## Testing Checklist

Before releasing photo-related changes:

- [ ] Add photo → Force quit app → Relaunch → Photo still visible
- [ ] Add photo → Clear app cache (iOS Settings) → Relaunch → Photo downloaded from backend
- [ ] Add photo → Turn off network → Relaunch → Photo visible from local cache
- [ ] Add photo → Delete local file manually (dev tools) → Relaunch → Photo re-downloaded
- [ ] Add 9 photos → Reorder → Force quit → Relaunch → Order preserved
- [ ] Demo mode: Photos persist across sessions (local-only, no backend)

## Emergency Contacts

If you encounter photo deletion bugs:

1. **Immediately revert** any hydration/migration changes
2. **Check git history** for changes to `onRehydrateStorage` functions
3. **Verify backend** has storageIds using Convex dashboard
4. **Test locally** before deploying to production

## Version History

- **2025-03-03**: Initial documentation after critical data loss incident
  - Documented backend-first storage pattern
  - Established non-negotiable lifecycle rules
  - Added developer checklist and testing requirements
