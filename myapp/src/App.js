import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import MoviesPage from './pages/MoviesPage';
import SeriesPage from './pages/SeriesPage';
import ActorsPage from './pages/ActorsPage';
import ProfilePage from './pages/ProfilePage';
import ActorDetailPage from './pages/ActorDetailPage';
import MovieDetailPage from './pages/MovieDetailPage';
import Home from './components/Home';
import Login from './components/Login';
import './App.css';

const NotFound = () => (
  <div className="status status--error" role="alert">
    <h1>Page not found.</h1>
    <p>The page you are trying to reach does not exist.</p>
    <Link className="status__link" to="/home">
      Back to home
    </Link>
  </div>
);

function App() {
  return (
    <Router>
      <div className="app-shell">
        <Navbar />
        <main className="app-content">
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<Home />} />
            <Route path="/movies" element={<MoviesPage />} />
            <Route path="/series" element={<SeriesPage />} />
            <Route path="/actors" element={<ActorsPage />} />
            <Route path="/actors/:actorId" element={<ActorDetailPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/movies-series/:movieId" element={<MovieDetailPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
