import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import MovieDetail from '../components/MovieDetail';
import MoviePeople from '../components/MoviePeople';
import MovieTrailer from '../components/MovieTrailer';
import MovieRail from '../components/MovieRail';
import MovieVitals from '../components/MovieVitals';
import MovieDiscussion from '../components/MovieDiscussion';
import { buildMoviesUrl, buildUsersUrl } from '../config';
import {
  getStoredUser,
  storeUser,
  subscribeToAuthChanges,
} from '../components/Login/auth';

const curatedSelection = (movies) => {
  const filtered = movies.filter(
    (movie) => movie?.title && movie?.poster_url && movie?.description,
  );

  return filtered
    .sort((a, b) => {
      const ratingA = Number.isFinite(Number(a.rating)) ? Number(a.rating) : 0;
      const ratingB = Number.isFinite(Number(b.rating)) ? Number(b.rating) : 0;
      return ratingB - ratingA;
    })
    .slice(0, 18);
};

const inferCollectionType = (entity) => {
  if (!entity) {
    return 'movie';
  }
  const raw = String(entity.imdb_type || entity.type || '').toLowerCase();
  if (!raw) {
    return 'movie';
  }
  if (raw.startsWith('tv')) {
    return 'series';
  }
  if (raw.includes('series') && !raw.includes('movie')) {
    return 'series';
  }
  return raw.includes('movie') ? 'movie' : 'movie';
};

const gatherIdentifiers = (entry) => {
  const values = new Set();
  const consider = (value) => {
    if (value === null || value === undefined) {
      return;
    }
    const text = String(value).trim();
    if (text) {
      values.add(text);
    }
  };
  if (typeof entry === 'string' || typeof entry === 'number') {
    consider(entry);
  } else if (entry && typeof entry === 'object') {
    ['_id', 'id', 'movie_id', 'imdb_id'].forEach((key) => {
      consider(entry[key]);
    });
  }
  return Array.from(values);
};

const extractFavoritesList = (authUser) => {
  if (!authUser) {
    return [];
  }
  if (Array.isArray(authUser.favorites_movies)) {
    return authUser.favorites_movies;
  }
  if (Array.isArray(authUser.favorites)) {
    return authUser.favorites;
  }
  return [];
};

const extractRatingsMap = (authUser) => {
  const source = authUser?.movie_ratings;
  return source && typeof source === 'object' ? source : {};
};

const extractCommentRecord = (authUser, movieId) => {
  if (!authUser || !movieId) {
    return null;
  }
  const comments = authUser?.movie_comments;
  if (!comments || typeof comments !== 'object') {
    return null;
  }
  return comments[movieId] || null;
};

