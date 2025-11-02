import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import MoviesPage from './pages/MoviesPage';
import SeriesPage from './pages/SeriesPage';
import PeopleSearchPage from './pages/PeopleSearchPage';
import ProfilePage from './pages/ProfilePage';
import PeopleDetailPage from './pages/PeopleDetailPage';
import MovieDetailPage from './pages/MovieDetailPage';
import RecommendationsPage from './pages/RecommendationsPage';
import MyListPage from './pages/MyListPage';
import Friends from './pages/Friends';
import Home from './components/Home';
import Login from './components/Login';
import './App.css';
import WatchListPage from './pages/WatchListPage';

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
            <Route path="/crew" element={<PeopleSearchPage />} />
            <Route path="/actors" element={<PeopleSearchPage />} />
            <Route path="/people" element={<PeopleSearchPage />} />
            <Route path="/actors/:actorId" element={<PeopleDetailPage />} />
            <Route path="/people/:personId" element={<PeopleDetailPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/movies-series/:movieId" element={<MovieDetailPage />} />
            <Route path="/recommendations" element={<RecommendationsPage />} />
            <Route path="/my-lists" element={<MyListPage />} />
            <Route path="/watchlist" element={<WatchListPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/friends" element={<Friends />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
