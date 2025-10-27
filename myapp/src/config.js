// src/config.js

// Normalize helpers
const stripTrailingSlash = (v = '') => v.replace(/\/+$/, '');
const ensureLeadingSlash = (p = '') => (p.startsWith('/') ? p : `/${p}`);

// Optional runtime bases (used in production or custom setups).
// In dev we’ll rely on the CRA proxy; leave these empty.
const MOVIES_API_ENV =
  process.env.REACT_APP_API_BASE_URL ||
  process.env.MOVIES_API_TARGET ||
  '';

const PEOPLE_API_ENV =
  process.env.REACT_APP_PEOPLE_API_BASE_URL ||
  process.env.PEOPLE_API_TARGET ||
  '';

const USERS_API_ENV =
  process.env.REACT_APP_USERS_API_BASE_URL ||
  process.env.USERS_API_TARGET ||
  '';

// Normalized bases (empty in dev so the proxy is used)
export const MOVIES_API_BASE = MOVIES_API_ENV ? stripTrailingSlash(MOVIES_API_ENV) : '';
export const PEOPLE_API_BASE = PEOPLE_API_ENV ? stripTrailingSlash(PEOPLE_API_ENV) : '';
export const USERS_API_BASE = USERS_API_ENV ? stripTrailingSlash(USERS_API_ENV) : '';

/**
 * Movies API builder
 * - Dev: prefix with /api to hit the CRA proxy → port 5000 (pathRewrite removes /api)
 * - Prod: use MOVIES_API_BASE if provided
 */
export const buildMoviesUrl = (path = '') =>
  MOVIES_API_BASE
    ? `${MOVIES_API_BASE}${ensureLeadingSlash(path)}`
    : `/api${ensureLeadingSlash(path)}`;

/**
 * People API builder (only if you actually call people from the front)
 * - Same /api convention as movies (proxied to port 5002)
 */
export const buildPeopleUrl = (path = '') =>
  PEOPLE_API_BASE
    ? `${PEOPLE_API_BASE}${ensureLeadingSlash(path)}`
    : `/api${ensureLeadingSlash(path)}`;

/**
 * Users API builder
 * - Dev: DO NOT prefix with /api, the proxy forwards root paths to port 5004
 * - Prod: use USERS_API_BASE if provided
 */
export const buildUsersUrl = (path = '') =>
  USERS_API_BASE
    ? `${USERS_API_BASE}${ensureLeadingSlash(path)}`
    : ensureLeadingSlash(path);
