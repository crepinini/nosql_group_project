const { createProxyMiddleware } = require('http-proxy-middleware');

// --- Target URLs for each backend service ---
const MOVIES_API_TARGET =
  process.env.MOVIES_API_TARGET ||
  process.env.REACT_APP_API_BASE_URL ||
  'http://localhost:5000';

const PEOPLE_API_TARGET =
  process.env.PEOPLE_API_TARGET ||
  process.env.REACT_APP_PEOPLE_API_BASE_URL ||
  'http://localhost:5002';

const USERS_API_TARGET =
  process.env.USERS_API_TARGET ||
  process.env.REACT_APP_USERS_API_BASE_URL ||
  'http://localhost:5001';

// --- Register proxy middlewares ---
module.exports = function setupProxy(app) {
  // Movies & Series service
  app.use(
    ['/api/movies-series', '/api/movies', '/api/series'],
    createProxyMiddleware({
      target: MOVIES_API_TARGET,
      changeOrigin: true,
      secure: false,
      ws: false,
      logLevel: 'warn',
      pathRewrite: { '^/api': '' },
    }),
  );

  // People service
  app.use(
    ['/api/people'],
    createProxyMiddleware({
      target: PEOPLE_API_TARGET,
      changeOrigin: true,
      secure: false,
      ws: false,
      logLevel: 'warn',
      pathRewrite: { '^/api': '' },
    }),
  );

  // Users service (profile, favorites, friends)
  app.use(
    ['/users', '/users/*', '/auth', '/auth/*', '/myprofile', '/mylist', '/myfriends', '/my_friends'],
    createProxyMiddleware({
      target: USERS_API_TARGET,
      changeOrigin: true,
      secure: false,
      ws: false,
      logLevel: 'warn',
    }),
  );
};
