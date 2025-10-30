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

  // Friend requests
  const [friendRequests, setFriendRequests] = useState([]);
  const [showRequests, setShowRequests] = useState(false);
  // Friend requests UI state for the "Add friend" button
  const [isFriendAlready, setIsFriendAlready] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [sendingRequest, setSendingRequest] = useState(false);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [incomingRequest, setIncomingRequest] = useState(null);



  useEffect(() => {
    if (!authUser?._id || !profile?._id) return;
    if (authUser._id !== profile._id) return;

    let abort = false;

    async function fetchFriendRequests() {
      try {
        const res = await fetch(
          `http://localhost:5001/friend-requests/${authUser._id}`
        );
        if (!res.ok) {
          console.error('Failed to load friend requests', res.status);
          return;
        }
        const data = await res.json();
        if (!abort) {
          setFriendRequests(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('Error loading friend requests', err);
      }
    }

    fetchFriendRequests();

    return () => { abort = true; };
  }, [authUser?._id, profile?._id]);



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

  // Friend requests (only for current user)
  useEffect(() => {
    // on vérifie qu'on affiche bien le profil du user connecté
    if (!authUser || !profile || authUser._id !== profile._id) {
      return;
    }

    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`http://localhost:5001/friend-requests/${authUser._id}`, {
          signal: controller.signal,
        });

        if (!res.ok) {
          console.error("Failed to fetch friend requests", res.status);
          setPendingRequests([]);
          return;
        }

        const data = await res.json();
        setPendingRequests(data); // on stocke les demandes reçues
      } catch (err) {
        if (err.name !== "AbortError") console.error("friend requests fetch error", err);
      }
    })();

    return () => controller.abort();
  }, [authUser?._id, profile?._id]);

  // Detect if the viewed profile has sent a friend request to current user
  useEffect(() => {
    if (!authUser || !profile || authUser._id === profile._id) return;

    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`http://localhost:5001/friend-requests/${authUser._id}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;

        const data = await res.json();
        const match = data.find((req) => req.from_user === profile._id);
        setIncomingRequest(match || null);
      } catch (err) {
        if (err.name !== "AbortError") console.error("incoming request check failed", err);
      }
    })();

    return () => controller.abort();
  }, [authUser?._id, profile?._id]);


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
  }, [profile?._id]);

  useEffect(() => {
    if (!profile || !authUser) {
      setIsFriendAlready(false);
      return;
    }

    if (profile._id === authUser._id) {
      setIsFriendAlready(false);
      return;
    }

    const theirFriends = Array.isArray(profile.friends) ? profile.friends : [];
    const theirFriendIds = theirFriends.map(f =>
      typeof f === 'string' ? f : f?._id
    );

    if (theirFriendIds.includes(authUser._id)) {
      setIsFriendAlready(true);
    } else {
      setIsFriendAlready(false);
    }
  }, [profile, authUser]);



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

  async function handleSendFriendRequest() {
    if (!authUser || !profile) return;
    if (authUser._id === profile._id) return; // pas s'ajouter soi-même

    setSendingRequest(true);

    try {
      const res = await fetch('http://localhost:5001/friend-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_user: authUser._id,
          to_user: profile._id,
        }),
      });

      if (!res.ok) {
        console.error('Friend request failed', res.status);

        return;
      }

      const data = await res.json();
      console.log('Friend request result:', data);


      setRequestSent(true);
    } finally {
      setSendingRequest(false);
    }
  }

  async function handleAcceptRequest(requestId) {
    try {
      const res = await fetch(
        `http://localhost:5001/friend-request/${requestId}/accept`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!res.ok) {
        console.error('accept failed', res.status);
        return;
      }

      setFriendRequests((prev) =>
        Array.isArray(prev) ? prev.filter((r) => r.request_id !== requestId) : []
      );

      if (incomingRequest && incomingRequest.request_id === requestId) {
        setIncomingRequest(null);
        setIsFriendAlready(true);
      }

      if (authUser && authUser._id === profile._id) {
        const resProfile = await fetch(`/myprofile?user_id=${authUser._id}`);
        if (resProfile.ok) {
          const data = await resProfile.json();
          setProfile(data);
        }
      } else {
        const resOther = await fetch(`/myprofile?user_id=${profile._id}`);
        if (resOther.ok) {
          const data = await resOther.json();
          setProfile(data);
        }
      }
    } catch (err) {
      console.error('accept error', err);
    }
  }


  async function handleIgnoreRequest(requestId) {
    try {
      const res = await fetch(
        `http://localhost:5001/friend-request/${requestId}/ignore`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!res.ok) {
        console.error('ignore failed', res.status);
        return;
      }

      setFriendRequests((prev) =>
        Array.isArray(prev) ? prev.filter((r) => r.request_id !== requestId) : []
      );

      if (incomingRequest && incomingRequest.request_id === requestId) {
        setIncomingRequest(null);
      }

      if (authUser && authUser._id === profile._id) {
        const resProfile = await fetch(`/myprofile?user_id=${authUser._id}`);
        if (resProfile.ok) {
          const data = await resProfile.json();
          setProfile(data);
        }
      }
    } catch (err) {
      console.error('ignore error', err);
    }
  }


  return (
    <div className="profile-page">
      {/* Banner */}
      <section className="profile-hero">
        <h1>{profile.full_name || profile.username || 'Profile'}</h1>

        {profile.username && (
          <div className="profile-handle">@{profile.username}</div>
        )}

        {profile.about_me && (
          <p className="profile-about">{profile.about_me}</p>
        )}

        <div className="profile-meta">
          {profile.birthdate && <span>📅 {profile.birthdate}</span>}
          {(profile.location_city || profile.location_country) && (
            <span>
              📍 {[
                profile.location_city,
                profile.location_country,
              ]
                .filter(Boolean)
                .join(', ')}
            </span>
          )}
        </div>

        <div className="friend-action-wrapper">
          {authUser?._id === profile._id && (
            <div className="friend-requests-container">
              <button
                className="friend-requests-button"
                onClick={() => setShowRequests(!showRequests)}
              >
                👥 Friend Requests ({friendRequests.length})
              </button>

              {showRequests && (
                <div className="friend-requests-popup">
                  {friendRequests.length === 0 ? (
                    <p>No pending requests</p>
                  ) : (
                    friendRequests.map((req) => (
                      <li key={req.request_id} className="friend-requests-item">
                        <div className="friend-request-header">
                          <button
                            className="friend-request-link"
                            onClick={() => {
                              navigate(`/profile?user_id=${req.from_user}`);
                            }}
                          >
                            {req.from_full_name || req.from_username || 'Unknown User'}
                          </button>

                          <div className="friend-request-actions">
                            <button
                              className="friend-request-accept"
                              onClick={() => handleAcceptRequest(req.request_id)}
                            >
                              Accept
                            </button>

                            <button
                              className="friend-request-ignore"
                              onClick={() => handleIgnoreRequest(req.request_id)}
                            >
                              Ignore
                            </button>
                          </div>
                        </div>
                      </li>

                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* Displayed on other users' profiles */}
          {authUser?._id !== profile._id && (
            <>
              {isFriendAlready ? (
                <div className="friend-status-badge">✓ Friends</div>
              ) : incomingRequest ? (
                // cette personne t'a envoyé une demande
                <div className="incoming-request-actions">
                  <div className="incoming-request-label">
                    {profile.full_name || profile.username || 'This user'} wants to be your friend
                  </div>

                  <div className="incoming-request-buttons">
                    <button
                      className="friend-request-accept"
                      onClick={() => handleAcceptRequest(incomingRequest.request_id)}
                    >
                      Accept
                    </button>

                    <button
                      className="friend-request-ignore"
                      onClick={() => handleIgnoreRequest(incomingRequest.request_id)}
                    >
                      Ignore
                    </button>
                  </div>
                </div>
              ) : requestSent ? (
                <div className="friend-status-badge pending">Request sent</div>
              ) : (
                <button
                  className="add-friend-button"
                  disabled={sendingRequest}
                  onClick={handleSendFriendRequest}
                >
                  {sendingRequest ? 'Sending…' : 'Add friend'}
                </button>
              )}
            </>
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
                  <img
                    src={m.poster_url || FALLBACK_POSTER}
                    alt={title}
                    loading="lazy"
                  />
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
                <div style={{ fontWeight: 600 }}>
                  {r.movie_title || 'Untitled Movie'}
                </div>
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
              const name =
                friend.full_name || friend.username || 'Unknown User';
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
