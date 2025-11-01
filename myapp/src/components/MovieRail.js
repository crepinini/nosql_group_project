import React from 'react';
import './MovieRail.css';

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

const formatRuntime = (duration) => {
  if (!duration) {
    return null;
  }
  const minutes = Number(duration);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${String(remaining).padStart(2, '0')}m`;
};

const formatSeasons = (value) => {
  if (value == null) {
    return null;
  }
  if (Array.isArray(value)) {
    const total = value.length;
    if (!total) {
      return null;
    }
    return `${total} season${total === 1 ? '' : 's'}`;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  const rounded = Math.round(parsed);
  return `${rounded} season${rounded === 1 ? '' : 's'}`;
};

const isSeriesEntry = (item) => {
  const type = String(item?.imdb_type || '').toLowerCase();
  if (!type) {
    return false;
  }
  return type.includes('series') || type.startsWith('tv');
};

const MovieRail = ({
  movies = [],
  selectedId,
  onSelect,
  loading = false,
  error = null,
  emptyMessage = 'No related titles yet.',
}) => {
  const safeItems = Array.isArray(movies) ? movies : [];

  return (
    <section className="movie-rail" aria-label="Browse titles">
      <div className="movie-rail__header">
        <h2>Discover More</h2>
        <p>Pick another title to explore its world.</p>
      </div>

      {loading ? (
        <p className="movie-rail__status">Loading related titles...</p>
      ) : error ? (
        <p className="movie-rail__status movie-rail__status--error">{error}</p>
      ) : safeItems.length === 0 ? (
        <p className="movie-rail__status movie-rail__status--empty">
          {emptyMessage}
        </p>
      ) : (
        <div className="movie-rail__scroller">
          {safeItems.map((movie) => {
            const targetId = movie?._id || movie?.imdb_id;
            const isActive = targetId && selectedId === targetId;
            const titleLabel = movie?.title || 'Untitled';
            const yearLabel = resolveYear(movie);
            const typeLabel = movie?.imdb_type
              ? String(movie.imdb_type).toUpperCase()
              : 'TITLE';
            const isSeries = isSeriesEntry(movie);
            const runtimeLabel = formatRuntime(
              movie?.duration ||
                movie?.runtimeMinutes ||
                movie?.runtime ||
                movie?.running_time ||
                movie?.length_minutes,
            );
            const seasonsLabel = isSeries
              ? formatSeasons(
                  movie?.series_total_seasons ||
                    movie?.total_seasons ||
                    movie?.totalSeasons ||
                    movie?.seasons,
                )
              : null;
            const detailParts = [
              yearLabel,
              typeLabel,
              isSeries ? seasonsLabel : runtimeLabel,
            ].filter(Boolean);

            return (
              <button
                key={`${targetId || titleLabel}`}
                type="button"
                onClick={() => (onSelect && movie ? onSelect(movie) : null)}
                className={`movie-rail__item${isActive ? ' movie-rail__item--active' : ''}`}
              >
                <div className="movie-rail__thumb">
                  <img
                    src={
                      movie?.poster_url ||
                      movie?.posterUrl ||
                      FALLBACK_POSTER
                    }
                    alt={`${titleLabel} poster`}
                    loading="lazy"
                  />
                </div>
                <div className="movie-rail__info">
                  <span className="movie-rail__title">{titleLabel}</span>
                  <span className="movie-rail__meta">
                    {detailParts.join(' | ')}
                  </span>
                  {movie?.__reason ? (
                    <span className="movie-rail__reason">{movie.__reason}</span>
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

export default MovieRail;
