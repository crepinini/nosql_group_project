import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { buildUsersUrl } from '../../config';
import { getStoredUser, storeUser } from './auth';
import './Login.css';

const MIN_BIRTHDATE = '1920-01-01';
const DEFAULT_BIRTHDATE = '2000-01-01';
const CURRENT_YEAR = new Date().getFullYear();
const MAX_BIRTHDATE = `${CURRENT_YEAR}-12-31`;

const INITIAL_SIGNUP_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  username: '',
  password: '',
  locationCity: '',
  locationCountry: '',
  birthdate: DEFAULT_BIRTHDATE,
  aboutMe: '',
};

const INITIAL_LOGIN_FORM = {
  username: '',
  password: '',
};

const Login = () => {
  const existingUser = getStoredUser();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [loginForm, setLoginForm] = useState({ ...INITIAL_LOGIN_FORM });
  const [signUpForm, setSignUpForm] = useState({ ...INITIAL_SIGNUP_FORM });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (existingUser) {
    return <Navigate to="/home" replace />;
  }

  const isLoginMode = mode === 'login';

  const handleSwitchMode = (nextMode) => {
    if (nextMode === mode) {
      return;
    }
    setMode(nextMode);
    setError('');
    setIsSubmitting(false);
    if (nextMode === 'login') {
      setSignUpForm({ ...INITIAL_SIGNUP_FORM });
    } else {
      setLoginForm({ ...INITIAL_LOGIN_FORM });
    }
  };

  const handleLoginChange = (field, value) => {
    setLoginForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSignUpChange = (field, value) => {
    setSignUpForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    const username = loginForm.username.trim();
    const password = loginForm.password;

    if (!username || !password) {
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
          username,
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

  const handleSignUpSubmit = async (event) => {
    event.preventDefault();

    const trimmed = {
      firstName: signUpForm.firstName.trim(),
      lastName: signUpForm.lastName.trim(),
      email: signUpForm.email.trim(),
      username: signUpForm.username.trim(),
      password: signUpForm.password,
      locationCity: signUpForm.locationCity.trim(),
      locationCountry: signUpForm.locationCountry.trim(),
      birthdate: signUpForm.birthdate,
      aboutMe: signUpForm.aboutMe.trim(),
    };

    const missingFields = [];
    if (!trimmed.firstName) missingFields.push('first name');
    if (!trimmed.lastName) missingFields.push('last name');
    if (!trimmed.locationCity) missingFields.push('city');
    if (!trimmed.locationCountry) missingFields.push('country');
    if (!trimmed.username) missingFields.push('username');
    if (!trimmed.password) missingFields.push('password');
    if (!trimmed.email) missingFields.push('email');
    if (!trimmed.birthdate) missingFields.push('birth date');

    if (missingFields.length) {
      setError(
        `Please complete the following fields: ${missingFields.join(', ')}.`,
      );
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      const response = await fetch(buildUsersUrl('/auth/register'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          first_name: trimmed.firstName,
          last_name: trimmed.lastName,
          email: trimmed.email,
          username: trimmed.username,
          password: trimmed.password,
          location_city: trimmed.locationCity,
          location_country: trimmed.locationCountry,
          birthdate: trimmed.birthdate,
          about_me: trimmed.aboutMe,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message =
          payload?.error || 'Unable to create your account right now.';
        throw new Error(message);
      }

      const newUser = await response.json();
      storeUser(newUser);
      navigate('/home', { replace: true });
    } catch (err) {
      console.error('Sign up failed', err);
      setError(err.message || 'Unexpected error while creating the account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="login">
      <div className="login__card">
        <div className="login__toggle">
          <button
            type="button"
            className={`login__toggle-btn${
              isLoginMode ? ' login__toggle-btn--active' : ''
            }`}
            onClick={() => handleSwitchMode('login')}
            disabled={isSubmitting}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`login__toggle-btn${
              !isLoginMode ? ' login__toggle-btn--active' : ''
            }`}
            onClick={() => handleSwitchMode('signup')}
            disabled={isSubmitting}
          >
            Sign Up
          </button>
        </div>

        <h1 className="login__title">
          {isLoginMode ? 'Welcome Back' : 'Join MovieManiac'}
        </h1>
        <p className="login__subtitle">
          {isLoginMode
            ? 'Sign in to access personalised recommendations and your profile.'
            : 'Fill in the form below to create your MovieManiac account.'}
        </p>

        {isLoginMode ? (
          <form className="login__form" onSubmit={handleLoginSubmit} noValidate>
            <label className="login__field">
              <span>Username</span>
              <input
                type="text"
                autoComplete="username"
                value={loginForm.username}
                onChange={(event) =>
                  handleLoginChange('username', event.target.value)
                }
                disabled={isSubmitting}
                required
              />
            </label>

            <label className="login__field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={loginForm.password}
                onChange={(event) =>
                  handleLoginChange('password', event.target.value)
                }
                disabled={isSubmitting}
                required
              />
            </label>

            {error ? <div className="login__error">{error}</div> : null}

            <button
              type="submit"
              className="login__submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form className="login__form" onSubmit={handleSignUpSubmit} noValidate>
            <label className="login__field">
              <span>First name</span>
              <input
                type="text"
                autoComplete="given-name"
                value={signUpForm.firstName}
                onChange={(event) =>
                  handleSignUpChange('firstName', event.target.value)
                }
                disabled={isSubmitting}
                required
              />
            </label>

            <label className="login__field">
              <span>Last name</span>
              <input
                type="text"
                autoComplete="family-name"
                value={signUpForm.lastName}
                onChange={(event) =>
                  handleSignUpChange('lastName', event.target.value)
                }
                disabled={isSubmitting}
                required
              />
            </label>

            <label className="login__field">
              <span>Birth date</span>
              <input
                type="date"
                autoComplete="bday"
                min={MIN_BIRTHDATE}
                max={MAX_BIRTHDATE}
                value={signUpForm.birthdate}
                onChange={(event) =>
                  handleSignUpChange('birthdate', event.target.value)
                }
                disabled={isSubmitting}
                required
              />
            </label>

            <label className="login__field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                value={signUpForm.email}
                onChange={(event) =>
                  handleSignUpChange('email', event.target.value)
                }
                disabled={isSubmitting}
                required
              />
            </label>

            <label className="login__field">
              <span>Username</span>
              <input
                type="text"
                autoComplete="username"
                value={signUpForm.username}
                onChange={(event) =>
                  handleSignUpChange('username', event.target.value)
                }
                disabled={isSubmitting}
                required
              />
            </label>

            <label className="login__field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={signUpForm.password}
                onChange={(event) =>
                  handleSignUpChange('password', event.target.value)
                }
                disabled={isSubmitting}
                required
              />
            </label>

            <label className="login__field">
              <span>City</span>
              <input
                type="text"
                autoComplete="address-level2"
                value={signUpForm.locationCity}
                onChange={(event) =>
                  handleSignUpChange('locationCity', event.target.value)
                }
                disabled={isSubmitting}
                required
              />
            </label>

            <label className="login__field">
              <span>Country</span>
              <input
                type="text"
                autoComplete="country-name"
                value={signUpForm.locationCountry}
                onChange={(event) =>
                  handleSignUpChange('locationCountry', event.target.value)
                }
                disabled={isSubmitting}
                required
              />
            </label>

            <label className="login__field">
              <span>About you</span>
              <textarea
                rows={3}
                value={signUpForm.aboutMe}
                onChange={(event) =>
                  handleSignUpChange('aboutMe', event.target.value)
                }
                disabled={isSubmitting}
                placeholder="Tell the community a little about your movie taste."
              />
            </label>

            {error ? <div className="login__error">{error}</div> : null}

            <button
              type="submit"
              className="login__submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating account...' : 'Create Account'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
};

export default Login;
