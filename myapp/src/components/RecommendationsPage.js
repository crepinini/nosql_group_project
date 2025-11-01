import { useEffect, useMemo, useState } from 'react';
import RecommendationRail from './RecommendationRail';
import { buildMoviesUrl, buildUsersUrl } from '../config';
import {
  getStoredUser,
  subscribeToAuthChanges,
} from './Login/auth';
import './RecommendationsPage.css';

const TARGET_YEAR = 2025;
const DEFAULT_RECOMMENDATION_LIMIT = 18;

const CATEGORY_CONFIG = [
  {
    key: 'new',
    title: 'New Releases',
    subtitle: 'Movies and series sorted by premiere date.',
    emptyMessage: 'No recent releases at the moment.',
  },
  {
    key: 'top-2025',
    title: `Top Titles of ${TARGET_YEAR}`,
    subtitle: `Movies and series released in ${TARGET_YEAR} sorted by rating.`,
    emptyMessage: `No standout titles for ${TARGET_YEAR} yet.`,
  },
  {
    key: 'top-2025-popular',
    title: `Top ${TARGET_YEAR} Releases`,
    subtitle: `Movies and series released in ${TARGET_YEAR} sorted by audience numbers.`,
    emptyMessage: `No popular titles released in ${TARGET_YEAR} yet.`,
  },
  {
    key: 'popular',
    title: 'Most Popular Titles',
    subtitle: 'View selections people watch now.',
    emptyMessage: 'No popular recommendations available.',
  },
  {
    key: 'top-ranked',
    title: 'Top Ranked Titles',
    subtitle: 'Movies and series sorted by critic scores.',
    emptyMessage: 'No top ranked titles available.',
  },
  {
    key: 'critic-favorites',
    title: "Critics' Favorite Titles",
    subtitle: 'Metacritic scores guide this rail.',
    emptyMessage: 'No critic favorite titles available right now.',
  },
  {
    key: 'actor-favorite',
    title: 'Titles Starring Actors You Follow',
    subtitle: 'Actors you follow on screen.',
    emptyMessage: 'Save some favorites to unlock actor-based picks.',
    requiresAuth: true,
  },
  {
    key: 'awards-wins',
    title: 'Award-Winning Titles',
    subtitle: 'Movies and series sorted by awards won.',
    emptyMessage: 'No award-winning titles found yet.',
  },
  {
    key: 'awards-nominations',
    title: 'Most Nominated Titles',
    subtitle: 'Stories praised across award seasons.',
    emptyMessage: 'No nominated recommendations available.',
  },
];

const VIEW_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'series', label: 'Series' },
];

const normalizeId = (entry) => {
  if (!entry) {
    return null;
  }
  if (typeof entry === 'string') {
    return entry.trim() || null;
  }
  return (
    entry._id ||
    entry.id ||
    entry.movie_id ||
    entry.imdb_id ||
    null
  );
};

const extractFavorites = (entity) => {
  if (!entity) {
    return [];
  }
  if (Array.isArray(entity.favorites_movie_series)) {
    return entity.favorites_movie_series;
  }
  if (Array.isArray(entity.favorites_movies)) {
    return entity.favorites_movies;
  }
  if (Array.isArray(entity.favorites)) {
    return entity.favorites;
  }
  return [];
};

