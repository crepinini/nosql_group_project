const AUTH_STORAGE_KEY = 'mm:user';
const AUTH_EVENT = 'mm-auth-changed';

export const getStoredUser = () => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      delete parsed.movie_comments;
    }
    return parsed;
  } catch (err) {
    console.warn('Unable to parse stored auth user', err);
    return null;
  }
};

export const storeUser = (user) => {
  if (!user) {
    return;
  }
  const payload =
    user && typeof user === 'object'
      ? { ...user }
      : user;
  if (payload && typeof payload === 'object') {
    delete payload.movie_comments;
  }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
  window.dispatchEvent(new Event(AUTH_EVENT));
};

export const clearStoredUser = () => {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  window.dispatchEvent(new Event(AUTH_EVENT));
};

export const subscribeToAuthChanges = (handler) => {
  window.addEventListener(AUTH_EVENT, handler);
  return () => window.removeEventListener(AUTH_EVENT, handler);
};

export const AUTH_EVENTS = {
  change: AUTH_EVENT,
};
