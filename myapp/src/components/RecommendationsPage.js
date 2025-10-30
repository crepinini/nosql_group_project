import { Fragment, useEffect, useMemo, useState } from 'react';
import RecommendationRail from './RecommendationRail';
import { buildMoviesUrl, buildUsersUrl } from '../config';
import {
  getStoredUser,
  subscribeToAuthChanges,
} from './Login/auth';
import './RecommendationsPage.css';

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
    entry.slug ||
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

const isSeries = (item) => {
  if (!item) {
    return false;
  }
  const raw = String(item.imdb_type || '').toLowerCase();
  if (!raw) {
    return false;
  }
  if (raw.startsWith('tv')) {
    return true;
  }
  return raw.includes('series') && !raw.includes('movie');
};

const isMovie = (item) => !isSeries(item);

const resolveYear = (item) => {
  if (!item) {
    return null;
  }
  if (item.year) {
    return item.year;
  }
  if (item.release_year) {
    return item.release_year;
  }
  if (item.release_date) {
    const year = Number(String(item.release_date).slice(0, 4));
    return Number.isFinite(year) ? year : null;
  }
  return null;
};

const formatActorReason = (actors = []) => {
  if (!actors.length) {
    return '';
  }
  if (actors.length === 1) {
    return actors[0];
  }
  if (actors.length === 2) {
    return `${actors[0]} & ${actors[1]}`;
  }
  const remaining = actors.length - 2;
  return `${actors[0]}, ${actors[1]}${remaining > 0 ? ` +${remaining}` : ''}`;
};

const buildActorRecommendations = (sourceDocs, candidates, excludeIds) => {
  if (!sourceDocs.length || !candidates.length) {
    return [];
  }

  const actorWeights = new Map();
  sourceDocs.forEach((item) => {
    const actors = item.main_actors || item.first_four_actors || [];
    actors.forEach((actor, index) => {
      if (!actor) {
        return;
      }
      const baseWeight = Math.max(4 - index, 1);
      actorWeights.set(actor, (actorWeights.get(actor) || 0) + baseWeight);
    });
  });

  if (!actorWeights.size) {
    return [];
  }

  const scored = candidates
    .filter((item) => item && !excludeIds.has(item._id) && !excludeIds.has(item.imdb_id))
    .map((item) => {
      const actors = item.main_actors || item.first_four_actors || [];
      const overlaps = actors.filter((actor) => actorWeights.has(actor));
      if (!overlaps.length) {
        return null;
      }
      const score = overlaps.reduce(
        (total, actor) => total + (actorWeights.get(actor) || 0),
        0,
      );
      return {
        ...item,
        __score: score,
        __reason: `Features ${formatActorReason(overlaps)} you love`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.__score !== a.__score) {
        return b.__score - a.__score;
      }
      const ratingB = Number.isFinite(Number(b.rating)) ? Number(b.rating) : 0;
      const ratingA = Number.isFinite(Number(a.rating)) ? Number(a.rating) : 0;
      return ratingB - ratingA;
    });

  return scored.slice(0, 12);
};

const withReason = (items, getReason) =>
  items.slice(0, 12).map((item, index) => ({
    ...item,
    __reason: getReason(item, index),
  }));

