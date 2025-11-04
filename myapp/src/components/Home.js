import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildMoviesUrl } from '../config';
import './Home.css';

const FALLBACK_POSTER =
  'https://via.placeholder.com/400x600.png?text=Poster+Unavailable';

const getSubtitle = (type) => {
  if (type === 'Movie') return 'Find all your favorite movies';
  if (type === 'TVSeries') return 'Find all your favorite series';
  return 'Find all your favorite movies & series';
};
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
  const [selectedGenre, setSelectedGenre] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilter, setShowFilter] = useState(false);
  const [yearRange, setYearRange] = useState({ min: '', max: '' });
  const [yearSort, setYearSort] = useState('');
  const [ratingSort, setRatingSort] = useState('');
  const itemsPerPage = 30;
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
        filteredData.sort((a, b) => (b.year || 0) - (a.year || 0));//sort from newest to oldest
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

  let filteredMovies = movies.filter((m) =>
    m.title.toLowerCase().includes(debouncedTerm.toLowerCase())
  );

  if (selectedGenre.length > 0) {
    filteredMovies = filteredMovies.filter((m) =>
      m.genres?.some((g) => selectedGenre.includes(g))
    );
  }

  if (yearRange.min || yearRange.max) {
    filteredMovies = filteredMovies.filter((m) => {
      const year = m.year || 0;
      const minCheck = yearRange.min ? year >= Number(yearRange.min) : true;
      const maxCheck = yearRange.max ? year <= Number(yearRange.max) : true;
      return minCheck && maxCheck;
    });
  }

  if (yearSort === 'asc') {
    filteredMovies.sort((a, b) => (a.year || 0) - (b.year || 0));
  } else if (yearSort === 'desc') {
    filteredMovies.sort((a, b) => (b.year || 0) - (a.year || 0));
  }

  if (ratingSort === 'asc') {
    filteredMovies.sort((a, b) => (Number(a.rating) || 0) - (Number(b.rating) || 0));
  } else if (ratingSort === 'desc') {
    filteredMovies.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
  }

  const indexOfLastMovie = currentPage * itemsPerPage;
  const indexOfFirstMovie = indexOfLastMovie - itemsPerPage;
  const currentMovies = filteredMovies.slice(indexOfFirstMovie, indexOfLastMovie);
  const totalPages = Math.ceil(filteredMovies.length / itemsPerPage);

  const toggleGenre = (genre) => {
    if (selectedGenre.includes(genre)) {
      setSelectedGenre(selectedGenre.filter((g) => g !== genre));
    } else {
      setSelectedGenre([...selectedGenre, genre]);
    }
    setCurrentPage(1);
  };

  return (
    <div className="home-page">
      <header className="home-hero">
        <h1>Welcome</h1>
        <p>{getSubtitle(filterType)}</p>
      </header>

      <main className="home-content">
        <div className="top-bar">
          <button
            className="sort-filter-button"
            onClick={() => setShowFilter((prev) => !prev)}
          >
            Sort & Filter
          </button>
          {showFilter && (
            <div className="filter-panel">
              <div className="filter-section">
                <h4>Genre</h4>
                <div className="genre-options">
                  {genres.map((g) => g !== 'All' && (
                    <label key={g}>
                      <input
                        type="checkbox"
                        checked={selectedGenre.includes(g)}
                        onChange={() => toggleGenre(g)}
                      />
                      {g}
                    </label>
                  ))}
                  <button onClick={() => setSelectedGenre([])}>Reset</button>
                </div>
              </div>
              <div className="filter-section">
                <h4>Sort by Year</h4>
                <div className="year-range">
                  <input
                    className="year-range-input"
                    placeholder="Min"
                    type="number"
                    value={yearRange.min}
                    onChange={(e) => setYearRange({ ...yearRange, min: e.target.value })}
                  />
                  <input
                    className="year-range-input"
                    placeholder="Max"
                    type="number"
                    value={yearRange.max}
                    onChange={(e) => setYearRange({ ...yearRange, max: e.target.value })}
                  />
                  <select
                    className="sort-filter"
                    value={yearSort}
                    onChange={(e) => setYearSort(e.target.value)}
                  >
                    <option value="">None</option>
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </select>
                  <button onClick={() => {setYearSort(''); setYearRange({ min: '', max: '' });}}>Reset</button>
                </div>
              </div>
              <div className="filter-section">
                <h4>Sort by Rating</h4>
                <select
                  className="sort-filter"
                  value={ratingSort}
                  onChange={(e) => setRatingSort(e.target.value)}
                >
                  <option value="">None</option>
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
                <button onClick={() => setRatingSort('')}>Reset</button>
              </div>
            </div>
          )}
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
      </main>
    </div>
  );
}
