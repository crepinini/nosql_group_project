import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { buildUsersUrl } from '../../config';
import { getStoredUser, storeUser } from './auth';
import './Login.css';

const Login = () => {
  const existingUser = getStoredUser();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (existingUser) {
    return <Navigate to="/home" replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!username.trim() || !password) {
      setError('Please provide both username and password.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      const response = await fetch(buildUsersUrl('/auth/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message =
          payload?.error || 'Unable to sign in with those credentials.';
        throw new Error(message);
      }

      const user = await response.json();
      storeUser(user);
      navigate('/home', { replace: true });
    } catch (err) {
      console.error('Login failed', err);
      setError(err.message || 'Unexpected error while signing in.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="login">
      <div className="login__card">
        <h1 className="login__title">Welcome Back</h1>
        <p className="login__subtitle">
          Sign in to access personalised recommendations and your profile.
        </p>

        <form className="login__form" onSubmit={handleSubmit} noValidate>
          <label className="login__field">
            <span>Username</span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </label>

          <label className="login__field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </label>

          {error ? <div className="login__error">{error}</div> : null}

          <button type="submit" className="login__submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </section>
  );
};

export default Login;