const RecommendationsPage = () => {
  const [authUser, setAuthUser] = useState(() => getStoredUser());
  const [movies, setMovies] = useState([]);
  const [moviesLoading, setMoviesLoading] = useState(true);
  const [moviesError, setMoviesError] = useState(null);

  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(Boolean(authUser));
  const [profileError, setProfileError] = useState(null);

  const [friendAggregates, setFriendAggregates] = useState([]);
  const [friendLoading, setFriendLoading] = useState(false);
  const [friendError, setFriendError] = useState(null);

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
    const controller = new AbortController();
    (async () => {
      try {
        setMoviesLoading(true);
        setMoviesError(null);
        const response = await fetch(buildMoviesUrl('/movies-series'), {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        setMovies(Array.isArray(payload) ? payload : []);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Failed to load catalog', err);
          setMoviesError('Unable to load recommendations from the catalog.');
          setMovies([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setMoviesLoading(false);
        }
      }
    })();

    return () => controller.abort();
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
          setProfileError('Unable to load your profile right now.');
          setProfile(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setProfileLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [authUser]);

  useEffect(() => {
    if (!profile || !Array.isArray(profile.friends) || !profile.friends.length) {
      setFriendAggregates([]);
      setFriendLoading(false);
      setFriendError(null);
      return;
    }

    if (!movies.length) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        setFriendLoading(true);
        setFriendError(null);
        const results = await Promise.all(
          profile.friends.map(async (friendRef) => {
            const friendId = friendRef?._id || friendRef?.id;
            if (!friendId) {
              return null;
            }
            try {
              const response = await fetch(
                buildUsersUrl(`/users/${friendId}`),
                { signal: controller.signal },
              );
              if (!response.ok) {
                return null;
              }
              const data = await response.json();
              const favorites = extractFavorites(data);
              return {
                id: friendId,
                name: data.full_name || data.username || 'Friend',
                favorites,
              };
            } catch (err) {
              if (err.name !== 'AbortError') {
                console.warn(
                  'Failed to load friend profile',
                  friendId,
                  err,
                );
              }
              return null;
            }
          }),
        );

        if (cancelled) {
          return;
        }

        const aggregatedMap = new Map();
        let validSources = 0;

        results
          .filter(Boolean)
          .forEach(({ name, favorites }) => {
            validSources += 1;
            favorites.forEach((entry) => {
              const id = normalizeId(entry);
              if (!id) {
                return;
              }
              const bucket = aggregatedMap.get(id) || {
                id,
                count: 0,
                friends: new Set(),
              };
              bucket.count += 1;
              if (name) {
                bucket.friends.add(name);
              }
              aggregatedMap.set(id, bucket);
            });
          });

        const aggregated = Array.from(aggregatedMap.values()).map((entry) => ({
          id: entry.id,
          count: entry.count,
          friends: Array.from(entry.friends),
        }));

        setFriendAggregates(aggregated);
        setFriendError(
          !aggregated.length && !validSources
            ? 'We could not reach your friends right now.'
            : null,
        );
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Failed to build friend recommendations', err);
          setFriendAggregates([]);
          setFriendError('Unable to load your friends right now.');
        }
      } finally {
        if (!cancelled) {
          setFriendLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [profile, movies]);

  const movieByAnyId = useMemo(() => {
    const map = new Map();
    movies.forEach((item) => {
      if (item?._id) {
        map.set(item._id, item);
      }
      if (item?.imdb_id) {
        map.set(item.imdb_id, item);
      }
    });
    return map;
  }, [movies]);

  const favoritesRaw = useMemo(() => extractFavorites(profile), [profile]);

  const favoriteIds = useMemo(() => {
    const set = new Set();
    favoritesRaw.forEach((entry) => {
      const id = normalizeId(entry);
      if (!id) {
        return;
      }
      set.add(id);
      const doc = movieByAnyId.get(id);
      if (doc?._id) {
        set.add(doc._id);
      }
      if (doc?.imdb_id) {
        set.add(doc.imdb_id);
      }
    });
    return set;
  }, [favoritesRaw, movieByAnyId]);

  const favoriteDocs = useMemo(
    () =>
      Array.from(favoriteIds)
        .map((id) => movieByAnyId.get(id))
        .filter(Boolean),
    [favoriteIds, movieByAnyId],
  );

  const favoriteMoviesDocs = useMemo(
    () => favoriteDocs.filter(isMovie),
    [favoriteDocs],
  );

  const favoriteSeriesDocs = useMemo(
    () => favoriteDocs.filter(isSeries),
    [favoriteDocs],
  );

  const catalogMovies = useMemo(() => movies.filter(isMovie), [movies]);
  const catalogSeries = useMemo(() => movies.filter(isSeries), [movies]);

  const friendRecommendations = useMemo(() => {
    if (!friendAggregates.length) {
      return { movies: [], series: [] };
    }

    const entries = friendAggregates
      .map((entry) => {
        const item = movieByAnyId.get(entry.id);
        if (!item) {
          return null;
        }
        if (favoriteIds.has(item._id) || favoriteIds.has(item.imdb_id)) {
          return null;
        }
        const friendNames = entry.friends.slice(0, 2);
        let reason = '';
        if (entry.friends.length === 1 && friendNames[0]) {
          reason = `Loved by ${friendNames[0]}`;
        } else if (entry.friends.length > 1) {
          const suffix = friendNames.length
            ? ` (${friendNames.join(', ')})`
            : '';
          reason = `Loved by ${entry.friends.length} friends${suffix}`;
        } else {
          reason = 'A hit with your circle';
        }
        return {
          ...item,
          __score: entry.count,
          __reason: reason,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (b.__score !== a.__score) {
          return b.__score - a.__score;
        }
        const ratingB = Number.isFinite(Number(b.rating)) ? Number(b.rating) : 0;
        const ratingA = Number.isFinite(Number(a.rating)) ? Number(a.rating) : 0;
        return ratingB - ratingA;
      });

    return {
      movies: entries.filter(isMovie).slice(0, 12),
      series: entries.filter(isSeries).slice(0, 12),
    };
  }, [friendAggregates, movieByAnyId, favoriteIds]);

  const actorMovieRecommendations = useMemo(
    () =>
      buildActorRecommendations(favoriteMoviesDocs, catalogMovies, favoriteIds),
    [favoriteMoviesDocs, catalogMovies, favoriteIds],
  );

  const actorSeriesRecommendations = useMemo(
    () =>
      buildActorRecommendations(favoriteSeriesDocs, catalogSeries, favoriteIds),
    [favoriteSeriesDocs, catalogSeries, favoriteIds],
  );

  const topRatedMovies = useMemo(() => {
    const sorted = [...catalogMovies].sort((a, b) => {
      const ratingB = Number.isFinite(Number(b.rating)) ? Number(b.rating) : 0;
      const ratingA = Number.isFinite(Number(a.rating)) ? Number(a.rating) : 0;
      if (ratingB !== ratingA) {
        return ratingB - ratingA;
      }
      const votesB = Number.isFinite(Number(b.rating_count))
        ? Number(b.rating_count)
        : 0;
      const votesA = Number.isFinite(Number(a.rating_count))
        ? Number(a.rating_count)
        : 0;
      return votesB - votesA;
    });
    return withReason(sorted, (item) => {
      const rating = Number.isFinite(Number(item.rating))
        ? Number(item.rating).toFixed(1)
        : 'N/A';
      return `Rated ${rating} by the community`;
    });
  }, [catalogMovies]);

  const topRatedSeries = useMemo(() => {
    const sorted = [...catalogSeries].sort((a, b) => {
      const ratingB = Number.isFinite(Number(b.rating)) ? Number(b.rating) : 0;
      const ratingA = Number.isFinite(Number(a.rating)) ? Number(a.rating) : 0;
      if (ratingB !== ratingA) {
        return ratingB - ratingA;
      }
      const votesB = Number.isFinite(Number(b.rating_count))
        ? Number(b.rating_count)
        : 0;
      const votesA = Number.isFinite(Number(a.rating_count))
        ? Number(a.rating_count)
        : 0;
      return votesB - votesA;
    });
    return withReason(sorted, (item) => {
      const rating = Number.isFinite(Number(item.rating))
        ? Number(item.rating).toFixed(1)
        : 'N/A';
      return `Rated ${rating} by the community`;
    });
  }, [catalogSeries]);

  const latestMovieYear = useMemo(
    () =>
      catalogMovies.reduce(
        (max, item) => Math.max(max, resolveYear(item) || 0),
        0,
      ),
    [catalogMovies],
  );

  const latestSeriesYear = useMemo(
    () =>
      catalogSeries.reduce(
        (max, item) => Math.max(max, resolveYear(item) || 0),
        0,
      ),
    [catalogSeries],
  );

  const recentMovies = useMemo(() => {
    if (!catalogMovies.length) {
      return [];
    }
    const threshold = latestMovieYear ? latestMovieYear - 10 : 2015;
    const filtered = catalogMovies
      .filter((item) => (resolveYear(item) || 0) >= threshold)
      .sort((a, b) => {
        const yearB = resolveYear(b) || 0;
        const yearA = resolveYear(a) || 0;
        if (yearB !== yearA) {
          return yearB - yearA;
        }
        const popB = Number.isFinite(Number(b.popularity))
          ? Number(b.popularity)
          : 0;
        const popA = Number.isFinite(Number(a.popularity))
          ? Number(a.popularity)
          : 0;
        return popB - popA;
      });
    return withReason(filtered, (item) => {
      const year = resolveYear(item);
      return year ? `Released in ${year}` : 'Fresh arrival';
    });
  }, [catalogMovies, latestMovieYear]);

  const recentSeries = useMemo(() => {
    if (!catalogSeries.length) {
      return [];
    }
    const threshold = latestSeriesYear ? latestSeriesYear - 10 : 2015;
    const filtered = catalogSeries
      .filter((item) => (resolveYear(item) || 0) >= threshold)
      .sort((a, b) => {
        const yearB = resolveYear(b) || 0;
        const yearA = resolveYear(a) || 0;
        if (yearB !== yearA) {
          return yearB - yearA;
        }
        const popB = Number.isFinite(Number(b.popularity))
          ? Number(b.popularity)
          : 0;
        const popA = Number.isFinite(Number(a.popularity))
          ? Number(a.popularity)
          : 0;
        return popB - popA;
      });
    return withReason(filtered, (item) => {
      const year = resolveYear(item);
      return year ? `Released in ${year}` : 'Fresh arrival';
    });
  }, [catalogSeries, latestSeriesYear]);

  const trendingMovies = useMemo(() => {
    const sorted = [...catalogMovies].sort((a, b) => {
      const popB = Number.isFinite(Number(b.popularity))
        ? Number(b.popularity)
        : 0;
      const popA = Number.isFinite(Number(a.popularity))
        ? Number(a.popularity)
        : 0;
      return popB - popA;
    });
    return withReason(sorted, (_item, index) => {
      const position = index + 1;
      return `Watchlist pick #${position} for 2025`;
    });
  }, [catalogMovies]);

  const trendingSeries = useMemo(() => {
    const sorted = [...catalogSeries].sort((a, b) => {
      const popB = Number.isFinite(Number(b.popularity))
        ? Number(b.popularity)
        : 0;
      const popA = Number.isFinite(Number(a.popularity))
        ? Number(a.popularity)
        : 0;
      return popB - popA;
    });
    return withReason(sorted, (_item, index) => {
      const position = index + 1;
      return `Series spotlight #${position} for 2025`;
    });
  }, [catalogSeries]);

  const recommendationSections = [];

  if (
    friendLoading ||
    friendError ||
    (friendRecommendations.movies && friendRecommendations.movies.length > 0)
  ) {
    recommendationSections.push({
      key: 'friends-movies',
      node: (
        <RecommendationRail
          title="Friends’ favorite movies"
          subtitle="See what your friends talk about"
          items={friendRecommendations.movies}
          loading={friendLoading}
          error={friendError}
          emptyMessage=""
        />
      ),
    });
  }

  if (
    friendLoading ||
    friendError ||
    (friendRecommendations.series && friendRecommendations.series.length > 0)
  ) {
    recommendationSections.push({
      key: 'friends-series',
      node: (
        <RecommendationRail
          title="Friends’ favorite series"
          subtitle="Watch shows your friends enjoy"
          items={friendRecommendations.series}
          loading={friendLoading}
          error={friendError}
          emptyMessage=""
        />
      ),
    });
  }

  if (
    profileLoading ||
    profileError ||
    (actorMovieRecommendations && actorMovieRecommendations.length > 0)
  ) {
    recommendationSections.push({
      key: 'actors-movies',
      node: (
        <RecommendationRail
          title="Movies starring actors you love"
          subtitle="Films with actors from your favorites"
          items={actorMovieRecommendations}
          loading={profileLoading}
          error={profileError}
          emptyMessage=""
        />
      ),
    });
  }

  if (
    profileLoading ||
    profileError ||
    (actorSeriesRecommendations && actorSeriesRecommendations.length > 0)
  ) {
    recommendationSections.push({
      key: 'actors-series',
      node: (
        <RecommendationRail
          title="Series starring actors you follow"
          subtitle="See shows with actors you follow"
          items={actorSeriesRecommendations}
          loading={profileLoading}
          error={profileError}
          emptyMessage=""
        />
      ),
    });
  }

  if (topRatedMovies.length > 0) {
    recommendationSections.push({
      key: 'top-rated-movies',
      node: (
        <RecommendationRail
          title="Most acclaimed movies"
          subtitle="Films that MovieManiac users like"
          items={topRatedMovies}
        />
      ),
    });
  }

  if (topRatedSeries.length > 0) {
    recommendationSections.push({
      key: 'top-rated-series',
      node: (
        <RecommendationRail
          title="Most acclaimed series"
          subtitle="Series that fans rate well"
          items={topRatedSeries}
        />
      ),
    });
  }

  if (recentMovies.length > 0) {
    recommendationSections.push({
      key: 'recent-movies',
      node: (
        <RecommendationRail
          title="Fresh movie releases"
          subtitle="Watch movies released lately"
          items={recentMovies}
        />
      ),
    });
  }

  if (recentSeries.length > 0) {
    recommendationSections.push({
      key: 'recent-series',
      node: (
        <RecommendationRail
          title="Fresh series drops"
          subtitle="Watch series released lately"
          items={recentSeries}
        />
      ),
    });
  }

  if (trendingMovies.length > 0) {
    recommendationSections.push({
      key: 'trending-movies',
      node: (
        <RecommendationRail
          title="Top movies for your 2025 watchlist"
          subtitle="Movies people talk about now"
          items={trendingMovies}
        />
      ),
    });
  }

  if (trendingSeries.length > 0) {
    recommendationSections.push({
      key: 'trending-series',
      node: (
        <RecommendationRail
          title="Top series for your 2025 watchlist"
          subtitle="Shows people talk about now"
          items={trendingSeries}
        />
      ),
    });
  }

  return (
    <div className="recommendations-page">
      <header className="recommendations-hero">
        <div>
          <h1>Recommendations</h1>
          <p>
            Rails based on your friends, on your favorite talent, and on what is popular
          </p>
        </div>
      </header>

      {moviesLoading ? (
        <p className="recommendations-status">Loading recommendations…</p>
      ) : null}

      {moviesError ? (
        <p className="recommendations-status recommendations-status--error">
          {moviesError}
        </p>
      ) : null}

      {!moviesLoading && !moviesError ? (
        <div className="recommendations-grid">
          {recommendationSections.map((section) => (
            <Fragment key={section.key}>{section.node}</Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default RecommendationsPage;
