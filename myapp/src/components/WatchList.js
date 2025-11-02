import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { getStoredUser, subscribeToAuthChanges } from './Login/auth';
import { buildMoviesUrl } from '../config';
import './WatchList.css';
import WatchListRail from './WatchListRail';

const FALLBACK_POSTER = 'https://via.placeholder.com/400x600.png?text=Poster+Unavailable';

const formatRuntime = (duration) => {
  if (!duration || Number.isNaN(Number(duration))) return null;
  const totalMinutes = Number(duration);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes.toString().padStart(2,'0')}m`;
};

const WatchList = () => {
  const [authUser, setAuthUser] = useState(() => getStoredUser());
  const [movies, setMovies] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [watching, setWatching] = useState(() => JSON.parse(localStorage.getItem('watching') || '[]'));
  const [toWatch, setToWatch] = useState(() => JSON.parse(localStorage.getItem('toWatch') || '[]'));
  const [watched, setWatched] = useState(() => JSON.parse(localStorage.getItem('watched') || '[]'));
  const [showFilter, setShowFilter] = useState(false);
  const [selectedGenre, setSelectedGenre] = useState([]);
  const [yearRange, setYearRange] = useState({ min: '', max: '' });
  const [yearSort, setYearSort] = useState('');
  const [ratingSort, setRatingSort] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges(() => setAuthUser(getStoredUser()));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchMovies = async () => {
      try {
        const res = await fetch(buildMoviesUrl('/movies-series'));
        if (!res.ok) throw new Error('Error fetching movies');
        const data = await res.json();
        data.sort((a,b) => (b.year||0) - (a.year||0));
        setMovies(data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchMovies();
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedTerm(searchTerm.trim()), 350);
    return () => clearTimeout(handle);
  }, [searchTerm]);

  useEffect(() => { localStorage.setItem('watching', JSON.stringify(watching)); }, [watching]);
  useEffect(() => { localStorage.setItem('toWatch', JSON.stringify(toWatch)); }, [toWatch]);
  useEffect(() => { localStorage.setItem('watched', JSON.stringify(watched)); }, [watched]);

  if (!authUser) return <Navigate to="/login" replace />;

  const genres = ['All', ...new Set(movies.flatMap(m => m.genres || []))];

  let filteredMovies = movies.filter(m =>
    m.title.toLowerCase().includes(debouncedTerm.toLowerCase())
  );

  if (selectedGenre.length > 0) {
    filteredMovies = filteredMovies.filter(m =>
      m.genres?.some(g => selectedGenre.includes(g))
    );
  }

  if (yearRange.min || yearRange.max) {
    filteredMovies = filteredMovies.filter(m => {
      const year = m.year || 0;
      const minCheck = yearRange.min ? year >= Number(yearRange.min) : true;
      const maxCheck = yearRange.max ? year <= Number(yearRange.max) : true;
      return minCheck && maxCheck;
    });
  }

  if (yearSort === 'asc') filteredMovies.sort((a,b) => (a.year||0) - (b.year||0));
  else if (yearSort === 'desc') filteredMovies.sort((a,b) => (b.year||0) - (a.year||0));

  if (ratingSort === 'asc') filteredMovies.sort((a,b) => (Number(a.rating)||0) - (Number(b.rating)||0));
  else if (ratingSort === 'desc') filteredMovies.sort((a,b) => (Number(b.rating)||0) - (Number(a.rating)||0));

  const toggleGenre = (genre) => {
    if (selectedGenre.includes(genre)) setSelectedGenre(selectedGenre.filter(g => g !== genre));
    else setSelectedGenre([...selectedGenre, genre]);
  };

  const addToSection = (movie, section) => {
    removeFromAllSections(movie);
    if (section === 'watching') setWatching(prev => [...prev, movie]);
    else if (section === 'toWatch') setToWatch(prev => [...prev, movie]);
    else if (section === 'watched') setWatched(prev => [...prev, movie]);
  };

  const removeFromAllSections = (movie) => {
    setWatching(prev => prev.filter(m => m._id !== movie._id));
    setToWatch(prev => prev.filter(m => m._id !== movie._id));
    setWatched(prev => prev.filter(m => m._id !== movie._id));
  };

  const applyFilterToSection = (items) => {
    let filtered = [...items];
    if (selectedGenre.length > 0) filtered = filtered.filter(m => m.genres?.some(g => selectedGenre.includes(g)));
    if (yearRange.min || yearRange.max) filtered = filtered.filter(m => {
      const year = m.year || 0;
      const minCheck = yearRange.min ? year >= Number(yearRange.min) : true;
      const maxCheck = yearRange.max ? year <= Number(yearRange.max) : true;
      return minCheck && maxCheck;
    });
    if (yearSort === 'asc') filtered.sort((a,b) => (a.year||0) - (b.year||0));
    else if (yearSort === 'desc') filtered.sort((a,b) => (b.year||0) - (a.year||0));
    if (ratingSort === 'asc') filtered.sort((a,b) => (Number(a.rating)||0) - (Number(b.rating)||0));
    else if (ratingSort === 'desc') filtered.sort((a,b) => (Number(b.rating)||0) - (Number(a.rating)||0));
    return filtered;
  };

  return (
    <div className="watchlist-page home-page">
      <header className="home-hero">
        <h1>My WatchList</h1>
      </header>

      <div className="top-bar">
        <button className="sort-filter-button" onClick={() => setShowFilter(prev => !prev)}>Sort & Filter</button>
        {showFilter && (
          <div className="filter-panel">
            <div className="filter-section">
              <h4>Genre</h4>
              <div className="genre-options">
                {genres.map(g => g !== 'All' && (
                  <label key={g}>
                    <input type="checkbox" checked={selectedGenre.includes(g)} onChange={() => toggleGenre(g)} />
                    {g}
                  </label>
                ))}
                <button onClick={() => setSelectedGenre([])}>Reset</button>
              </div>
            </div>
            <div className="filter-section">
              <h4>Sort by Year</h4>
              <div className="year-range">
                <input placeholder="Min" type="number" className="year-range-input" value={yearRange.min} onChange={e => setYearRange({...yearRange, min:e.target.value})}/>
                <input placeholder="Max" type="number" className="year-range-input" value={yearRange.max} onChange={e => setYearRange({...yearRange, max:e.target.value})}/>
                <select value={yearSort} onChange={e => setYearSort(e.target.value)}>
                  <option value="">None</option>
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
                <button onClick={() => {setYearSort(''); setYearRange({min:'', max:''});}}>Reset</button>
              </div>
            </div>
            <div className="filter-section">
              <h4>Sort by Rating</h4>
              <select value={ratingSort} onChange={e => setRatingSort(e.target.value)}>
                <option value="">None</option>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <button onClick={() => setRatingSort('')}>Reset</button>
            </div>
          </div>
        )}
      </div>

      <form className="home-page__controls" role="search" onSubmit={e => e.preventDefault()}>
        <label className="home-page__search-label" htmlFor="watchlist-search">Search movies/series</label>
        <input id="watchlist-search" className="home-page__search-input" type="search" placeholder="Search by title" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        {debouncedTerm && (
          <div className="search-results">
            {filteredMovies.map(m => (
              <div key={m._id} className="search-result-item">
                <span>{m.title}</span>
                <select onChange={e => addToSection(m, e.target.value)} defaultValue="">
                  <option value="" disabled>Add to...</option>
                  <option value="watching">Watching</option>
                  <option value="toWatch">To Watch</option>
                  <option value="watched">Watched</option>
                </select>
              </div>
            ))}
          </div>
        )}
      </form>

      <div className="watch-section-frame">
        <WatchListRail title="Watching" items={applyFilterToSection(watching)} addToSection={addToSection} removeFromAllSections={removeFromAllSections} />
      </div>
      <div className="watch-section-frame">
        <WatchListRail title="To Watch" items={applyFilterToSection(toWatch)} addToSection={addToSection} removeFromAllSections={removeFromAllSections} />
      </div>
      <div className="watch-section-frame">
        <WatchListRail title="Watched" items={applyFilterToSection(watched)} addToSection={addToSection} removeFromAllSections={removeFromAllSections} />
      </div>
    </div>
  );
};

export default WatchList;