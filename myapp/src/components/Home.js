import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildMoviesUrl } from '../config';
import './Home.css';

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

export default function Home({ filterType }) {
  const [movies, setMovies] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedGenre, setSelectedGenre] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const navigate = useNavigate();

  useEffect(() => {
    const fetchMovies = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch(buildMoviesUrl('/movies-series'));
        if (!response.ok) {
          throw new Error('Error loading movies');
        }
        const data = await response.json();
        let filteredData;
        if (filterType) {
          filteredData = data.filter((m) => m.imdb_type === filterType);
        } else {
          filteredData = data;
        }
        setMovies(filteredData);
      } catch (err) {
        console.error(err);
        setError('Unable to load movies from the database');
      } finally {
        setIsLoading(false);
      }
    };
    fetchMovies();
  }, [filterType]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedTerm(searchTerm.trim());
      setCurrentPage(1);
    }, 350);
    return () => clearTimeout(handle);
  }, [searchTerm]);

  const genres = ['All', ...new Set(movies.flatMap((m) => m.genres || []))];
  const filteredMovies =
    selectedGenre === 'All'
      ? movies
      : movies.filter((m) => m.genres && m.genres.includes(selectedGenre));

  const visibleMovies = filteredMovies.filter((m) =>
    m.title.toLowerCase().includes(debouncedTerm.toLowerCase())
  );
  const indexOfLastMovie = currentPage * itemsPerPage;
  const indexOfFirstMovie = indexOfLastMovie - itemsPerPage;
  const currentMovies = visibleMovies.slice(indexOfFirstMovie, indexOfLastMovie);
  const totalPages = Math.ceil(visibleMovies.length / itemsPerPage);

  return (
    <div className="home-page">
      <header className="home-hero">
        <h1>Welcome</h1>
        <p>Find all your favorite movies & series</p>
      </header>

      <main className="home-content">
        {isLoading && <p className="loading">Loading your movie list...</p>}
        {error && <p className="error">{error}</p>}

        {!isLoading && !error && (
          <>
            <div className="home-section-header">
              <h2 className="home-section-title">Your Movie List</h2>
              <select
                className="genre-filter"
                value={selectedGenre}
                onChange={(e) => {
                  setSelectedGenre(e.target.value);
                  setCurrentPage(1);
                }}
              >
                {genres.map((genre) => (
                  <option key={genre} value={genre}>
                    {genre}
                  </option>
                ))}
              </select>
            </div>

            <form
              className="home-page__controls"
              role="search"
              onSubmit={(event) => event.preventDefault()}
            >
              <label className="home-page__search-label" htmlFor="home-search">
                Search movies/series
              </label>
              <input
                id="home-search"
                className="home-page__search-input"
                type="search"
                placeholder="Search by title"
                value={searchTerm}
                onChange={(event) =>{
                  setSearchTerm(event.target.value);
                }}
              />
            </form>

            <div className="home-rail-movies">
              {currentMovies.map((movie) => {
                const runtimeLabel = formatRuntime(movie.duration);
                return (
                  <div
                    key={movie._id}
                    className="movie-card"
                    onClick={() => navigate(`/movies-series/${movie._id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <img
                      src={movie.poster_url || FALLBACK_POSTER}
                      alt={movie.title}
                      loading="lazy"
                    />
                    <h3>{movie.title}</h3>
                    <p className="movie-meta">
                      {movie.year ? movie.year : 'N/A'} • {movie.imdb_type || 'Unknown'}
                    </p>
                    {runtimeLabel && (
                      <p className="movie-duration">{runtimeLabel}</p>
                    )}
                    {movie.rating && (
                      <p className="movie-rating">⭐ {Number(movie.rating).toFixed(1)}</p>
                    )}
                    <div className="movie-genres">
                      {movie.genres?.slice(0, 3).map((g) => (
                        <span key={g} className="movie-genre-badge">
                          {g}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {totalPages > 1 && (
              <div className="pagination">
                <button
                  onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </button>
                <span>
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() =>
                    setCurrentPage((prev) => Math.min(prev + 1, totalPages))
                  }
                  disabled={currentPage === totalPages}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
