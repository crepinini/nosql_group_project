import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Profile.css';

const FALLBACK_POSTER =
    'https://via.placeholder.com/400x600.png?text=Poster+Unavailable';

export default function Profile() {
    const urlParams = new URLSearchParams(window.location.search);
    const queryUserId = urlParams.get('user_id');
    const pathUserId = window.location.pathname.split('/').pop();
    const isProfileRoute = window.location.pathname.includes('/profile');
    const userId = (isProfileRoute ? (queryUserId || 'U000000000001') : pathUserId) || 'U000000000001';
    const navigate = useNavigate();

    const [profile, setProfile] = useState(null);
    const [favorites, setFavorites] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [err, setErr] = useState(null);
    const [reviewsEnriched, setReviewsEnriched] = useState([]);

    useEffect(() => {
        const run = async () => {
            try {
                setIsLoading(true);
                setErr(null);
                const res = await fetch(`/myprofile?user_id=${encodeURIComponent(userId)}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                setProfile(data);
            } catch (e) {
                console.error(e);
                setErr('Unable to load user profile');
            } finally {
                setIsLoading(false);
            }
        };
        run();
    }, [userId]);

    useEffect(() => {
        if (!profile?.favorites?.length) {
            setFavorites([]);
            return;
        }
        const ids = Array.from(
            new Set(profile.favorites.map(f => f?._id).filter(Boolean))
        );

        let cancelled = false;
        (async () => {
            try {
                const results = await Promise.all(
                    ids.map(async (id) => {
                        try {
                            const r = await fetch(`/movies-series/${id}`);
                            if (!r.ok) return null;
                            return await r.json();
                        } catch {
                            return null;
                        }
                    })
                );
                if (!cancelled) setFavorites(results.filter(Boolean));
            } catch {
                if (!cancelled) setFavorites([]);
            }
        })();

        return () => { cancelled = true; };
    }, [profile]);

    useEffect(() => {

        if (!profile?.reviews?.length) {
            setReviewsEnriched([]);
            return;
        }

        let cancelled = false;

        (async () => {
            try {
                const results = await Promise.all(
                    profile.reviews.map(async (r) => {
                        const id = r._id || r.movie_id || r.imdb_id;
                        if (!id) return r;

                        try {
                            const res = await fetch(`/movies-series/${id}`);
                            if (!res.ok) return r;

                            const movie = await res.json();
                            return {
                                ...r,
                                movie_title: movie.title || r.movie_title,
                                year: movie.year,
                                imdb_type: movie.imdb_type,
                            };
                        } catch {
                            return r;
                        }
                    })
                );

                if (!cancelled) setReviewsEnriched(results);
            } catch {
                if (!cancelled) setReviewsEnriched(profile.reviews);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [profile]);

    const stats = useMemo(() => ({
        friends: profile?.friends?.length || 0,
        favorites: profile?.favorites?.length || 0,
        reviews: profile?.reviews?.length || 0,
    }), [profile]);

    if (isLoading) return <div className="home-content"><p className="loading">Loading profile…</p></div>;
    if (err) return <div className="home-content"><p className="error">{err}</p></div>;
    if (!profile) return <div className="home-content"><p className="error">Profile not found</p></div>;

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
                        <span>📍 {[profile.location_city, profile.location_country].filter(Boolean).join(', ')}</span>
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
                    <h2 className="profile-section-title">Favorites</h2>
                </div>

                {favorites.length === 0 ? (
                    <p className="profile-empty">No favorites</p>
                ) : (
                    <div className="profile-rail">
                        {favorites.map((m) => {
                            const id = m._id || m.imdb_id;
                            return (
                                <div
                                    key={id || m.title}
                                    className="movie-card"
                                    onClick={() => id && navigate(`/movies-series/${id}`)}
                                    title={m.title}
                                    style={{ cursor: 'pointer' }}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) =>
                                        (e.key === 'Enter' || e.key === ' ') && id && navigate(`/movies-series/${id}`)
                                    }
                                >
                                    <img src={m.poster_url || FALLBACK_POSTER} alt={m.title} loading="lazy" />
                                    <h3>{m.title}</h3>
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
        </div>
    );
}
