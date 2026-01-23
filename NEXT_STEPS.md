# Mira Dating App - Next Steps Guide

## 🎯 Current Status
✅ All major features implemented
✅ UI components created
✅ Backend functions written
✅ Schema defined
✅ Navigation structure complete

## 📋 Step-by-Step Process

### **Step 1: Set Up Convex Backend** (CRITICAL)

The app uses Convex for backend. You need to:

1. **Install Convex CLI** (if not already installed):
   ```bash
   npm install -g convex
   ```

2. **Initialize Convex in your project**:
   ```bash
   cd /Users/durgaprasad/mira-app
   npx convex dev
   ```
   
   This will:
   - Create a Convex account (if needed)
   - Set up your project
   - Generate deployment URL
   - Create `.env.local` with `EXPO_PUBLIC_CONVEX_URL`

3. **Update `app/_layout.tsx`** with your Convex URL:
   ```typescript
   const convex = new ConvexReactClient(
     process.env.EXPO_PUBLIC_CONVEX_URL || "https://your-actual-url.convex.cloud"
   );
   ```

### **Step 2: Install Dependencies**

```bash
cd /Users/durgaprasad/mira-app
npm install
```

### **Step 3: Set Up Environment Variables**

Create `.env.local` file in the root:
```env
EXPO_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
```

### **Step 4: Generate Convex Types**

After Convex is set up, generate TypeScript types:
```bash
npx convex dev
# This runs in watch mode and auto-generates types
```

### **Step 5: Test the App**

1. **Start Expo development server**:
   ```bash
   npx expo start
   ```

2. **Run on device/simulator**:
   - Press `i` for iOS simulator
   - Press `a` for Android emulator
   - Scan QR code with Expo Go app on physical device

### **Step 6: Verify Core Features**

Test these critical flows:

#### ✅ Authentication Flow
- [ ] Welcome screen loads
- [ ] Email/Phone input works
- [ ] OTP verification (mock for now)
- [ ] Password creation

#### ✅ Onboarding Flow
- [ ] Basic info (name, DOB)
- [ ] Photo upload
- [ ] Face verification (UI only, needs API)
- [ ] Additional photos
- [ ] Bio entry
- [ ] Profile details (height, weight, exercise, pets)
- [ ] Preferences (gender, age, distance)
- [ ] Permissions (location, notifications)

#### ✅ Main App Features
- [ ] Discover screen (swipe cards)
- [ ] Explore screen (filters)
- [ ] Messages screen
- [ ] Profile screen
- [ ] Settings screen

### **Step 7: Fix Common Issues**

#### Issue: Convex URL not set
**Solution**: Run `npx convex dev` and copy the URL to `.env.local`

#### Issue: Type errors
**Solution**: Run `npx convex dev` to regenerate types

#### Issue: Navigation errors
**Solution**: Check that all screen files exist in correct paths

#### Issue: Import errors
**Solution**: Verify all component exports in `index.ts` files

### **Step 8: Backend Integration Checklist**

#### 🔴 Critical (Must Fix)
- [ ] **Convex Authentication**: Set up Convex Auth
  - Configure OAuth providers (Google, Apple, Facebook)
  - Set up email/password auth
  - Set up phone/SMS OTP

- [ ] **File Storage**: Configure Convex file storage
  - Photo uploads
  - Image processing

- [ ] **Push Notifications**: Set up Expo Push Notifications
  - Configure APNs (iOS)
  - Configure FCM (Android)
  - Test notification delivery

#### 🟡 Important (Should Fix)
- [ ] **Face Verification API**: Integrate third-party service
  - AWS Rekognition or similar
  - Liveness detection
  - Photo comparison

- [ ] **Payment Integration**: 
  - RevenueCat setup
  - Razorpay integration (India)
  - Apple/Google IAP

- [ ] **NSFW/Profanity Filter**: 
  - AWS Rekognition content moderation
  - Profanity filter library

