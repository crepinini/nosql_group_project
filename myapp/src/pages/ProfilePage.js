import React, { useEffect, useState } from "react";

export default function ProfilePage() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await fetch("/myprofile?user_id=u000000000001");
        if (!response.ok) throw new Error("Failed to fetch profile");
        const data = await response.json();
        setProfile(data);
      } catch (err) {
        console.error("Error fetching profile:", err);
        setError(err.message);
      }
    };
    fetchProfile();
  }, []);

  if (error)
    return (
      <div style={{ color: "red", textAlign: "center" }}>
        Error: {error}
      </div>
    );

  if (!profile)
    return (
      <div style={{ color: "white", textAlign: "center" }}>
        Loading profile...
      </div>
    );

  return (
    <div style={{ color: "white", padding: "2rem", maxWidth: "800px", margin: "auto" }}>
      <h1>{profile.full_name}</h1>
      <p>@{profile.username}</p>
      <p>{profile.about_me}</p>
      <p>📅 {profile.birthdate}</p>
      <p>📍 {profile.location_city}, {profile.location_country}</p>

      <h3>Favorites</h3>
      <ul>
        {profile.favorites?.map((fav, index) => (
          <li key={index}>{fav._id}</li>
        ))}
      </ul>

      <h3>Reviews</h3>
      <ul>
        {profile.reviews?.map((review, index) => (
          <li key={index}>
            <p>{review.review_text}</p>
            <small>{review.date_posted}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
