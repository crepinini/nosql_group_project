import React from 'react';
import { useNavigate } from 'react-router-dom';
import './WatchListRail.css';

const FALLBACK_POSTER = 'https://via.placeholder.com/400x600.png?text=Poster+Unavailable';

const formatRuntime = (duration) => {
  if (!duration || isNaN(Number(duration))) return null;
  const totalMinutes = Number(duration);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes.toString().padStart(2,'0')}m`;
};

const WatchListRail = ({ title, items = [], addToSection, removeFromAllSections }) => {
  const navigate = useNavigate();
  const safeItems = Array.isArray(items) ? items : [];

  if (!safeItems.length) return (
    <div className="watchlist-rail">
      <h2 className="home-section-title">{title}</h2>
      <p style={{color:'#ccc'}}>No items yet.</p>
    </div>
  );

  return (
    <section className="watchlist-rail">
      <h2 className="home-section-title">{title}</h2>
      <div className="watchlist-rail__scroller">
        {safeItems.map(movie => (
          <div key={movie._id} className="movie-card">
            <img src={movie.poster_url || FALLBACK_POSTER} alt={movie.title} onClick={() => navigate(`/movies-series/${movie._id}`)} />
            <h3>{movie.title}</h3>
            <p className="movie-meta">{movie.year || 'N/A'} • {movie.imdb_type || 'Unknown'}</p>
            {movie.duration && <p className="movie-duration">{formatRuntime(movie.duration)}</p>}
            {movie.rating && <p className="movie-rating">⭐ {Number(movie.rating).toFixed(1)}</p>}
            <div className="watch-card-move">
              {['watching','toWatch','watched'].map(sec => (
                <button key={sec} onClick={() => addToSection(movie, sec)}>{sec}</button>
              ))}
              <button onClick={() => removeFromAllSections(movie)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default WatchListRail;
