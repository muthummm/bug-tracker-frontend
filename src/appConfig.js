// App settings per environment. Vite picks the environment from NODE_ENV:
// `npm run dev` -> development, `npm run build` -> production.
const NODE_ENV = import.meta.env.MODE === 'production' ? 'production' : 'development';

const CONFIG = {
  development: {
    apiUrl: 'http://localhost:3001',
  },
  production: {
    apiUrl: 'https://bug-tracker-backend-n2hp.onrender.com',
  },
};

export const appConfig = {
  env: NODE_ENV,
  // VITE_API_URL, if set, overrides the address above (e.g. to point a build at another backend).
  apiUrl: (import.meta.env.VITE_API_URL || CONFIG[NODE_ENV].apiUrl).replace(/\/+$/, ''),
  // Ping /api/health this often while the app is open, so the free Render server doesn't fall asleep.
  keepAliveMs: 10_000,
};
