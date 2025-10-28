import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { buildUsersUrl } from '../config';
import { getStoredUser, storeUser } from '../components/Login/auth';

const ProfilePage = () => {
  const authUser = getStoredUser();
  const [profile, setProfile] = useState(() => authUser);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(!authUser);

  useEffect(() => {
    if (!authUser) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const loadProfile = async () => {
      try {
        setIsLoading(true);
        const userId = authUser._id || authUser.username;
        const response = await fetch(
          buildUsersUrl(`/myprofile?user_id=${encodeURIComponent(userId)}`),
          { signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error('Failed to fetch profile');
        }
        const data = await response.json();
        setProfile(data);
        storeUser({ ...authUser, ...data });
        setError(null);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Unexpected error');
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();

    return () => controller.abort();
  }, [authUser]);

  if (!authUser) {
    return <Navigate to="/login" replace />;
  }

  if (error) {
    return (
      <div style={{ color: 'red', textAlign: 'center', padding: '2rem' }}>
        Error: {error}
      </div>
    );
  }

  if (isLoading || !profile) {
    return (
      <div style={{ color: '#fff', textAlign: 'center', padding: '2rem' }}>
        Loading profile...
      </div>
    );
  }

  return (
    <div style={{ color: '#fff', padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>{profile.full_name}</h1>
      <p>@{profile.username}</p>
      <p>{profile.about_me}</p>
      <p>🎂 {profile.birthdate}</p>
      <p>📍 {profile.location_city}, {profile.location_country}</p>

      <h3>Favorite Movies</h3>
      <ul>
        {profile.favorites_movies?.map((fav, index) => (
          <li key={fav._id || index}>{fav._id || 'Unknown title'}</li>
        ))}
      </ul>

      <h3>Reviews</h3>
      <ul>
        {profile.reviews?.map((review, index) => (
          <li key={review._id || index}>
            <p>{review.review_text}</p>
            <small>{review.date_posted}</small>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ProfilePage;
