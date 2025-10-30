import React from 'react';
import { useNavigate } from 'react-router-dom';
import './RecommendationRail.css';

const FALLBACK_POSTER =
  'https://via.placeholder.com/400x600.png?text=Poster+Unavailable';

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

const RecommendationRail = ({
  title,
  subtitle = '',
  items = [],
  loading = false,
  error = null,
  emptyMessage = 'Nothing to recommend yet.',
}) => {
  const navigate = useNavigate();
  const safeItems = Array.isArray(items) ? items : [];

  return (
    <section className="recommendation-rail" aria-label={title}>
      <div className="recommendation-rail__header">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>

      {loading ? (
        <p className="recommendation-rail__status">Loading recommendations…</p>
      ) : error ? (
        <p className="recommendation-rail__status recommendation-rail__status--error">
          {error}
        </p>
      ) : safeItems.length === 0 ? (
        <p className="recommendation-rail__status recommendation-rail__status--empty">
          {emptyMessage}
        </p>
      ) : (
        <div className="recommendation-rail__scroller">
          {safeItems.map((movie) => {
            const targetId = movie?._id || movie?.imdb_id;
            const titleLabel = movie?.title || 'Untitled';
            const year = resolveYear(movie);
            const typeLabel =
              (movie?.imdb_type && String(movie.imdb_type)) || 'Title';

            return (
              <button
                key={`${targetId || titleLabel}`}
                type="button"
                className="recommendation-rail__item"
                onClick={() => {
                  if (targetId) {
                    navigate(`/movies-series/${targetId}`);
                  }
                }}
              >
                <div className="recommendation-rail__thumb">
                  <img
                    src={movie?.poster_url || FALLBACK_POSTER}
                    alt={`Poster for ${titleLabel}`}
                    loading="lazy"
                  />
                </div>
                <div className="recommendation-rail__info">
                  <span className="recommendation-rail__title">{titleLabel}</span>
                  <span className="recommendation-rail__meta">
                    {[year, typeLabel].filter(Boolean).join(' • ')}
                  </span>
                  {movie?.__reason ? (
                    <span className="recommendation-rail__reason">{movie.__reason}</span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default RecommendationRail;
