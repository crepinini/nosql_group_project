import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  getStoredUser,
  storeUser,
  subscribeToAuthChanges,
} from './Login/auth';
import './Profile.css';

const FALLBACK_POSTER =
  'https://via.placeholder.com/400x600.png?text=Poster+Unavailable';

const normalizeFavorites = (profile) =>
  profile?.favorites_movies || profile?.favorites || [];

const resolveUserId = (authUser) => {
  const urlParams = new URLSearchParams(window.location.search);
  const queryUserId = urlParams.get('user_id');
  if (queryUserId) {
    return queryUserId.trim();
  }
  return (authUser?._id || authUser?.username || '').trim();
};

const Profile = () => {
  const navigate = useNavigate();
  const [authUser, setAuthUser] = useState(() => getStoredUser());
  const [profile, setProfile] = useState(() => getStoredUser());
  const [favorites, setFavorites] = useState([]);
  const [reviewsEnriched, setReviewsEnriched] = useState([]);
  const [isLoading, setIsLoading] = useState(!authUser);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handleAuthChange = () => {
      const nextUser = getStoredUser();
      setAuthUser(nextUser);
      setProfile(nextUser);
      setError(null);
    };

    const unsubscribe = subscribeToAuthChanges(handleAuthChange);
    window.addEventListener('storage', handleAuthChange);

    return () => {
      unsubscribe();
      window.removeEventListener('storage', handleAuthChange);
    };
  }, []);

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

    const loadProfile = async () => {
      try {
        const cachedFavorites = normalizeFavorites(authUser);
        if (!cachedFavorites.length) {
          setIsLoading(true);
        }
        setError(null);

        const response = await fetch(
          `/myprofile?user_id=${encodeURIComponent(userId)}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        setProfile(data);
        storeUser({ ...authUser, ...data });
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error(err);
          setError('Unable to load user profile');
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();

    return () => controller.abort();
  }, [authUser]);

  useEffect(() => {
    const favoriteEntries = normalizeFavorites(profile);
    if (!favoriteEntries.length) {
      setFavorites([]);
      return;
    }

    const ids = Array.from(
      new Set(favoriteEntries.map((entry) => entry?._id).filter(Boolean)),
    );

    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(
          ids.map(async (id) => {
            try {
              const response = await fetch(`/movies-series/${id}`);
              if (!response.ok) {
                return null;
              }
              return await response.json();
            } catch {
              return null;
            }
          }),
        );

        if (!cancelled) {
          setFavorites(results.filter(Boolean));
        }
      } catch {
        if (!cancelled) {
          setFavorites([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profile]);

  useEffect(() => {
    const reviewEntries = profile?.reviews || [];
    if (!reviewEntries.length) {
      setReviewsEnriched([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(
          reviewEntries.map(async (review) => {
            const id = review._id || review.movie_id || review.imdb_id;
            if (!id) {
              return review;
            }

            try {
              const response = await fetch(`/movies-series/${id}`);
              if (!response.ok) {
                return review;
              }

              const movie = await response.json();
              return {
                ...review,
                movie_title: movie.title || review.movie_title,
                year: movie.year || review.year,
                imdb_type: movie.imdb_type || review.imdb_type,
              };
            } catch {
              return review;
            }
          }),
        );

        if (!cancelled) {
          setReviewsEnriched(results);
        }
      } catch {
        if (!cancelled) {
          setReviewsEnriched(reviewEntries);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profile]);

  const stats = useMemo(
    () => ({
      friends: profile?.friends?.length || 0,
      favorites: normalizeFavorites(profile).length,
      reviews: profile?.reviews?.length || 0,
    }),
    [profile],
  );

  if (!authUser) {
    return <Navigate to="/login" replace />;
  }

  if (isLoading) {
    return (
      <div className="home-content">
        <p className="loading">Loading profile…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="home-content">
        <p className="error">{error}</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="home-content">
        <p className="error">Profile not found</p>
      </div>
    );
  }

  return (
    <div className="profile-page">
      <section className="profile-hero">
        <h1>{profile.full_name || profile.username || 'Profile'}</h1>
        {profile.username ? (
          <div className="profile-handle">@{profile.username}</div>
        ) : null}
        {profile.about_me ? (
          <p className="profile-about">{profile.about_me}</p>
        ) : null}
        <div className="profile-meta">
          {profile.birthdate ? <span>📅 {profile.birthdate}</span> : null}
          {profile.location_city || profile.location_country ? (
            <span>
              📍{' '}
              {[profile.location_city, profile.location_country]
                .filter(Boolean)
                .join(', ')}
            </span>
          ) : null}
        </div>
      </section>

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

      <section>
        <div className="profile-section-header">
          <h2 className="profile-section-title">Favorite Movies</h2>
        </div>

        {favorites.length === 0 ? (
          <p className="profile-empty">No favorites yet</p>
        ) : (
          <div className="profile-rail">
            {favorites.map((movie) => {
              const id = movie._id || movie.imdb_id;
              const title = movie.title || 'Untitled';
              return (
                <div
                  key={id || title}
                  className="movie-card"
                  role="button"
                  tabIndex={0}
                  title={title}
                  onClick={() => id && navigate(`/movies-series/${id}`)}
                  onKeyDown={(event) => {
                    if ((event.key === 'Enter' || event.key === ' ') && id) {
                      navigate(`/movies-series/${id}`);
                    }
                  }}
                >
                  <img
                    src={movie.poster_url || FALLBACK_POSTER}
                    alt={title}
                    loading="lazy"
                  />
                  <h3>{title}</h3>
                  <p className="movie-meta">
                    {movie.year ? movie.year : 'N/A'} • {movie.imdb_type || 'Unknown'}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {reviewsEnriched.length > 0 ? (
        <section>
          <div className="profile-section-header">
            <h2 className="profile-section-title">Reviews</h2>
          </div>
          <div className="review-grid">
            {reviewsEnriched.map((review, index) => (
              <div key={review._id || index} className="review-card">
                <div style={{ fontWeight: 600 }}>
                  {review.movie_title || 'Untitled Movie'}
                </div>
                <p style={{ marginTop: '.5rem' }}>{review.review_text}</p>
                {review.date_posted ? (
                  <div style={{ opacity: 0.85, marginTop: '.5rem' }}>
                    <em>{review.date_posted}</em>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
};

export default Profile;
