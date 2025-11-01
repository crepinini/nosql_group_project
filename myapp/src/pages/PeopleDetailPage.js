import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PersonDetail from '../components/PersonDetail';
import { buildPeopleUrl, buildMoviesUrl, buildUsersUrl } from '../config';
import {
  getStoredUser,
  storeUser,
  subscribeToAuthChanges,
} from '../components/Login/auth';

const extractFavoritePeople = (user) => {
  if (!user) {
    return [];
  }

  if (Array.isArray(user.favorites_people)) {
    return user.favorites_people;
  }

  return [];
};

const PeopleDetailPage = () => {
  const navigate = useNavigate();
  const { personId, actorId } = useParams();
  const resolvedPersonId = personId ?? actorId ?? null;
  const [person, setPerson] = useState(null);
  const [knownForDetails, setKnownForDetails] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authUser, setAuthUser] = useState(() => getStoredUser());
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoritePending, setFavoritePending] = useState(false);
  const [favoriteError, setFavoriteError] = useState(null);

  useEffect(() => {
    const handleAuthChange = () => setAuthUser(getStoredUser());
    const unsubscribe = subscribeToAuthChanges(handleAuthChange);
    window.addEventListener('storage', handleAuthChange);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', handleAuthChange);
    };
  }, []);

  useEffect(() => {
    setFavoriteError(null);
  }, [resolvedPersonId]);

  useEffect(() => {
    if (!resolvedPersonId) {
      setError('The requested person identifier is missing.');
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    const loadPerson = async () => {
      const endpoint = buildPeopleUrl(`/people/${resolvedPersonId}`);

      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(endpoint, {
          signal: controller.signal,
        });

        if (response.status === 404) {
          throw new Error('We could not find that person in the database.');
        }

        if (!response.ok) {
          throw new Error('Unable to load person details.');
        }

        const payload = await response.json();
        setPerson(payload);
      } catch (err) {
        if (err.name !== 'AbortError') {
          const baseMessage = err.message || 'Unknown error loading person';
          const hint = endpoint.startsWith('http')
            ? `Please verify the service at ${endpoint} is reachable.`
            : 'Please verify the people service is reachable through the development proxy (port 5002).';
          setError(`${baseMessage}. ${hint}`);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadPerson();

    return () => controller.abort();
  }, [resolvedPersonId]);

  useEffect(() => {
    if (!person || !Array.isArray(person.movie) || person.movie.length === 0) {
      setKnownForDetails([]);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadKnownFor = async () => {
      try {
        const uniqueMovies = Array.from(
          new Map(
            person.movie
              .filter((entry) => entry?._id)
              .map((entry) => [entry._id, entry]),
          ).values(),
        );

        const results = await Promise.all(
          uniqueMovies.map(async (entry) => {
            const endpoint = buildMoviesUrl(`/movies-series/${entry._id}`);
            try {
              const response = await fetch(endpoint, {
                signal: controller.signal,
              });
              if (!response.ok) {
                return null;
              }
              return await response.json();
            } catch (movieErr) {
              console.warn(movieErr);
              return null;
            }
          }),
        );

        if (!cancelled) {
          setKnownForDetails(results.filter(Boolean));
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('Failed to load known-for titles', err);
          setKnownForDetails([]);
        }
      }
    };

    loadKnownFor();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [person]);

  useEffect(() => {
    if (!person?._id) {
      setIsFavorite(false);
      return;
    }

    const favorites = extractFavoritePeople(authUser);
    const membership = favorites.some((entry) => {
      const value =
        (entry && (entry._id || entry.id || entry.person_id || entry.imdb_id)) ||
        entry;
      if (!value) {
        return false;
      }
      return String(value) === String(person._id);
    });
    setIsFavorite(membership);
  }, [authUser, person?._id]);

  const userId = authUser?._id || authUser?.username || null;

  const handleGoBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/home');
    }
  };

  const handleToggleFavorite = async () => {
    if (!userId || !person?._id) {
      setFavoriteError('Sign in to manage your favorite people.');
      return;
    }

    setFavoritePending(true);
    setFavoriteError(null);

    try {
      const response = await fetch(
        buildUsersUrl(`/users/${userId}/favorites-people`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            person_id: person._id,
            action: isFavorite ? 'remove' : 'add',
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const updatedFavorites = await response.json();
      const membership = Array.isArray(updatedFavorites)
        ? updatedFavorites.some(
            (entry) => (entry?._id || entry?.id || entry) === person._id,
          )
        : false;
      setIsFavorite(membership);

      const nextUser = {
        ...authUser,
        favorites_people: Array.isArray(updatedFavorites)
          ? updatedFavorites
          : [],
      };
      setAuthUser(nextUser);
      storeUser(nextUser);
    } catch (err) {
      console.error('Failed to toggle favorite person', err);
      setFavoriteError('Unable to update favorites right now.');
    } finally {
      setFavoritePending(false);
    }
  };

  if (error) {
    return (
      <div className="status status--error" role="alert">
        <h1>Something went wrong.</h1>
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
        <p>Gathering person insights...</p>
      </div>
    );
  }

  return (
    <div className="person-detail-page">
      <PersonDetail
        person={person}
        knownForDetails={knownForDetails}
        isFavorite={isFavorite}
        onToggleFavorite={handleToggleFavorite}
        favoritePending={favoritePending}
        favoriteError={favoriteError}
        canModify={Boolean(userId)}
      />
      <div className="person-detail-page__actions">
        <button
          type="button"
          className="person-detail-page__back"
          onClick={handleGoBack}
        >
          Back to previous page
        </button>
      </div>
    </div>
  );
};

export default PeopleDetailPage;

