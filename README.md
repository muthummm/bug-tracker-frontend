# Bug Log: frontend

Web app for the Bug Log bug tracker. **React 18 + Vite**.
It talks to the API in the separate `bug-tracker-backend` project.

## Run locally
Start the backend first (it runs on http://localhost:3001), then:
```bash
npm install
npm run dev
```
Open http://localhost:5173. In development, Vite forwards `/api` and `/uploads` to the backend, so no settings are needed.

## Settings
| Name | Example | What it is |
|---|---|---|
| `VITE_API_URL` | `https://bug-tracker-backend.onrender.com` | Backend address, no trailing slash. Leave empty for local dev |

It is read **at build time**. After changing it on your host, redeploy.

## Build
```bash
npm run build      # output in dist/
npm run preview    # serve dist/ locally to check it
```

## Deploy on Netlify (free)
1. Push this project to GitHub.
2. Netlify → **Add new site → Import an existing project** → pick the repo.
   Build command and publish folder come from `netlify.toml` (`npm run build`, `dist`).
3. **Site configuration → Environment variables**: add `VITE_API_URL` = your Render backend URL. Redeploy.
4. Put the Netlify site address in the backend's `CORS_ORIGIN` setting on Render.

The app uses hash links (`#project-2`), so no redirect rules are needed.

## What's in the app
- Sign up as **Tester** or **Developer**; testers create projects and add developers from **Team**.
- Bug list with status chips, search, filters (including "Assigned to me"), sorting, CSV import/export.
- Bug view with one-click next steps, status dropdown, comments, notes, history and screenshots.
- Green/red toasts for every action; works on phones.
