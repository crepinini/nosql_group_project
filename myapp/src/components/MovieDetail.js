import React from 'react';
import './MovieDetail.css';

const FALLBACK_POSTER =
  'https://via.placeholder.com/400x600.png?text=Poster+Unavailable';

const formatRuntime = (duration) => {
  if (!duration || Number.isNaN(Number(duration))) {
    return null;
  }
  const totalMinutes = Number(duration);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
};

const STATUS_OPTIONS = [
  { value: 'watching', label: 'Watching' },
  { value: 'watched', label: 'Watched' },
  { value: 'plan', label: 'To watch' },
  { value: 'none', label: 'No status' },
];

const MovieDetail = ({
  movie,
  isFavorite = false,
  onToggleFavorite,
  favoritePending = false,
  favoriteError = null,
  userRating = 0,
  onRateMovie,
  ratingPending = false,
  ratingError = null,
  watchStatus = 'none',
  onWatchStatusChange,
  statusPending = false,
  statusError = null,
  canModify = false,
}) => {
  if (!movie) {
    return (
      <section className="movie-detail movie-detail--empty" aria-live="polite">
        <p>Select a title to explore its details.</p>
      </section>
    );
  }

  const {
    title,
    description,
    duration,
    poster_url: posterUrl,
    genres,
    rating,
    year,
    imdb_type: imdbType,
    series_total_seasons: totalSeasons,
    series_total_episodes: totalEpisodes,
    content_rating: contentRating,
    oscars_won: oscarsWon,
    awards_wins: awardsWins,
    awards_nominations: awardsNominations,
    top_rated_rank: topRatedRank,
  } = movie;

  const runtimeLabel = formatRuntime(duration);
  const typeTitle =
    imdbType === 'TVSeries'
      ? `TV Series${year ? ` - ${year}` : ''}`
      : `Movie${year ? ` - ${year}` : ''}`;

  const extraSeriesInfo =
    imdbType === 'TVSeries'
      ? [
          totalSeasons
            ? `${totalSeasons} season${totalSeasons > 1 ? 's' : ''}`
            : null,
          totalEpisodes
            ? `${totalEpisodes} episode${totalEpisodes > 1 ? 's' : ''}`
            : null,
        ]
          .filter(Boolean)
          .join(' | ')
      : null;

  const parsedTopRank = Number.isFinite(Number(topRatedRank))
    ? Math.round(Number(topRatedRank))
    : null;
  const parsedOscars = Number.isFinite(Number(oscarsWon))
    ? Math.round(Number(oscarsWon))
    : null;
  const parsedWins = Number.isFinite(Number(awardsWins))
    ? Math.round(Number(awardsWins))
    : null;
  const parsedNominations = Number.isFinite(Number(awardsNominations))
    ? Math.round(Number(awardsNominations))
    : null;

  const highlightItems = [];

  if (parsedTopRank && parsedTopRank > 0) {
    const topRatedLabel =
      imdbType === 'TVSeries' ? 'Top rated series' : 'Top rated movie';
    highlightItems.push(`${topRatedLabel} #${parsedTopRank}`);
  }

  if (parsedOscars && parsedOscars > 0) {
    highlightItems.push(
      `Won ${parsedOscars === 1 ? '1 Oscar' : `${parsedOscars} Oscars`}`,
    );
  }

  if ((parsedWins && parsedWins > 0) || (parsedNominations && parsedNominations > 0)) {
    const winsLabel =
      parsedWins && parsedWins > 0
        ? `${parsedWins} win${parsedWins === 1 ? '' : 's'}`
        : null;
    const nominationsLabel =
      parsedNominations && parsedNominations > 0
        ? `${parsedNominations} nomination${parsedNominations === 1 ? '' : 's'}`
        : null;
    const combined = [winsLabel, nominationsLabel].filter(Boolean).join(' & ');
    if (combined) {
      highlightItems.push(`${combined} total`);
    }
  }

  let contentRatingLetter = null;
  if (typeof contentRating === 'string') {
    const match = contentRating.match(/[A-Za-z0-9]/);
    if (match) {
      contentRatingLetter = match[0].toUpperCase();
    }
  }

  const handleFavoriteClick = () => {
    if (!onToggleFavorite || !canModify || favoritePending) {
      return;
    }
    onToggleFavorite();
  };

  const resolvedRating = Number.isFinite(Number(userRating))
    ? Number(userRating)
    : 0;

  const handleRateClick = (value) => {
    if (!onRateMovie || !canModify || ratingPending) {
      return;
    }
    onRateMovie(value);
  };

  return (
    <section
      className="movie-detail"
      aria-labelledby="movie-detail-title"
      id="home"
    >
      <div className="movie-detail__poster">
        <img
          src={posterUrl || FALLBACK_POSTER}
          alt={`Poster for ${title}`}
          loading="lazy"
        />
      </div>

      <div className="movie-detail__content">
        <div className="movie-detail__meta">
          <span className="movie-detail__type">{typeTitle}</span>
          {runtimeLabel ? (
            <span className="movie-detail__runtime">{runtimeLabel}</span>
          ) : null}
          {contentRatingLetter ? (
            <span className="movie-detail__content-rating" aria-label="Content rating">
              {contentRatingLetter}
            </span>
          ) : null}
          {rating ? (
            <span className="movie-detail__score" aria-label="IMDB rating">
              Rating {Number(rating).toFixed(1)}
            </span>
          ) : null}
          <div className="movie-detail__meta-actions">
            <div className="movie-detail__rating" role="group" aria-label="Your rating">
              {[1, 2, 3, 4, 5].map((value) => {
                const isFilled = value <= resolvedRating;
                return (
                  <button
                    key={value}
                    type="button"
                    className={`movie-detail__rating-star${
                      isFilled ? ' movie-detail__rating-star--filled' : ''
                    }`}
                    onClick={() => handleRateClick(value === resolvedRating ? 0 : value)}
                    disabled={!canModify || ratingPending || !onRateMovie}
                    aria-label={`Rate ${value} star${value === 1 ? '' : 's'}`}
                    aria-pressed={isFilled}
                  >
                    {isFilled ? '★' : '☆'}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className={`movie-detail__favorite ${
                isFavorite ? 'movie-detail__favorite--active' : ''
              }`}
              onClick={handleFavoriteClick}
              disabled={!canModify || favoritePending || !onToggleFavorite}
              aria-pressed={isFavorite}
            >
              <span className="movie-detail__favorite-icon" aria-hidden="true">
                {isFavorite ? '★' : '☆'}
              </span>
              <span className="movie-detail__favorite-label">
                {favoritePending
                  ? 'Saving...'
                  : isFavorite
                  ? 'Favorited'
                  : 'Add to favorites'}
              </span>
            </button>

            <label className="movie-detail__status-select">
              <span className="sr-only movie-detail__status-label">Watch status</span>
              <select
                value={watchStatus}
                onChange={(event) =>
                  onWatchStatusChange && onWatchStatusChange(event.target.value)
                }
                disabled={!canModify || statusPending || !onWatchStatusChange}
              >
                {STATUS_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {(!canModify || favoriteError || statusError || ratingError) ? (
            <div className="movie-detail__meta-notes">
              {!canModify ? (
                <span className="movie-detail__action-hint">
                  Sign in to keep favorites, ratings, and statuses in sync.
                </span>
              ) : null}
              {ratingError ? (
                <span className="movie-detail__action-error">{ratingError}</span>
              ) : null}
              {favoriteError ? (
                <span className="movie-detail__action-error">{favoriteError}</span>
              ) : null}
              {!favoriteError && statusError ? (
                <span className="movie-detail__action-error">{statusError}</span>
              ) : null}
            </div>
          ) : null}
        </div>

        <h1 className="movie-detail__title" id="movie-detail-title">
          {title}
        </h1>

        {extraSeriesInfo ? (
          <p className="movie-detail__series-info" id="series">
            {extraSeriesInfo}
          </p>
        ) : null}

        <p className="movie-detail__description">{description}</p>

        {highlightItems.length ? (
          <div className="movie-detail__highlights" role="list">
            {highlightItems.map((item, index) => (
              <span
                className="movie-detail__highlight"
                role="listitem"
                key={`${item}-${index}`}
              >
                {item}
              </span>
            ))}
          </div>
        ) : null}

        <div className="movie-detail__genres" id="movies">
          {genres?.map((genre) => (
            <span key={genre} className="movie-detail__badge">
              {genre}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
};

export default MovieDetail;







