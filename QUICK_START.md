# 🚀 Quick Start Guide - Mira Dating App

## Immediate Next Steps (Run These Commands)

### 1. Set Up Convex Backend (5 minutes)
```bash
cd /Users/durgaprasad/mira-app
npx convex dev
```
**What this does:**
- Creates/connects to your Convex project
- Generates TypeScript types
- Provides real-time backend
- Creates `.env.local` with your Convex URL

**Keep this terminal running!**

### 2. Install Dependencies (if not done)
```bash
npm install
```

### 3. Start the App (in a NEW terminal)
```bash
cd /Users/durgaprasad/mira-app
npx expo start
```

**Then:**
- Press `i` for iOS simulator
- Press `a` for Android emulator  
- Scan QR code with Expo Go app

## ✅ What to Test First

1. **App Launches** → Should see welcome screen
2. **Onboarding** → Complete the flow
3. **Discover Screen** → Swipe on profiles
4. **Messages** → Send a test message

## 🐛 Common Issues & Fixes

### "Convex URL not found"
**Fix:** Make sure `npx convex dev` is running and check `.env.local` exists

### "Module not found"
**Fix:** Run `npm install` again

### "Type errors"
**Fix:** Run `npx convex dev` to regenerate types

### App crashes on startup
**Fix:** 
```bash
npx expo start -c  # Clear cache
```

## 📱 Testing Checklist

- [ ] App starts without errors
- [ ] Welcome screen appears
- [ ] Can navigate through onboarding
- [ ] Can see profiles in Discover
- [ ] Can swipe left/right
- [ ] Can access Messages tab
- [ ] Can view Profile tab

## 🎯 Current Status

✅ **Completed:**
- All UI screens
- All components
- Backend functions (Convex)
- Database schema
- Navigation structure
- Feature implementations

⏳ **Needs Setup:**
- Convex project connection
- Environment variables
- Testing on device/simulator

## 📞 Need Help?

1. Check `NEXT_STEPS.md` for detailed guide
2. Check Convex docs: https://docs.convex.dev
3. Check Expo docs: https://docs.expo.dev

---

**Start here:** Run `npx convex dev` in the project directory!
