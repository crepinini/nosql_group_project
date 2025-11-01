import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  getStoredUser,
  clearStoredUser,
  subscribeToAuthChanges,
} from './Login/auth';
import './Navbar.css';

const Navbar = () => {
  const navigate = useNavigate();
  const [authUser, setAuthUser] = useState(() => getStoredUser());

  useEffect(() => {
    const handleChange = () => setAuthUser(getStoredUser());
    const unsubscribe = subscribeToAuthChanges(handleChange);
    window.addEventListener('storage', handleChange);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', handleChange);
    };
  }, []);

  const handleSignOut = () => {
    clearStoredUser();
    navigate('/login');
  };

  return (
    <header className="navbar">
      <Link to="/home" className="navbar__logo" aria-label="MovieManiac home">
        MovieManiac
      </Link>
      <nav className="navbar__links" aria-label="Primary navigation">
        <Link to="/home">MyHome</Link>
        <Link to="/movies">Movies</Link>
        <Link to="/series">Series</Link>
        <Link to="/crew">Cast &amp; Crew</Link>
        <Link to="/recommendations">Recommendations</Link>
        <Link to="/my-lists">MyLists</Link>
        <Link to="/friends">MyFriends</Link>
        <Link to="/profile">MyProfile</Link>
      </nav>
      <div className="navbar__actions">
        {authUser ? (
          <>
            <span className="navbar__welcome">
              Hi, {authUser.full_name || authUser.username}
            </span>
            <button type="button" className="navbar__logout" onClick={handleSignOut}>
              Sign out
            </button>
          </>
        ) : (
          <Link to="/login" className="navbar__login">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
};

export default Navbar;
