import { useNavigate } from 'react-router-dom';
import './RecommendationRail.css';

const FALLBACK_POSTER =
    'https://via.placeholder.com/400x600.png?text=Poster+Unavailable';

const resolveYear = (item) => {
    if (!item) return null;
    if (item.year) return item.year;
    if (item.release_year) return item.release_year;
    if (item.release_date) {
        const year = Number(String(item.release_date).slice(0, 4));
        return Number.isFinite(year) ? year : null;
    }
    return null;
};

export default function FavoritesRail({ title = "Favorite Movies", items = [] }) {
    const navigate = useNavigate();
    const safeItems = Array.isArray(items) ? items : [];

    return (
        <section className="recommendation-rail" aria-label={title}>
            <div className="recommendation-rail__header">
                <h2>{title}</h2>
            </div>

            {safeItems.length === 0 ? (
                <p className="recommendation-rail__status recommendation-rail__status--empty">
                    No favorites yet
                </p>
            ) : (
                <div className="recommendation-rail__scroller">
                    {safeItems.map((m) => {
                        const id = m._id || m.imdb_id;
                        const movieTitle = m.title || 'Untitled';
                        const year = resolveYear(m);
                        const typeLabel =
                            (m.imdb_type && String(m.imdb_type)) || 'Title';

                        return (
                            <button
                                key={id || movieTitle}
                                type="button"
                                className="recommendation-rail__item"
                                onClick={() => {
                                    if (id) {
                                        navigate(`/movies-series/${encodeURIComponent(id)}`);
                                    }
                                }}
                            >
                                <div className="recommendation-rail__thumb">
                                    <img
                                        src={m.poster_url || FALLBACK_POSTER}
                                        alt={`Poster for ${movieTitle}`}
                                        loading="lazy"
                                    />
                                </div>

                                <div className="recommendation-rail__info">
                                    <span className="recommendation-rail__title">{movieTitle}</span>
                                    <span className="recommendation-rail__meta">
                                        {[year, typeLabel].filter(Boolean).join(' • ')}
                                    </span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
