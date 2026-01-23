#!/bin/bash

# Script to push Mira app to GitHub
# You need a Personal Access Token (PAT) from GitHub

echo "🚀 Pushing Mira App to GitHub..."
echo ""

# Check if token is provided
if [ -z "$1" ]; then
  echo "❌ Error: Personal Access Token required"
  echo ""
  echo "📋 How to get a token:"
  echo "1. Go to: https://github.com/settings/tokens"
  echo "2. Click 'Generate new token' → 'Generate new token (classic)'"
  echo "3. Name it: 'Mira App Push'"
  echo "4. Select scope: 'repo' (full control of private repositories)"
  echo "5. Click 'Generate token'"
  echo "6. Copy the token (you'll only see it once!)"
  echo ""
  echo "💡 Then run:"
  echo "   ./push-to-github.sh YOUR_TOKEN_HERE"
  echo ""
  echo "Or set it as environment variable:"
  echo "   export GITHUB_TOKEN=your_token_here"
  echo "   ./push-to-github.sh"
  exit 1
fi

TOKEN=${1:-$GITHUB_TOKEN}

if [ -z "$TOKEN" ]; then
  echo "❌ Error: No token provided"
  exit 1
fi

# Set remote with token
git remote set-url origin https://${TOKEN}@github.com/Durgaprasad40/Mira.git

# Push to GitHub
echo "📤 Pushing code to GitHub..."
git push -u origin main

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Success! Your code is now on GitHub:"
  echo "   https://github.com/Durgaprasad40/Mira"
  echo ""
  # Remove token from remote URL for security
  git remote set-url origin https://github.com/Durgaprasad40/Mira.git
  echo "🔒 Removed token from git config for security"
else
  echo ""
  echo "❌ Push failed. Check your token and try again."
  # Remove token from remote URL
  git remote set-url origin https://github.com/Durgaprasad40/Mira.git
  exit 1
fi
