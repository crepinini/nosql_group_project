import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import MovieDetail from '../components/MovieDetail';
import MoviePeople from '../components/MoviePeople';
import MovieTrailer from '../components/MovieTrailer';
import MovieRail from '../components/MovieRail';
import MovieVitals from '../components/MovieVitals';
import { buildMoviesUrl, buildUsersUrl } from '../config';
import { getStoredUser } from '../components/Login/auth';

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

const MovieDetailPage = () => {
  const navigate = useNavigate();
  const { movieId } = useParams();
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

  useEffect(() => {
    const movieIdentifier = heroMovieId;
    const imdbIdentifier = heroMovieImdbId;

    setFavoriteFriends([]);
    setFriendsStatus({ loading: false, error: null });
    setHasFriendNetwork(false);

    if (!movieIdentifier && !imdbIdentifier) {
      return;
    }

    const authUser = getStoredUser();
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
      setFriendsStatus({ loading: false, error: null });
    } catch (err) {
      if (!cancelled) {
        if (err.name !== 'AbortError') {
          console.error('Failed to load favorite friends', err);
          setFriendsStatus({
            loading: false,
            error: 'Unable to load which friends favorited this title.',
          });
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
  }, [heroMovieId, heroMovieImdbId]);

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
        <Link className="status__link" to="/home">
          Back to home
        </Link>
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
      <MovieDetail movie={heroMovie} />
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
        movies={movies}
        selectedId={heroMovie?._id}
        onSelect={handleSelect}
      />
    </div>
  );
};

export default MovieDetailPage;



