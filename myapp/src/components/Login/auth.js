const AUTH_STORAGE_KEY = 'mm:user';
const AUTH_EVENT = 'mm-auth-changed';

export const getStoredUser = () => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (err) {
    console.warn('Unable to parse stored auth user', err);
    return null;
  }
};

export const storeUser = (user) => {
  if (!user) {
    return;
  }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
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
