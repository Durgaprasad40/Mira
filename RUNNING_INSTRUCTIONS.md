# 🚀 Running the Mira Dating App

## ✅ App is Starting!

The Expo development server is now running. You should see:

1. **QR Code** in your terminal
2. **Options** to:
   - Press `i` for iOS simulator
   - Press `a` for Android emulator
   - Scan QR code with Expo Go app on your phone

## 📱 How to View the App

### Option 1: Physical Device (Recommended)
1. Install **Expo Go** app on your phone:
   - iOS: [App Store](https://apps.apple.com/app/expo-go/id982107779)
   - Android: [Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent)
2. Scan the QR code shown in terminal
3. App will load on your device

### Option 2: iOS Simulator
1. Press `i` in the terminal
2. Requires Xcode installed on Mac

### Option 3: Android Emulator
1. Press `a` in the terminal
2. Requires Android Studio and emulator set up

## ⚠️ Important: Set Up Convex Backend

Before the app can fully work, you need to set up Convex:

1. **Open a NEW terminal window**
2. **Run:**
   ```bash
   cd /Users/durgaprasad/mira-app
   npx convex dev
   ```
3. This will:
   - Create/connect to your Convex project
   - Generate TypeScript types
   - Create `.env.local` with your Convex URL
   - Provide real-time backend

**Keep both terminals running:**
- Terminal 1: Expo server (`npx expo start`)
- Terminal 2: Convex backend (`npx convex dev`)

## 🐛 Troubleshooting

### "Convex URL not found" error
**Solution:** Run `npx convex dev` in a separate terminal

### App crashes on startup
**Solution:** 
```bash
npx expo start -c  # Clear cache and restart
```

### "Module not found" errors
**Solution:**
```bash
npm install
```

### Port already in use
**Solution:**
```bash
npx expo start --port 8082
```

## 📋 What to Test

Once the app loads:

1. ✅ **Welcome Screen** - Should appear first
2. ✅ **Onboarding Flow** - Complete all 14 steps
3. ✅ **Discover Screen** - Swipe on profiles
4. ✅ **Messages** - Send test messages
5. ✅ **Profile** - View and edit profile
6. ✅ **Settings** - Check all options

## 🎉 Success!

If you see the welcome screen, the app is running successfully!

---

**Current Status:**
- ✅ Dependencies installed
- ✅ Expo server starting
- ⏳ Convex backend needs setup (run `npx convex dev`)
