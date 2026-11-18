# Bug Log: frontend

Web app for the Bug Log bug tracker. **React 18 + Vite**.
It talks to the API in the separate `bug-tracker-backend` project.

## Run locally
Start the backend first (it runs on http://localhost:3001), then:
```bash
npm install
npm run dev
```
Open http://localhost:5173. In development the app calls the backend at `http://localhost:3001`, so no settings are needed.

## Settings
The backend address is in `src/appConfig.js`, chosen by NODE_ENV:

| Environment | Backend |
|---|---|
| development (`npm run dev`) | `http://localhost:3001` |
| production (`npm run build`) | `https://bug-tracker-backend-n2hp.onrender.com` |

While the app is open it pings `/api/health` every 10 seconds so the free Render server stays awake.

Optional: set `VITE_API_URL` (no trailing slash) to point a build at a different backend. It is read at build time.

## Build
```bash
npm run build      # output in dist/
npm run preview    # serve dist/ locally to check it
```

## Deploy on Netlify (free)
1. Push this project to GitHub.
2. Netlify → **Add new site → Import an existing project** → pick the repo.
   Build command and publish folder come from `netlify.toml` (`npm run build`, `dist`).
3. Put the Netlify site address in the backend's `CORS_ORIGIN` setting on Render.

The app uses hash links (`#project-2`), so no redirect rules are needed.

## What's in the app
- Sign up as **Tester** or **Developer**; testers create projects and add developers from **Team**.
- Bug list with status chips, search, filters (including "Assigned to me"), sorting, CSV import/export.
- Bug view with one-click next steps, status dropdown, comments, notes, history and screenshots.
- Green/red toasts for every action; works on phones.
