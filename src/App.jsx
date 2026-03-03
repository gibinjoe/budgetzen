// localStorage shim for window.storage
window.storage = {
  async get(key) {
    const val = localStorage.getItem(key);
    return val ? { key, value: val } : (() => { throw new Error("not found"); })();
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
  },
  async delete(key) {
    localStorage.removeItem(key);
    return { key, deleted: true };
  },
};

# Deploy BudgetZen to Vercel — Step by Step

## Prerequisites

- A **GitHub account** (free at github.com)
- **Node.js** installed (download from nodejs.org — v18 or newer)
- The **ynab.jsx** file from Claude

---

## Step 1: Create the Project

Open your terminal and run:

```bash
npm create vite@latest budgetzen -- --template react
cd budgetzen
npm install
```

## Step 2: Add the Storage Shim

Open `src/main.jsx` in any text editor. Add the storage shim **at the very top**, before everything else:

```javascript
// localStorage shim — add this ABOVE the existing imports
window.storage = {
  async get(key) {
    const val = localStorage.getItem(key);
    if (val === null) throw new Error("not found");
    return { key, value: val };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
  },
  async delete(key) {
    localStorage.removeItem(key);
    return { key, deleted: true };
  },
};
```

The file should now look like:

```javascript
window.storage = { /* ...shim from above... */ };

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

## Step 3: Replace the App Component

Copy the entire contents of **ynab.jsx** and paste it into `src/App.jsx`, replacing everything that was there.

## Step 4: Clear Default Styles

Vite's default CSS conflicts with the layout. Replace the contents of these two files with empty files:

**src/index.css** — delete all contents (or replace with just a blank line)

**src/App.css** — delete all contents (or replace with just a blank line)

## Step 5: Test Locally

```bash
npm run dev
```

Open `http://localhost:5173` in your browser. Verify the app fills the full screen and works correctly. Press `Ctrl+C` to stop when done.

## Step 6: Push to GitHub

Go to **github.com** → click the **+** button (top right) → **New repository**.

- Repository name: `budgetzen`
- Keep it **Public** or **Private** (either works with Vercel)
- Do NOT initialize with README
- Click **Create repository**

GitHub will show setup commands. In your terminal, run:

```bash
git init
git add .
git commit -m "BudgetZen initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/budgetzen.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your actual GitHub username.

## Step 7: Connect to Vercel

1. Go to **vercel.com** and click **Sign Up** (or **Log In**)
2. Choose **Continue with GitHub** and authorize Vercel
3. On the dashboard, click **Add New → Project**
4. Find **budgetzen** in the repository list and click **Import**
5. Vercel auto-detects the Vite framework. Verify these settings:
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
6. Click **Deploy**

The build takes about 30–60 seconds.

## Step 8: You're Live

Vercel gives you a URL like `budgetzen-abc123.vercel.app`. That's your app — open it and start budgeting.

---

## After Deployment

**Every future change** is automatic:

1. Edit files locally
2. Commit and push: `git add . && git commit -m "update" && git push`
3. Vercel detects the push and redeploys in under a minute

**Custom domain** (optional): In your Vercel project → Settings → Domains → add your own domain and follow the DNS instructions.

---

## Quick Reference — File Summary

```
budgetzen/
├── src/
│   ├── main.jsx      ← storage shim added at top
│   ├── App.jsx       ← paste ynab.jsx contents here
│   ├── index.css     ← empty
│   └── App.css       ← empty
├── index.html
├── package.json
└── vite.config.js
```

## Troubleshooting

**App doesn't fill full width?**
Make sure `src/index.css` and `src/App.css` are empty. Vite's defaults add `max-width: 1280px` to `#root`.

**Build fails on Vercel?**
Check that `src/App.jsx` has `export default function App()` and that the storage shim is in `main.jsx`, not `App.jsx`.

**Data disappeared?**
Data lives in the browser's localStorage. Clearing browser data or switching browsers starts fresh. Use the Export Backup button in the sidebar to save your data as a JSON file.