const RecommendationsPage = () => {
  const [authUser, setAuthUser] = useState(() => getStoredUser());
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(Boolean(authUser));
  const [profileError, setProfileError] = useState(null);

  const [recommendations, setRecommendations] = useState({});
  const [recommendationsLoading, setRecommendationsLoading] = useState(true);
  const [recommendationsError, setRecommendationsError] = useState(null);

  const [viewFilter, setViewFilter] = useState('all');

  useEffect(() => {
    const handleChange = () => setAuthUser(getStoredUser());
    const unsubscribe = subscribeToAuthChanges(handleChange);
    window.addEventListener('storage', handleChange);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', handleChange);
    };
  }, []);

  useEffect(() => {
    if (!authUser) {
      setProfile(null);
      setProfileLoading(false);
      setProfileError(null);
      return;
    }

    const userId = authUser._id || authUser.username;
    if (!userId) {
      setProfile(null);
      setProfileLoading(false);
      setProfileError('Missing user identifier.');
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        setProfileLoading(true);
        setProfileError(null);
        const endpoint = buildUsersUrl(
          `/myprofile?user_id=${encodeURIComponent(userId)}`,
        );
        const response = await fetch(endpoint, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        setProfile(payload);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Failed to load profile', err);
          setProfile(null);
          setProfileError('Unable to load your profile right now.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setProfileLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [authUser]);

  const favoriteIds = useMemo(() => {
    const favorites = extractFavorites(profile);
    const seen = new Set();
    const ids = [];
    favorites.forEach((entry) => {
      if (entry && typeof entry === 'object') {
        ['_id', 'movie_id', 'imdb_id', 'id'].forEach((key) => {
          const value = entry[key];
          if (!value) {
            return;
          }
          const strValue = String(value);
          if (!seen.has(strValue)) {
            seen.add(strValue);
            ids.push(strValue);
          }
        });
      }
      const id = normalizeId(entry);
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(String(id));
      }
    });
    return ids;
  }, [profile]);

  const favoriteIdsKey = useMemo(
    () => favoriteIds.slice().sort().join(','),
    [favoriteIds],
  );

  useEffect(() => {
    if (profileLoading) {
      return;
    }

    const controller = new AbortController();
    setRecommendationsLoading(true);
    setRecommendationsError(null);
    (async () => {
      try {
        const params = new URLSearchParams();
        params.set(
          'categories',
          CATEGORY_CONFIG.map((config) => config.key).join(','),
        );
        params.set('limit', String(DEFAULT_RECOMMENDATION_LIMIT));
        params.set('year', String(TARGET_YEAR));
        params.set('type', viewFilter);
        if (favoriteIdsKey) {
          params.set('favorite_ids', favoriteIdsKey);
          params.set('exclude', favoriteIdsKey);
        }
        const endpoint = buildMoviesUrl(
          `/movies-series/recommendations?${params.toString()}`,
        );
        const response = await fetch(endpoint, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        setRecommendations(
          payload && typeof payload === 'object' ? payload : {},
        );
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Failed to load recommendations', err);
          setRecommendations({});
          setRecommendationsError(
            'Unable to load the recommendations feed right now.',
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setRecommendationsLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [favoriteIdsKey, profileLoading, viewFilter]);

  const sections = useMemo(
    () =>
      CATEGORY_CONFIG.map((config) => {
        const items = Array.isArray(recommendations[config.key])
          ? recommendations[config.key]
          : [];
        const emptyMessage =
          config.requiresAuth && !authUser
            ? 'Sign in to unlock this personalised feed.'
            : config.emptyMessage;
        return {
          ...config,
          items,
          emptyMessage,
        };
      }),
    [authUser, recommendations],
  );

  return (
    <div className="recommendations-page">
      <header className="recommendations-hero">
        <div className="recommendations-hero__intro">
          <h1>Recommendations</h1>
          <p>
            Explore releases by year, award wins, viewer trends, and picks
          </p>
        </div>
        <div
          className="recommendations-hero__filters"
          role="group"
          aria-label="Filter recommendations by format"
        >
          {VIEW_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={`recommendations-hero__filters-btn${
                viewFilter === filter.value
                  ? ' recommendations-hero__filters-btn--active'
                  : ''
              }`}
              onClick={() => setViewFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </header>

      {profileError ? (
        <p className="recommendations-status recommendations-status--error">
          {profileError}
        </p>
      ) : null}

      {recommendationsLoading ? (
        <p className="recommendations-status">Loading recommendations…</p>
      ) : recommendationsError ? (
        <p className="recommendations-status recommendations-status--error">
          {recommendationsError}
        </p>
      ) : null}

      {!recommendationsLoading && !recommendationsError ? (
        <div className="recommendations-grid">
          {sections.map((section) => (
            <RecommendationRail
              key={section.key}
              title={section.title}
              subtitle={section.subtitle}
              items={section.items}
              loading={recommendationsLoading}
              error={null}
              emptyMessage={section.emptyMessage}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default RecommendationsPage;
