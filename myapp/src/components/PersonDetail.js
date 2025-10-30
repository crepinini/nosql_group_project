import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import './PersonDetail.css';

const FALLBACK_PHOTO =
  'https://ui-avatars.com/api/?name=MM&background=023047&color=ffffff&size=512&length=2';

const FALLBACK_POSTER =
  'https://via.placeholder.com/200x300.png?text=No+Poster';

const normalizeType = (value) => {
  if (!value) return null;
  const label = String(value).toLowerCase();
  if (label.includes('tv')) return 'TV Series';
  if (label.includes('series')) return 'TV Series';
  if (label.includes('movie') || label.includes('film')) return 'Movie';
  return value;
};

const extractYear = (entry) => {
  if (!entry) return null;
  if (entry.year) {
    return entry.year;
  }
  if (entry.release_date) {
    const parsed = new Date(entry.release_date);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getFullYear();
    }
  }
  return null;
};

const PersonDetail = ({
  person,
  knownForDetails = [],
  isFavorite = false,
  onToggleFavorite,
  favoritePending = false,
  favoriteError = null,
  canModify = false,
}) => {
  const [isBiographyExpanded, setBiographyExpanded] = useState(false);

  useEffect(() => {
    setBiographyExpanded(false);
  }, [person?.biography]);

  if (!person) {
    return null;
  }

  const {
    name,
    photo_url: photoUrl,
    biography,
    role,
    movie: knownFor,
    url: externalUrl,
  } = person;

  const knownForMap = new Map(
    (knownForDetails || [])
      .filter((entry) => entry && entry._id)
      .map((entry) => [entry._id, entry]),
  );

  const displayKnownFor = Array.isArray(knownFor)
    ? knownFor.map((entry) => {
        if (entry?._id && knownForMap.has(entry._id)) {
          return { ...knownForMap.get(entry._id), ...entry };
        }
        return entry;
      })
    : knownForDetails || [];

  const biographyText = typeof biography === 'string' ? biography : '';
  const shouldClampBiography = biographyText.trim().length > 400;
  const canFavorite = typeof onToggleFavorite === 'function';

  const biographyClassName = [
    'person-detail__biography',
    shouldClampBiography && !isBiographyExpanded
      ? 'person-detail__biography--clamped'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className="person-detail" aria-labelledby="person-detail-title">
      <div className="person-detail__main">
        <div className="person-detail__photo">
          <img
            src={photoUrl || FALLBACK_PHOTO}
            alt={`Portrait of ${name}`}
            loading="lazy"
          />
        </div>

        <div className="person-detail__body">
          <div className="person-detail__header">
            <h1 className="person-detail__title" id="person-detail-title">
              {name}
            </h1>
            <div className="person-detail__header-actions">
              {externalUrl ? (
                <a
                  className="person-detail__external"
                  href={externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on IMDb
                </a>
              ) : null}
              {canFavorite ? (
                <button
                  type="button"
                  className={`person-detail__favorite${
                    isFavorite ? ' person-detail__favorite--active' : ''
                  }`}
                  onClick={() => {
                    if (!favoritePending && canModify && onToggleFavorite) {
                      onToggleFavorite();
                    }
                  }}
                  disabled={!canModify || favoritePending || !onToggleFavorite}
                  aria-pressed={isFavorite}
                >
                  <span className="person-detail__favorite-icon" aria-hidden="true">
                    {isFavorite ? '★' : '☆'}
                  </span>
                  <span className="person-detail__favorite-label">
                    {favoritePending
                      ? 'Saving...'
                      : isFavorite
                      ? 'Favorited'
                      : 'Add to favorites'}
                  </span>
                </button>
              ) : null}
            </div>
          </div>

          {Array.isArray(role) && role.length > 0 ? (
            <div className="person-detail__roles">
              {role.map((entry) => (
                <span key={entry} className="person-detail__badge">
                  {entry}
                </span>
              ))}
            </div>
          ) : null}

          {biographyText ? (
            <>
              <p className={biographyClassName}>{biographyText}</p>
              {shouldClampBiography ? (
                <button
                  type="button"
                  className="person-detail__biography-toggle"
                  onClick={() => setBiographyExpanded((prev) => !prev)}
                >
                  {isBiographyExpanded ? 'See less' : 'See more'}
                </button>
              ) : null}
            </>
          ) : (
            <p className="person-detail__biography person-detail__biography--muted">
              We don&apos;t have a biography for this person just yet.
            </p>
          )}

          {canFavorite && (!canModify || favoriteError) ? (
            <div className="person-detail__favorite-messages">
              {!canModify ? (
                <span className="person-detail__favorite-hint">
                  Sign in to keep your favorite people in sync.
                </span>
              ) : null}
              {favoriteError ? (
                <span className="person-detail__favorite-error">{favoriteError}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {Array.isArray(displayKnownFor) && displayKnownFor.length > 0 ? (
        <div className="person-detail__known-for">
          <div className="person-detail__known-for-meta">
            <h2>Known For</h2>
            <span className="person-detail__known-for-count">
              {displayKnownFor.length}{' '}
              {displayKnownFor.length === 1 ? 'title' : 'titles'}
            </span>
          </div>
          <div className="person-detail__known-for-rail">
            {displayKnownFor.map((entry) => {
              const id = entry?._id || entry?.movie_id;
              const title = entry?.title || 'Untitled';
              const poster = entry?.poster_url || FALLBACK_POSTER;
              const year = extractYear(entry);
              const typeLabel = normalizeType(entry?.imdb_type || entry?.type);
              const metaParts = [year, typeLabel ? typeLabel.toUpperCase() : null].filter(Boolean);
              const metaText = metaParts.length ? metaParts.join(' | ') : '|';

              const content = (
                <>
                  <div className="person-detail__known-for-poster">
                    <img src={poster} alt={title} loading="lazy" />
                  </div>
                  <span className="person-detail__known-for-title">
                    {title}
                  </span>
                  <span className="person-detail__known-for-meta">{metaText}</span>
                </>
              );

              if (id) {
                return (
                  <Link
                    key={id}
                    to={`/movies-series/${id}`}
                    className="person-detail__known-for-card"
                  >
                    {content}
                  </Link>
                );
              }

              return (
                <div
                  key={title}
                  className="person-detail__known-for-card person-detail__known-for-card--disabled"
                >
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
};

PersonDetail.propTypes = {
  person: PropTypes.shape({
    name: PropTypes.string,
    photo_url: PropTypes.string,
    biography: PropTypes.string,
    role: PropTypes.arrayOf(PropTypes.string),
    url: PropTypes.string,
    movie: PropTypes.arrayOf(
      PropTypes.shape({
        _id: PropTypes.string,
        title: PropTypes.string,
      }),
    ),
  }),
  knownForDetails: PropTypes.arrayOf(
    PropTypes.shape({
      _id: PropTypes.string,
      title: PropTypes.string,
      poster_url: PropTypes.string,
      imdb_type: PropTypes.string,
      type: PropTypes.string,
      year: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
      release_date: PropTypes.string,
    }),
  ),
  isFavorite: PropTypes.bool,
  onToggleFavorite: PropTypes.func,
  favoritePending: PropTypes.bool,
  favoriteError: PropTypes.string,
  canModify: PropTypes.bool,
};

PersonDetail.defaultProps = {
  knownForDetails: [],
  isFavorite: false,
  onToggleFavorite: null,
  favoritePending: false,
  favoriteError: null,
  canModify: false,
};

export default PersonDetail;
