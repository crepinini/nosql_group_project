import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
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

export default function Profile() {
  const navigate = useNavigate();
  const location = useLocation();

  // Auth info comes from localStorage (no subscription here)
  const [authUser] = useState(() => getStoredUser());

  // Profile data loaded from backend
  const [profile, setProfile] = useState(null);

  // UI data
  const [favorites, setFavorites] = useState([]);
  const [reviewsEnriched, setReviewsEnriched] = useState([]);

  // Friends data
  const [friendsProfiles, setFriendsProfiles] = useState([]);

  // UX state
  const [isLoading, setIsLoading] = useState(!authUser);
  const [error, setError] = useState(null);

  // Which user do we display? (query param has priority)
  const viewedUserId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const q = (params.get('user_id') || '').trim();
    if (q) return q;
    return (authUser?._id || authUser?.username || '').trim();
  }, [location.search, authUser]);

  // Load profile when the viewed user changes (query param or logged user)
  useEffect(() => {
    if (!authUser) {
      setIsLoading(false);
      return;
    }
    if (!viewedUserId) {
      setError('Profile not found');
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        setIsLoading(true);
        setError(null);

        const res = await fetch(`/myprofile?user_id=${encodeURIComponent(viewedUserId)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        setProfile(data);
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
  }, [authUser, viewedUserId]);

  // Friends fetch (depends on the loaded profile)
  useEffect(() => {
    if (!profile?.friends?.length) {
      setFriendsProfiles([]);
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const results = await Promise.all(
          profile.friends.map(async (f) => {
            const id = f._id || f.id;
            if (!id) return null;
            try {
              const res = await fetch(`/users/${encodeURIComponent(id)}`, {
                signal: controller.signal,
              });
              if (!res.ok) return null;
              return await res.json();
            } catch {
              return null;
            }
          })
        );
        setFriendsProfiles(results.filter(Boolean));
      } catch {
        setFriendsProfiles([]);
      }
    })();
    return () => controller.abort();
  }, [profile?._id]);



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

  useEffect(() => {
    if (!profile || !Array.isArray(profile.friends) || profile.friends.length === 0) {
      setFriendsProfiles([]);
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        const results = await Promise.all(
          profile.friends.map(async (f) => {
            const id = f._id || f.id;
            if (!id) return null;
            try {
              const res = await fetch(`/users/${encodeURIComponent(id)}`, {
                signal: controller.signal,
              });
              if (!res.ok) return null;
              return await res.json();
            } catch {
              return null;
            }
          })
        );
        setFriendsProfiles(results.filter(Boolean));
      } catch {
        setFriendsProfiles([]);
      }
    })();

    return () => controller.abort();
  }, [profile?._id]); // <- déclenche quand le profil (ou l'utilisateur) change


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

      {/* Friends */}
      <section>
        <div className="profile-section-header">
          <h2 className="profile-section-title">Friends</h2>
        </div>

        {friendsProfiles.length === 0 ? (
          <p className="profile-empty">No friends yet</p>
        ) : (
          <div className="friends-rail">
            {friendsProfiles.map((friend) => {
              const id = friend._id || friend.imdb_user_id;
              const name = friend.full_name || friend.username || 'Unknown User';
              const city = friend.location_city || '';
              const country = friend.location_country || '';
              const initials = name
                .split(' ')
                .map((n) => n[0])
                .join('')
                .slice(0, 2)
                .toUpperCase();

              return (
                <div
                  key={id}
                  className="friend-card"
                  role="button"
                  tabIndex={0}
                  title={name}
                  onClick={() => id && navigate(`/profile?user_id=${id}`)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && id) {
                      navigate(`/profile?user_id=${id}`);
                    }
                  }}
                >
                  <div className="friend-avatar">
                    <span>{initials}</span>
                  </div>
                  <h3>{name}</h3>
                  <p className="friend-meta">
                    {[city, country].filter(Boolean).join(', ') || '—'}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
