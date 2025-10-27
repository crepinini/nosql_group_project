const stripTrailingSlash = (v = '') => v.replace(/\/+$/, '');
const ensureLeadingSlash = (p = '') => (p.startsWith('/') ? p : `/${p}`);

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

export const MOVIES_API_BASE = MOVIES_API_ENV ? stripTrailingSlash(MOVIES_API_ENV) : '';
export const PEOPLE_API_BASE = PEOPLE_API_ENV ? stripTrailingSlash(PEOPLE_API_ENV) : '';
export const USERS_API_BASE = USERS_API_ENV ? stripTrailingSlash(USERS_API_ENV) : '';

export const buildMoviesUrl = (path = '') =>
  MOVIES_API_BASE
    ? `${MOVIES_API_BASE}${ensureLeadingSlash(path)}`
    : `/api${ensureLeadingSlash(path)}`;

export const buildPeopleUrl = (path = '') =>
  PEOPLE_API_BASE
    ? `${PEOPLE_API_BASE}${ensureLeadingSlash(path)}`
    : `/api${ensureLeadingSlash(path)}`;

export const buildUsersUrl = (path = '') =>
  USERS_API_BASE
    ? `${USERS_API_BASE}${ensureLeadingSlash(path)}`
    : ensureLeadingSlash(path);
