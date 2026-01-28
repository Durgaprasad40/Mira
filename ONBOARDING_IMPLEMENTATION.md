# Onboarding Data Submission Implementation

## Overview
This document describes the implementation of the TODO to submit all onboarding data to the backend from the review screen.

## Changes Made

### 1. Backend Mutation (`convex/users.ts`)
Created a new `completeOnboarding` mutation that:
- Accepts all onboarding data fields (profile info, preferences, photos)
- Validates user existence
- Updates user profile with all collected data
- Handles photo storage IDs and creates photo records
- Marks onboarding as completed
- Cleans up existing photos when replacing them

**Key Features:**
- Proper type validation for all fields matching the schema
- Handles optional fields gracefully
- Deletes old photos and storage files to prevent orphaned data
- Validates photo URLs before inserting into database

### 2. Photo Upload Utility (`lib/uploadUtils.ts`)
Created utility functions to upload photos:
- `uploadPhotoToConvex`: Uploads a single photo from local URI to Convex storage
- `uploadPhotosToConvex`: Uploads multiple photos in parallel for better performance

**Key Features:**
- Fetches local files as blobs
- Uploads to Convex storage using generated upload URLs
- Returns storage IDs for database insertion
- Parallel upload for multiple photos
- Proper error handling and propagation

### 3. Frontend Update (`app/(onboarding)/review.tsx`)
Updated the review screen to:
- Import and use the new mutations
- Upload photos before submitting data
- Prepare comprehensive onboarding data object
- Handle upload errors with user-friendly prompts
- Mark onboarding as completed on success

**Key Features:**
- All onboarding fields included: name, dateOfBirth, gender, bio, height, weight, smoking, drinking, kids, exercise, pets, education, religion, jobTitle, company, school, lookingFor, relationshipIntent, activities, preferences
- Photo upload with error recovery (option to continue without photos)
- Proper loading states
- Error alerts for user feedback

## Testing Instructions

### Prerequisites
1. Ensure Convex backend is running
2. Have an authenticated user (userId available in authStore)
3. Complete onboarding flow up to the review screen

### Test Cases

#### 1. Complete Onboarding with Photos
1. Go through the onboarding flow
2. Add at least one photo
3. Fill in profile details
4. Reach the review screen
5. Click "Complete Profile"
6. **Expected:** Photos upload, data is saved, redirects to tutorial

#### 2. Complete Onboarding without Photos
1. Go through the onboarding flow
2. Skip photo upload or remove photos
3. Fill in profile details
4. Reach the review screen
5. Click "Complete Profile"
6. **Expected:** Data is saved without photos, redirects to tutorial

#### 3. Handle Photo Upload Failure
1. Go through the onboarding flow with photos
2. Simulate network error during upload (disconnect network)
3. Click "Complete Profile"
4. **Expected:** Error alert asking if user wants to continue without photos
5. Choose "Continue" or "Cancel"
6. **Expected:** Continues without photos or allows retry

#### 4. Handle Submission Failure
1. Go through the onboarding flow
2. Simulate backend error (e.g., stop Convex backend)
3. Click "Complete Profile"
4. **Expected:** Error alert with appropriate message

### Manual Verification
After completing onboarding, verify in Convex dashboard:
1. User record has `onboardingCompleted: true`
2. User profile fields are populated correctly
3. Photos table has entries for the user with correct order
4. Storage contains the uploaded photo files

## Error Handling

### Photo Upload Errors
- User is prompted whether to continue without photos
- Can cancel and retry or continue without photos
- Loading state is properly managed

### Backend Errors
- Displays user-friendly error messages
- Resets loading state properly
- Allows user to retry

## Performance Considerations
- Photos are uploaded in parallel to reduce total upload time
- Only necessary data is sent to backend
- Efficient cleanup of old photos and storage

## Security Considerations
- User authentication is verified before submission
- All data is validated against schema on backend
- Photos are stored securely in Convex storage
- No sensitive data logged in errors

## Future Improvements
1. Add face detection validation for photos
2. Implement photo compression before upload
3. Add progress indicators for photo upload
4. Cache uploaded photo IDs to avoid re-upload on retry
5. Add more granular error messages for different failure types