#### 🟢 Nice to Have
- [ ] **Real-time Typing Indicators**: WebSocket connection
- [ ] **Voice Messages**: Audio recording/playback
- [ ] **GIF Support**: GIF picker integration

### **Step 9: Testing Checklist**

#### Unit Tests
```bash
# Add test files for critical functions
npm test
```

#### Manual Testing
- [ ] Test all onboarding screens
- [ ] Test swipe gestures
- [ ] Test message sending
- [ ] Test filter application
- [ ] Test subscription flow (mock)
- [ ] Test profile editing

### **Step 10: Performance Optimization**

1. **Image Optimization**:
   - Use `expo-image` for better performance
   - Implement image caching
   - Compress images before upload

2. **Code Splitting**:
   - Lazy load heavy components
   - Optimize bundle size

3. **Database Queries**:
   - Add proper indexes (already in schema)
   - Optimize query patterns
   - Implement pagination

### **Step 11: Security Checklist**

- [ ] Validate all user inputs
- [ ] Sanitize data before database insertion
- [ ] Implement rate limiting
- [ ] Secure API keys (use environment variables)
- [ ] Implement proper authentication checks
- [ ] Add CORS configuration if needed

### **Step 12: Deployment Preparation**

#### For Development
```bash
# Keep using Expo Go for development
npx expo start
```

#### For Production (EAS Build)
1. **Install EAS CLI**:
   ```bash
   npm install -g eas-cli
   eas login
   ```

2. **Configure `eas.json`**:
   ```json
   {
     "build": {
       "development": {
         "developmentClient": true,
         "distribution": "internal"
       },
       "preview": {
         "distribution": "internal"
       },
       "production": {}
     }
   }
   ```

3. **Build for production**:
   ```bash
   eas build --platform ios
   eas build --platform android
   ```

### **Step 13: Documentation**

Create documentation for:
- [ ] API endpoints (Convex functions)
- [ ] Component usage
- [ ] State management (Zustand stores)
- [ ] Navigation structure
- [ ] Deployment process

## 🚨 Immediate Action Items

### Priority 1 (Do First)
1. ✅ Set up Convex backend (`npx convex dev`)
2. ✅ Install dependencies (`npm install`)
3. ✅ Test app startup (`npx expo start`)
4. ✅ Fix any immediate errors

### Priority 2 (Do Next)
1. ✅ Test authentication flow
2. ✅ Test onboarding flow
3. ✅ Test main app screens
4. ✅ Fix navigation issues

### Priority 3 (Do After Core Works)
1. ✅ Integrate payment systems
2. ✅ Set up push notifications
3. ✅ Integrate face verification
4. ✅ Add NSFW filtering

## 📝 Notes

- **Convex Backend**: The app is fully integrated with Convex. All backend functions are in `/convex` folder.
- **Real-time**: Convex provides real-time subscriptions automatically
- **File Storage**: Convex handles file storage for photos
- **Authentication**: Needs Convex Auth setup (see Convex docs)

## 🆘 Troubleshooting

### App won't start
- Check Node.js version (should be 18+)
- Clear cache: `npx expo start -c`
- Delete `node_modules` and reinstall

### Convex errors
- Make sure Convex dev server is running
- Check `.env.local` has correct URL
- Regenerate types: `npx convex dev`

### Type errors
- Run `npx convex dev` to regenerate types
- Check `convex/_generated/api.d.ts` exists

### Navigation errors
- Verify all screen files exist
- Check route names match exactly
- Clear Expo cache

## 🎉 Success Criteria

Your app is ready when:
- ✅ App starts without errors
- ✅ Onboarding flow completes
- ✅ Can swipe on profiles
- ✅ Can send messages
- ✅ Filters work correctly
- ✅ Profile editing works
- ✅ All screens navigate properly

---

**Next Command to Run:**
```bash
cd /Users/durgaprasad/mira-app && npx convex dev
```

Then in another terminal:
```bash
cd /Users/durgaprasad/mira-app && npx expo start
```
