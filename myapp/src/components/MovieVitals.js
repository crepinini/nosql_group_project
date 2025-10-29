import React from 'react';
import './MovieVitals.css';

const MovieVitals = ({
  movie,
  favoriteFriends = [],
  isFriendsLoading = false,
  friendsError = null,
  hasFriendNetwork = false,
}) => {
  if (!movie) {
    return null;
  }

  const { country, languages, genre_interests: genreInterests } = movie;

  const languageList = Array.isArray(languages)
    ? languages.filter(Boolean)
    : [];
  const interestList = Array.isArray(genreInterests)
    ? genreInterests.filter(Boolean)
    : [];
  const countryList = country ? [country] : [];
  const friendNames = Array.isArray(favoriteFriends)
    ? favoriteFriends.map((entry) => entry?.name).filter(Boolean)
    : [];
  const shouldShowFriendsCard =
    isFriendsLoading || friendsError || friendNames.length > 0 || hasFriendNetwork;

  if (
    !interestList.length &&
    !languageList.length &&
    !countryList.length &&
    !shouldShowFriendsCard
  ) {
    return null;
  }

  const cards = [];

  if (languageList.length) {
    cards.push(
      <div className="movie-vitals__card" key="languages">
        <span className="movie-vitals__card-label">Languages</span>
        <div className="movie-vitals__chips movie-vitals__chips--row" role="list">
          {languageList.map((item, index) => (
            <span
              className="movie-vitals__chip"
              role="listitem"
              key={`languages-${item}-${index}`}
            >
              {item}
            </span>
          ))}
        </div>
      </div>,
    );
  }

  if (countryList.length) {
    cards.push(
      <div className="movie-vitals__card movie-vitals__card--country" key="country">
        <span className="movie-vitals__card-label">Country</span>
        <div className="movie-vitals__chips movie-vitals__chips--row" role="list">
          {countryList.map((item, index) => (
            <span
              className="movie-vitals__chip"
              role="listitem"
              key={`country-${item}-${index}`}
            >
              {item}
            </span>
          ))}
        </div>
      </div>,
    );
  }

  if (shouldShowFriendsCard) {
    cards.push(
      <div className="movie-vitals__card movie-vitals__card--friends" key="friends">
        <span className="movie-vitals__card-label">
          {friendNames.length
            ? `Liked by ${friendNames.length} friend${friendNames.length === 1 ? '' : 's'}`
            : 'Liked by friends'}
        </span>

        {friendsError ? (
          <div className="movie-vitals__friends-status movie-vitals__friends-status--error">
            {friendsError}
          </div>
        ) : null}

        {isFriendsLoading ? (
          <div className="movie-vitals__friends-status" role="status">
            Checking your friends list...
          </div>
        ) : null}

        {!isFriendsLoading && !friendsError && friendNames.length === 0 ? (
          <p className="movie-vitals__friends-empty">
            {hasFriendNetwork
              ? 'None of your friends have added this title to their favorites yet.'
              : 'Sign in to connect with friends and see who favorites this title.'}
          </p>
        ) : null}

        {friendNames.length ? (
          <div className="movie-vitals__chips movie-vitals__chips--row" role="list">
            {friendNames.map((name) => (
              <span className="movie-vitals__chip" role="listitem" key={`friend-${name}`}>
                {name}
              </span>
            ))}
          </div>
        ) : null}
      </div>,
    );
  }

  return (
    <section className="movie-vitals" aria-label="Additional movie context">
      {interestList.length ? (
        <div className="movie-vitals__chips movie-vitals__chips--inline" role="list">
          {interestList.map((item, index) => (
            <span
              className="movie-vitals__chip movie-vitals__chip--inline"
              role="listitem"
              key={`genre-interests-${item}-${index}`}
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}

      {cards.length ? <div className="movie-vitals__grid">{cards}</div> : null}
    </section>
  );
};

export default MovieVitals;
