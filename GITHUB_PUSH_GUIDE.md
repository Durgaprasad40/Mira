# 🚀 Push to GitHub - Step by Step Guide

## Quick Method (Using Personal Access Token)

### Step 1: Create a GitHub Personal Access Token

1. Go to: **https://github.com/settings/tokens**
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. **Name:** `Mira App Push`
4. **Expiration:** Choose 90 days or No expiration
5. **Select scopes:** Check **`repo`** (Full control of private repositories)
6. Click **"Generate token"**
7. **Copy the token immediately** (you won't see it again!)

### Step 2: Push Using the Script

Open Terminal and run:

```bash
cd /Users/durgaprasad/Desktop/Mira-Backup-20260123-171953
./push-to-github.sh YOUR_TOKEN_HERE
```

Replace `YOUR_TOKEN_HERE` with the token you copied.

---

## Alternative Method (Manual Push)

### Option A: Using Token in URL (One-time)

```bash
cd /Users/durgaprasad/Desktop/Mira-Backup-20260123-171953

# Set remote with token
git remote set-url origin https://YOUR_TOKEN@github.com/Durgaprasad40/Mira.git

# Push
git push -u origin main

# Remove token for security
git remote set-url origin https://github.com/Durgaprasad40/Mira.git
```

### Option B: Using GitHub CLI (Recommended)

1. **Install GitHub CLI:**
   ```bash
   brew install gh
   ```

2. **Login:**
   ```bash
   gh auth login
   ```

3. **Push:**
   ```bash
   cd /Users/durgaprasad/Desktop/Mira-Backup-20260123-171953
   git push -u origin main
   ```

### Option C: Using SSH (If you have SSH keys set up)

1. **Switch to SSH:**
   ```bash
   git remote set-url origin git@github.com:Durgaprasad40/Mira.git
   ```

2. **Push:**
   ```bash
   git push -u origin main
   ```

---

## ✅ Verify Push

After pushing, check your repository:
**https://github.com/Durgaprasad40/Mira**

You should see all your files there!

---

## 🔒 Security Note

- Never commit tokens to your repository
- The script automatically removes the token after pushing
- Use environment variables for tokens in production

---

## 🆘 Troubleshooting

### "Authentication failed"
- Check your token is correct
- Make sure token has `repo` scope
- Token might have expired

### "Repository not found"
- Make sure the repository exists at: https://github.com/Durgaprasad40/Mira
- Check you have write access

### "Permission denied"
- Your token might not have the right permissions
- Create a new token with `repo` scope

---

## 📞 Need Help?

If you're stuck, the easiest method is:
1. Get a Personal Access Token (Step 1 above)
2. Run: `./push-to-github.sh YOUR_TOKEN`

That's it! 🎉
