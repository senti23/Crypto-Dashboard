# Crypto Dashboard - Vercel Deployment

## Quick Deploy Steps

### Option 1: Vercel CLI (Fastest)

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Navigate to this folder:
```bash
cd /path/to/vercel-deploy
```

3. Deploy:
```bash
vercel
```

4. Follow prompts:
   - Login to Vercel
   - Select "Deploy"
   - Done! Your site will be live

### Option 2: GitHub + Vercel (Recommended for updates)

1. Create a new GitHub repo
2. Push these files to the repo:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin YOUR_REPO_URL
git push -u origin main
```

3. Go to [vercel.com](https://vercel.com)
4. Click "New Project"
5. Import your GitHub repo
6. Vercel auto-detects settings
7. Click "Deploy"

### Option 3: Vercel Web UI

1. Zip this folder
2. Go to [vercel.com](https://vercel.com)
3. Click "Add New..." → "Project"
4. Drag & drop the zip file
5. Click "Deploy"

## Environment Variables (if needed)

If you need to add API keys as environment variables in Vercel:

1. Go to your project dashboard
2. Settings → Environment Variables
3. Add:
   - `CMC_API_KEY`
   - `COINGECKO_API_KEY`
   - `OPENSEA_API_KEY`
   - `MORALIS_API_KEY`

Then update server.js to use `process.env.CMC_API_KEY` instead of hardcoded values.

## Important Note

Puppeteer (for PNG generation) might not work on Vercel's free tier due to memory/execution limits. If image generation fails:

1. Use Vercel Pro (supports Puppeteer)
2. Or use alternative: html2canvas (client-side) or external service

## Files Included

- `server.js` - Backend API
- `index.html` - Frontend dashboard
- `vercel.json` - Vercel configuration
- `package.json` - Dependencies