const formatFriendCommentDate = (value) => {
  if (!value) {
    return '';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const MovieDetailPage = () => {
  const navigate = useNavigate();
  const { movieId } = useParams();
  const handleGoBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/home');
    }
  };
  const [movies, setMovies] = useState([]);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [favoriteFriends, setFavoriteFriends] = useState([]);
  const [friendsStatus, setFriendsStatus] = useState({
    loading: false,
    error: null,
  });
  const [hasFriendNetwork, setHasFriendNetwork] = useState(false);
  const [authUser, setAuthUser] = useState(() => getStoredUser());
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoritePending, setFavoritePending] = useState(false);
  const [favoriteError, setFavoriteError] = useState(null);
  const [watchStatus, setWatchStatus] = useState('none');
  const [statusPending, setStatusPending] = useState(false);
  const [statusError, setStatusError] = useState(null);
  const [userRating, setUserRating] = useState(0);
  const [ratingPending, setRatingPending] = useState(false);
  const [ratingError, setRatingError] = useState(null);
  const [userComment, setUserComment] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [commentPending, setCommentPending] = useState(false);
  const [commentError, setCommentError] = useState(null);
  const [friendComments, setFriendComments] = useState([]);
  const [isEditingComment, setIsEditingComment] = useState(false);
  const [relatedTitles, setRelatedTitles] = useState([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState(null);

  useEffect(() => {
    const handleAuthChange = () => {
      setAuthUser(getStoredUser());
    };
    const unsubscribe = subscribeToAuthChanges(handleAuthChange);
    window.addEventListener('storage', handleAuthChange);

    return () => {
      unsubscribe();
      window.removeEventListener('storage', handleAuthChange);
    };
  }, []);


  useEffect(() => {
    const controller = new AbortController();

    const loadMovies = async () => {
      const endpoint = buildMoviesUrl('/movies-series');

      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch(endpoint, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('Unable to load movie data');
        }

        const payload = await response.json();
        const selection = curatedSelection(payload);

        setMovies(selection);
        if (movieId) {
          const match = selection.find((entry) => entry._id === movieId);
          setSelectedMovie(match ?? selection[0] ?? null);
        } else {
          setSelectedMovie(selection[0] ?? null);
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          const baseMessage =
            err.message || 'Unknown error loading movies from the API';
          const hint = endpoint.startsWith('http')
            ? `Please verify the service at ${endpoint} is reachable.`
            : 'Please verify the service is reachable through the development proxy (port 5000).';
          setError(`${baseMessage}. ${hint}`);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadMovies();

    return () => controller.abort();
  }, [movieId]);

  const heroMovie = useMemo(() => {
    if (selectedMovie) {
      return selectedMovie;
    }

    return movies.find((entry) => entry._id === movieId) ?? movies[0] ?? null;
  }, [movies, selectedMovie, movieId]);

  const heroMovieId = heroMovie?._id;
  const heroMovieImdbId = heroMovie?.imdb_id;
  const userId = authUser?._id || authUser?.username || null;
  const selectedMovieKey = useMemo(() => {
    if (!selectedMovie) {
      return '';
    }
    const identifiers = gatherIdentifiers(selectedMovie);
    return identifiers.sort().join('|');
  }, [selectedMovie]);
  const favoriteIdentifiers = useMemo(() => {
    const favorites = extractFavoritesList(authUser);
    const set = new Set();
    favorites.forEach((entry) => {
      gatherIdentifiers(entry).forEach((id) => set.add(id));
    });
    return Array.from(set);
  }, [authUser]);
  const favoriteIdentifiersKey = useMemo(
    () => favoriteIdentifiers.slice().sort().join(','),
    [favoriteIdentifiers],
  );

  useEffect(() => {
    const baseId = selectedMovie?._id || selectedMovie?.imdb_id;
    if (!baseId) {
      setRelatedTitles([]);
      setRelatedError(null);
      setRelatedLoading(false);
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        setRelatedLoading(true);
        setRelatedError(null);
        const params = new URLSearchParams();
        params.set('limit', '18');
        params.set('min_shared', '2');
        const inferredType = inferCollectionType(selectedMovie);
        params.set('type', inferredType);

        const combinedExclude = new Set(favoriteIdentifiers);
        gatherIdentifiers(selectedMovie).forEach((id) =>
          combinedExclude.add(id),
        );
        if (combinedExclude.size) {
          params.set('exclude', Array.from(combinedExclude).join(','));
        }
        if (favoriteIdentifiers.length) {
          params.set('favorite_ids', favoriteIdentifiers.join(','));
        }
        const endpoint = buildMoviesUrl(
          `/movies-series/${encodeURIComponent(
            baseId,
          )}/related?${params.toString()}`,
        );
        const response = await fetch(endpoint, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        setRelatedTitles(Array.isArray(payload) ? payload : []);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Failed to load related titles', err);
          setRelatedTitles([]);
          setRelatedError(
            'Unable to load related titles. Try refreshing the page.',
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setRelatedLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [selectedMovieKey, favoriteIdentifiersKey, selectedMovie, favoriteIdentifiers]);

  useEffect(() => {
    if (!heroMovieId) {
      setIsFavorite(false);
      setWatchStatus('none');
      setUserRating(0);
      setUserComment('');
      setCommentDraft('');
      setIsEditingComment(false);
      return;
    }

    const favoritesList = extractFavoritesList(authUser);
    const membership = favoritesList.some((entry) => entry?._id === heroMovieId);
    setIsFavorite(membership);

    const statusMap = authUser?.watch_statuses || {};
    const normalizedStatus = statusMap?.[heroMovieId] || 'none';
    setWatchStatus(normalizedStatus);

    const ratingsMap = extractRatingsMap(authUser);
    const ratingValue = Number(ratingsMap?.[heroMovieId]) || 0;
    setUserRating(ratingValue);

    const commentRecord = extractCommentRecord(authUser, heroMovieId);
    const commentText =
      commentRecord && typeof commentRecord.text === 'string'
        ? commentRecord.text
        : '';
    setUserComment(commentText);
    setCommentDraft(commentText);
    setIsEditingComment(false);
  }, [authUser, heroMovieId]);

  useEffect(() => {
    setFavoriteError(null);
    setStatusError(null);
    setRatingError(null);
    setCommentError(null);
  }, [heroMovieId]);

  const handleToggleFavorite = async () => {
    if (!userId || !heroMovieId) {
      setFavoriteError('Sign in to manage favorites.');
      return;
    }

    setFavoritePending(true);
    setFavoriteError(null);

    try {
      const response = await fetch(
        buildUsersUrl(`/users/${userId}/favorites`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            movie_id: heroMovieId,
            action: isFavorite ? 'remove' : 'add',
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const updatedFavorites = await response.json();
      const membership = Array.isArray(updatedFavorites)
        ? updatedFavorites.some((entry) => entry?._id === heroMovieId)
        : false;
      setIsFavorite(membership);

      const nextUser = {
        ...authUser,
        favorites_movies: updatedFavorites,
      };
      setAuthUser(nextUser);
      storeUser(nextUser);
    } catch (err) {
      console.error('Failed to toggle favorite', err);
      setFavoriteError('Unable to update favorites right now.');
    } finally {
      setFavoritePending(false);
    }
  };

  const discoverMovies = relatedTitles.length ? relatedTitles : movies;
  const discoverLoading = relatedLoading && relatedTitles.length === 0;
  const discoverError = relatedTitles.length ? null : relatedError;
  const discoverEmptyMessage = relatedTitles.length
    ? 'No similar titles yet. Check back soon.'
    : 'Browse curated picks while we gather related titles.';

  const handleUpdateStatus = async (nextStatus) => {
    if (!userId || !heroMovieId) {
      setStatusError('Sign in to update your watch status.');
      return;
    }

    if (nextStatus === watchStatus) {
      return;
    }

    setStatusPending(true);
    setStatusError(null);

    try {
      const response = await fetch(
        buildUsersUrl(`/users/${userId}/watch-status`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            movie_id: heroMovieId,
            status: nextStatus === 'none' ? null : nextStatus,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const updatedStatuses = await response.json();
      const normalizedStatus = updatedStatuses?.[heroMovieId] || 'none';
      setWatchStatus(normalizedStatus);

      const nextUser = {
        ...authUser,
        watch_statuses: updatedStatuses,
      };
      setAuthUser(nextUser);
      storeUser(nextUser);
    } catch (err) {
      console.error('Failed to update watch status', err);
      setStatusError('Unable to update watch status right now.');
    } finally {
      setStatusPending(false);
    }
  };

  const handleRateMovie = async (value) => {
    if (!userId || !heroMovieId) {
      setRatingError('Sign in to rate this title.');
      return;
    }

    const ratingValue = value && value >= 1 ? value : null;

    setRatingPending(true);
    setRatingError(null);

    try {
      const response = await fetch(buildUsersUrl(`/users/${userId}/ratings`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movie_id: heroMovieId,
          rating: ratingValue,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const updatedRatings = await response.json();
      const nextRating = Number(updatedRatings?.[heroMovieId]) || 0;
      setUserRating(nextRating);

      const nextUser = {
        ...authUser,
        movie_ratings: updatedRatings,
      };
      setAuthUser(nextUser);
      storeUser(nextUser);
    } catch (err) {
      console.error('Failed to update rating', err);
      setRatingError('Unable to save your rating right now.');
    } finally {
      setRatingPending(false);
    }
  };

  async function updateComment(textValue) {
    if (!userId || !heroMovieId) {
      setCommentError('Sign in to comment on this title.');
      return;
    }

    const normalized = (textValue || '').trim();

    setCommentPending(true);
    setCommentError(null);

    try {
      const response = await fetch(buildUsersUrl(`/users/${userId}/comments`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movie_id: heroMovieId,
          comment: normalized,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const updatedComments = await response.json();
      const record = updatedComments?.[heroMovieId];
      const nextComment =
        record && typeof record.text === 'string' ? record.text : '';
      setUserComment(nextComment);
      setCommentDraft(nextComment);
      setIsEditingComment(false);

      const nextUser = {
        ...authUser,
        movie_comments: updatedComments,
      };
      const updatedReviews = Array.isArray(authUser?.reviews)
        ? [...authUser.reviews]
        : [];
      const existingIndex = updatedReviews.findIndex(
        (entry) => entry && entry._id === heroMovieId,
      );

      if (nextComment) {
        const today = new Date().toISOString().slice(0, 10);
        const previous = existingIndex >= 0 ? updatedReviews[existingIndex] || {} : {};
        const helpfulVotes = Number.isFinite(Number(previous?.helpful_votes))
          ? Number(previous.helpful_votes)
          : 0;
        const updatedEntry = {
          ...previous,
          _id: heroMovieId,
          review_text: nextComment,
          date_posted: today,
          helpful_votes: helpfulVotes,
        };
        if (existingIndex >= 0) {
          updatedReviews.splice(existingIndex, 1, updatedEntry);
        } else {
          updatedReviews.push(updatedEntry);
        }
      } else if (existingIndex >= 0) {
        updatedReviews.splice(existingIndex, 1);
      }

      nextUser.reviews = updatedReviews;
      setAuthUser(nextUser);
      storeUser(nextUser);
    } catch (err) {
      console.error('Failed to update comment', err);
      setCommentError('Unable to save your comment right now.');
    } finally {
      setCommentPending(false);
    }
  };

  const handleCommentChange = (value) => {
    setCommentError(null);
    setCommentDraft(value);
  };

  const handleSubmitComment = async () => {
    await updateComment(commentDraft);
  };

  const handleClearComment = async () => {
    if (isEditingComment) {
      setCommentDraft(userComment);
      setIsEditingComment(false);
      return;
    }
    if (!userComment) {
      setCommentDraft('');
      return;
    }
    await updateComment('');
  };

  const handleDeleteComment = async () => {
    await updateComment('');
  };

  const handleEditComment = () => {
    setCommentDraft(userComment);
    setIsEditingComment(true);
  };

  useEffect(() => {
    const movieIdentifier = heroMovieId;
    const imdbIdentifier = heroMovieImdbId;

    setFavoriteFriends([]);
    setFriendComments([]);
    setFriendsStatus({ loading: false, error: null });
    setHasFriendNetwork(false);

    if (!movieIdentifier && !imdbIdentifier) {
      return;
    }

    const friendRefs = Array.isArray(authUser?.friends)
      ? authUser.friends
      : [];

    setHasFriendNetwork(friendRefs.length > 0);

    if (!friendRefs.length) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadFriends = async () => {
      setFriendsStatus({ loading: true, error: null });

      const commentEntries = [];

      try {
        const results = await Promise.all(
          friendRefs.map(async (friendRef) => {
            const friendId = friendRef?._id || friendRef?.id;
            if (!friendId) {
              return null;
            }

            try {
              const response = await fetch(
                buildUsersUrl(`/users/${friendId}`),
                { signal: controller.signal },
              );

              if (!response.ok) {
                return null;
              }

              const payload = await response.json();
              const friendName = payload.full_name || payload.username || 'Friend';
              const commentRecord =
                payload?.movie_comments?.[movieIdentifier] ||
                (imdbIdentifier ? payload?.movie_comments?.[imdbIdentifier] : null);

              if (
                commentRecord &&
                typeof commentRecord.text === 'string' &&
                commentRecord.text.trim()
              ) {
                commentEntries.push({
                  id: payload._id || friendId,
                  name: friendName,
                  comment: commentRecord.text.trim(),
                  rawUpdatedAt: commentRecord.updated_at || null,
                });
              }

              const favoritesList = Array.isArray(payload?.favorites_movies)
                ? payload.favorites_movies
                : [];

              const favoriteIds = new Set(
                favoritesList
                  .map((entry) => entry?._id || entry?.id || entry?.movie_id)
                  .filter(Boolean),
              );

              if (
                !favoriteIds.has(movieIdentifier) &&
                !(imdbIdentifier && favoriteIds.has(imdbIdentifier))
              ) {
                return null;
              }

              return {
                id: payload._id || friendId,
                name: payload.full_name || payload.username || 'Friend',
                avatar:
                  payload.profile_picture_url ||
                  payload.avatar_url ||
                  payload.photo_url ||
                  null,
                tagline: payload.username ? `@${payload.username}` : '',
              };
            } catch (friendError) {
              console.warn('Failed to load friend profile', friendRef, friendError);
              return null;
            }
          }),
        );

        if (cancelled) {
          return;
        }

        const deduped = [];
        const seenIds = new Set();

        results
          .filter(Boolean)
          .forEach((entry) => {
            if (!entry?.id || seenIds.has(entry.id)) {
              return;
            }
            seenIds.add(entry.id);
            deduped.push(entry);
          });

        setFavoriteFriends(deduped);

        const commentMap = [];
        const seenCommentIds = new Set();
        commentEntries
          .filter((entry) => entry?.comment)
          .sort((a, b) => {
            const aTime = a.rawUpdatedAt ? new Date(a.rawUpdatedAt).getTime() : 0;
            const bTime = b.rawUpdatedAt ? new Date(b.rawUpdatedAt).getTime() : 0;
            return bTime - aTime;
          })
          .forEach((entry) => {
            if (!entry?.id || seenCommentIds.has(entry.id)) {
              return;
            }
            seenCommentIds.add(entry.id);
            commentMap.push({
              id: entry.id,
              name: entry.name,
              comment: entry.comment,
              updatedAt: formatFriendCommentDate(entry.rawUpdatedAt),
            });
          });
        setFriendComments(commentMap);
        setFriendsStatus({ loading: false, error: null });
      } catch (err) {
        if (!cancelled) {
          if (err.name !== 'AbortError') {
            console.error('Failed to load favorite friends', err);
            setFriendsStatus({
              loading: false,
              error: 'Unable to load which friends favorited this title.',
            });
            setFriendComments([]);
          } else {
            setFriendsStatus({ loading: false, error: null });
          }
        }
      }
    };

    loadFriends();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [heroMovieId, heroMovieImdbId, authUser]);

  const handleSelect = (movie) => {
    if (movie?._id && movie._id !== movieId) {
      navigate(`/movies-series/${movie._id}`);
    }
    setSelectedMovie(movie);
  };

  if (error) {
    return (
      <div className="status status--error" role="alert">
        <h1>We hit a snag.</h1>
        <p>{error}</p>
        <button type="button" className="status__link" onClick={handleGoBack}>
          Back to previous page
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="status status--loading" role="status">
        <div className="spinner" aria-hidden />
        <p>Loading the cinematic universe...</p>
      </div>
    );
  }

  return (
    <div className="movie-detail-page">
      <MovieDetail
        movie={heroMovie}
        isFavorite={isFavorite}
        onToggleFavorite={handleToggleFavorite}
        favoritePending={favoritePending}
        favoriteError={favoriteError}
        userRating={userRating}
        onRateMovie={handleRateMovie}
        ratingPending={ratingPending}
        ratingError={ratingError}
        watchStatus={watchStatus}
        onWatchStatusChange={handleUpdateStatus}
        statusPending={statusPending}
        statusError={statusError}
        canModify={Boolean(userId)}
      />
      {userId ? (
        <MovieDiscussion
          hasSavedComment={Boolean(userComment && userComment.trim())}
          canComment={Boolean(userId)}
          commentDraft={commentDraft}
          onCommentChange={handleCommentChange}
          onSubmitComment={handleSubmitComment}
          onClearComment={handleClearComment}
          onDeleteComment={handleDeleteComment}
          onEditComment={handleEditComment}
          isEditingComment={isEditingComment}
          commentPending={commentPending}
          commentError={commentError}
          friendComments={friendComments}
        />
      ) : null}
      <MovieVitals
        movie={heroMovie}
        favoriteFriends={favoriteFriends}
        isFriendsLoading={friendsStatus.loading}
        friendsError={friendsStatus.error}
        hasFriendNetwork={hasFriendNetwork}
      />
      <MovieTrailer trailerUrl={heroMovie?.trailer_url} />
      <MoviePeople movie={heroMovie} />
      <MovieRail
        movies={discoverMovies}
        selectedId={heroMovie?._id || heroMovie?.imdb_id}
        onSelect={handleSelect}
        loading={discoverLoading}
        error={discoverError}
        emptyMessage={discoverEmptyMessage}
      />
      <div className="movie-detail-page__actions">
        <button
          type="button"
          className="movie-detail-page__back"
          onClick={handleGoBack}
        >
          Back to previous page
        </button>
      </div>
    </div>
  );
};

export default MovieDetailPage;
