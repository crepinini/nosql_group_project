import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Home.css';

const FALLBACK_POSTER =
  'https://via.placeholder.com/400x600.png?text=Poster+Unavailable';

export default function Home() {
  const [movies, setMovies] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedGenre, setSelectedGenre] = useState('All');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchMovies = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch('/movies-series');
        if (!response.ok) {
          throw new Error('Error loading movies');
        }
        const data = await response.json();
        setMovies(data);
      } catch (err) {
        console.error(err);
        setError('Unable to load movies from the database');
      } finally {
        setIsLoading(false);
      }
    };
    fetchMovies();
  }, []);

  const genres = ['All', ...new Set(movies.flatMap((m) => m.genres || []))];
  const filteredMovies =
    selectedGenre === 'All'
      ? movies
      : movies.filter((m) => m.genres && m.genres.includes(selectedGenre));

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
                onChange={(e) => setSelectedGenre(e.target.value)}
              >
                {genres.map((genre) => (
                  <option key={genre} value={genre}>
                    {genre}
                  </option>
                ))}
              </select>
            </div>

            <div className="home-rail-movies">
              {filteredMovies.map((movie) => (
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
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

