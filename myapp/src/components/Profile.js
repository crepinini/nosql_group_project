import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { getStoredUser } from './Login/auth';
import './Profile.css';

const FALLBACK_POSTER =
  'https://via.placeholder.com/400x600.png?text=Poster+Unavailable';

// Accept both shapes: ["ms0001", ...] or [{ _id: "ms0001" }, ...]
const normalizeFavorites = (profile) =>
  (profile?.favorites_movies && Array.isArray(profile.favorites_movies)
    ? profile.favorites_movies
    : (profile?.favorites && Array.isArray(profile.favorites)
      ? profile.favorites
      : [])) || [];

// Decide which user_id to load (URL has priority)
const resolveUserId = (authUser) => {
  const urlParams = new URLSearchParams(window.location.search);
  const queryUserId = urlParams.get('user_id');
  if (queryUserId) return queryUserId.trim();
  return (authUser?._id || authUser?.username || '').trim();
};

export default function Profile() {
  const navigate = useNavigate();

  // Auth info comes from localStorage (no subscription here)
  const [authUser] = useState(() => getStoredUser());

  // Profile data loaded from backend
  const [profile, setProfile] = useState(null);

  // UI data
  const [favorites, setFavorites] = useState([]);
  const [reviewsEnriched, setReviewsEnriched] = useState([]);

  // UX state
  const [isLoading, setIsLoading] = useState(!authUser);
  const [error, setError] = useState(null);

  // Load profile from backend (runs when authUser changes once)
  useEffect(() => {
    if (!authUser) {
      setIsLoading(false);
      return;
    }

    const userId = resolveUserId(authUser);
    if (!userId) {
      setError('Profile not found');
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        setIsLoading(true);
        setError(null);

        const res = await fetch(`/myprofile?user_id=${encodeURIComponent(userId)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        setProfile(data);
        // IMPORTANT: do NOT call storeUser(...) here.
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error(e);
          setError('Unable to load user profile');
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [authUser]);

  // Fetch full movie docs for favorites (run once per user/profile id)
  useEffect(() => {
    if (!profile || !profile._id) return;

    const favEntries = normalizeFavorites(profile);
    if (!favEntries.length) {
      setFavorites([]);
      return;
    }

    // Support string IDs or {_id} objects
    const ids = Array.from(
      new Set(
        favEntries
          .map((entry) => (typeof entry === 'string' ? entry : entry?._id))
          .filter(Boolean)
      )
    );

    const controller = new AbortController();
    (async () => {
      try {
        const results = await Promise.all(
          ids.map(async (id) => {
            try {
              const r = await fetch(`/api/movies-series/${id}`, {
                signal: controller.signal,
              });
              if (!r.ok) return null;
              return await r.json();
            } catch {
              return null;
            }
          })
        );
        setFavorites(results.filter(Boolean));
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('favorites fetch error', e);
          setFavorites([]);
        }
      }
    })();

    return () => controller.abort();
  }, [profile?._id]);

  // Enrich reviews with movie titles (optional, once per user/profile id)
  useEffect(() => {
    if (!profile || !profile._id) return;

    const reviewEntries = Array.isArray(profile.reviews) ? profile.reviews : [];
    if (!reviewEntries.length) {
      setReviewsEnriched([]);
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        const results = await Promise.all(
          reviewEntries.map(async (review) => {
            const id = review._id || review.movie_id || review.imdb_id;
            if (!id) return review;

            try {
              const r = await fetch(`/api/movies-series/${id}`, {
                signal: controller.signal,
              });
              if (!r.ok) return review;
              const movie = await r.json();
              return {
                ...review,
                movie_title: movie.title || review.movie_title || 'Untitled Movie',
                year: movie.year || review.year,
                imdb_type: movie.imdb_type || review.imdb_type,
              };
            } catch {
              return review;
            }
          })
        );
        setReviewsEnriched(results);
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('reviews enrich error', e);
          setReviewsEnriched(reviewEntries);
        }
      }
    })();

    return () => controller.abort();
  }, [profile?._id]);

  const stats = useMemo(
    () => ({
      friends: Array.isArray(profile?.friends) ? profile.friends.length : 0,
      favorites: normalizeFavorites(profile).length,
      reviews: Array.isArray(profile?.reviews) ? profile.reviews.length : 0,
    }),
    [profile]
  );

  // Guards
  if (!authUser) return <Navigate to="/login" replace />;

  if (isLoading)
    return (
      <div className="home-content">
        <p className="loading">Loading profile…</p>
      </div>
    );

  if (error)
    return (
      <div className="home-content">
        <p className="error">{error}</p>
      </div>
    );

  if (!profile)
    return (
      <div className="home-content">
        <p className="error">Profile not found</p>
      </div>
    );

  return (
    <div className="profile-page">
      {/* Banner */}
      <section className="profile-hero">
        <h1>{profile.full_name || profile.username || 'Profile'}</h1>
        {profile.username && <div className="profile-handle">@{profile.username}</div>}
        {profile.about_me && <p className="profile-about">{profile.about_me}</p>}
        <div className="profile-meta">
          {profile.birthdate && <span>📅 {profile.birthdate}</span>}
          {(profile.location_city || profile.location_country) && (
            <span>
              📍 {[profile.location_city, profile.location_country].filter(Boolean).join(', ')}
            </span>
          )}
        </div>
      </section>

      {/* Stats */}
      <section>
        <div className="profile-section-header">
          <h2 className="profile-section-title">Statistics</h2>
        </div>
        <div className="stat-pills">
          <span className="stat-pill">friends: {stats.friends}</span>
          <span className="stat-pill">favorites: {stats.favorites}</span>
          <span className="stat-pill">reviews: {stats.reviews}</span>
        </div>
      </section>

      {/* Favorites */}
      <section>
        <div className="profile-section-header">
          <h2 className="profile-section-title">Favorite Movies</h2>
        </div>

        {favorites.length === 0 ? (
          <p className="profile-empty">No favorites yet</p>
        ) : (
          <div className="profile-rail">
            {favorites.map((m) => {
              const id = m._id || m.imdb_id;
              const title = m.title || 'Untitled';
              return (
                <div
                  key={id || title}
                  className="movie-card"
                  role="button"
                  tabIndex={0}
                  title={title}
                  onClick={() => id && navigate(`/movies-series/${id}`)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && id) {
                      navigate(`/movies-series/${id}`);
                    }
                  }}
                >
                  <img src={m.poster_url || FALLBACK_POSTER} alt={title} loading="lazy" />
                  <h3>{title}</h3>
                  <p className="movie-meta">
                    {m.year ? m.year : 'N/A'} • {m.imdb_type || 'Unknown'}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Reviews */}
      {reviewsEnriched.length > 0 && (
        <section>
          <div className="profile-section-header">
            <h2 className="profile-section-title">Reviews</h2>
          </div>
          <div className="review-grid">
            {reviewsEnriched.map((r, i) => (
              <div key={r._id || i} className="review-card">
                <div style={{ fontWeight: 600 }}>{r.movie_title || 'Untitled Movie'}</div>
                <p style={{ marginTop: '.5rem' }}>{r.review_text}</p>
                {r.date_posted && (
                  <div style={{ opacity: 0.85, marginTop: '.5rem' }}>
                    <em>{r.date_posted}</em>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
