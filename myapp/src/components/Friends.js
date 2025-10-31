// Friends.js
import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStoredUser, subscribeToAuthChanges } from './Login/auth';
import './Friends.css';

export default function Friends() {
    const navigate = useNavigate();

    const [authUser, setAuthUser] = useState(() => getStoredUser());
    useEffect(() => {
        const handle = () => setAuthUser(getStoredUser());
        const unsubscribe = subscribeToAuthChanges(handle);
        window.addEventListener('storage', handle);
        return () => {
            unsubscribe();
            window.removeEventListener('storage', handle);
        };
    }, []);

    const [profile, setProfile] = useState(null);
    const [loadingProfile, setLoadingProfile] = useState(true);
    const [profileError, setProfileError] = useState(null);

    useEffect(() => {
        const userId = authUser?._id || authUser?.username;
        if (!userId) {
            setProfile(null);
            setLoadingProfile(false);
            return;
        }

        const controller = new AbortController();
        (async () => {
            try {
                setLoadingProfile(true);
                setProfileError(null);

                const res = await fetch(
                    `/myprofile?user_id=${encodeURIComponent(userId)}`,
                    { signal: controller.signal }
                );

                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                setProfile(data);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Failed to load profile', err);
                    setProfileError('Unable to load your profile.');
                    setProfile(null);
                }
            } finally {
                if (!controller.signal.aborted) setLoadingProfile(false);
            }
        })();

        return () => controller.abort();
    }, [authUser]);

    const [friendsProfiles, setFriendsProfiles] = useState([]);
    const [loadingFriends, setLoadingFriends] = useState(false);
    const [friendsError, setFriendsError] = useState(null);

    useEffect(() => {
        if (!profile || !Array.isArray(profile.friends) || profile.friends.length === 0) {
            setFriendsProfiles([]);
            return;
        }

        const controller = new AbortController();

        (async () => {
            try {
                setLoadingFriends(true);
                setFriendsError(null);

                const results = await Promise.all(
                    profile.friends.map(async (f) => {
                        const id = typeof f === 'string' ? f : f?._id || f?.id;
                        if (!id) return null;

                        try {
                            const res = await fetch(`/users/${encodeURIComponent(id)}`, {
                                signal: controller.signal,
                            });
                            if (!res.ok) return null;
                            return await res.json();
                        } catch (err) {
                            if (err.name !== 'AbortError') return null;
                            return null;
                        }
                    })
                );

                setFriendsProfiles(results.filter(Boolean));
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Failed to load friends', err);
                    setFriendsError('Unable to load friends.');
                    setFriendsProfiles([]);
                }
            } finally {
                if (!controller.signal.aborted) setLoadingFriends(false);
            }
        })();

        return () => controller.abort();
    }, [profile?.friends]);

    const isOwnPage = useMemo(() => {
        if (!authUser || !profile) return false;
        return (
            authUser._id === profile._id || authUser.username === profile.username
        );
    }, [authUser, profile]);

    function isAlreadyFriend(userId) {
        if (!profile || !Array.isArray(profile.friends)) return false;
        return profile.friends.some((fr) => {
            const id = typeof fr === 'string' ? fr : fr?._id || fr?.id;
            return id === userId;
        });
    }

    async function handleRemoveFriendDirect(friendId) {
        if (!authUser?._id || !friendId) return;
        const confirmDelete = window.confirm('Remove this friend?');
        if (!confirmDelete) return;

        try {
            const res = await fetch(
                `/users/${authUser._id}/friends/${friendId}`,
                { method: 'DELETE' }
            );

            if (!res.ok) {
                console.error('Failed to remove friend', res.status);
                alert('Could not remove friend.');
                return;
            }

            // update local UI
            setFriendsProfiles((prev) => prev.filter((f) => f._id !== friendId));

            setProfile((prev) => {
                if (!prev) return prev;
                const newFriends = Array.isArray(prev.friends)
                    ? prev.friends.filter((fr) => {
                        const id = typeof fr === 'string' ? fr : fr?._id || fr?.id;
                        return id !== friendId;
                    })
                    : [];
                return { ...prev, friends: newFriends };
            });
        } catch (err) {
            console.error('Error removing friend:', err);
            alert('Error removing friend.');
        }
    }

    const [searchQuery, setSearchQuery] = useState('');
    const [searchBusy, setSearchBusy] = useState(false);
    const [searchError, setSearchError] = useState(null);
    const [searchResults, setSearchResults] = useState([]);
    const [hasFetchedOnce, setHasFetchedOnce] = useState(false);

    useEffect(() => {
        const q = searchQuery.trim();

        if (q === '') {
            setSearchResults([]);
            setHasFetchedOnce(false);
            setSearchError(null);
            return;
        }

        const controller = new AbortController();
        const timer = setTimeout(async () => {
            try {
                setSearchBusy(true);
                setSearchError(null);

                const res = await fetch(
                    `/users?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(50)}`,
                    { signal: controller.signal }
                );

                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }

                const data = await res.json();
                if (Array.isArray(data)) {
                    setSearchResults(data);
                } else {
                    setSearchResults([]);
                }

                setHasFetchedOnce(true);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Search failed:', err);
                    setSearchError('Search failed.');
                    setSearchResults([]);
                    setHasFetchedOnce(true);
                }
            } finally {
                setSearchBusy(false);
            }
        }, 300);

        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [searchQuery]);


    const [requestSentMap, setRequestSentMap] = useState({});


    async function handleSendFriendRequest(targetId) {
        if (!authUser?._id || !targetId) return;

        try {
            setRequestSentMap((prev) => ({ ...prev, [targetId]: true }));

            const res = await fetch(`/friend-request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from_user: authUser._id,
                    to_user: targetId,
                }),
            });

            if (!res.ok) {
                console.error('Failed to send friend request', res.status);
                alert('Could not send friend request.');
                setRequestSentMap((prev) => {
                    const copy = { ...prev };
                    delete copy[targetId];
                    return copy;
                });
                return;
            }

        } catch (err) {
            console.error('Error sending friend request:', err);
            alert('Error sending friend request.');
            setRequestSentMap((prev) => {
                const copy = { ...prev };
                delete copy[targetId];
                return copy;
            });
        }
    }

    function renderFriendCard(friend) {
        const id = friend._id || friend.imdb_user_id;
        const name = friend.full_name || friend.username || 'Unknown User';
        const city = friend.location_city || '';
        const country = friend.location_country || '';
        const initials = name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();

        return (
            <div key={id} className="friend-card">
                {isOwnPage && (
                    <button
                        className="friend-delete-btn"
                        title="Remove friend"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveFriendDirect(id);
                        }}
                    >
                        ✖
                    </button>
                )}

                <div
                    role="button"
                    tabIndex={0}
                    title={name}
                    className="friend-card-inner"
                    onClick={() => id && navigate(`/profile?user_id=${id}`)}
                    onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && id) {
                            navigate(`/profile?user_id=${id}`);
                        }
                    }}
                >
                    <div className="friend-avatar">
                        <span>{initials}</span>
                    </div>
                    <h3 className="friend-name">{name}</h3>
                    <p className="friend-meta">
                        {[city, country].filter(Boolean).join(', ') || '—'}
                    </p>
                </div>
            </div>
        );
    }

    function renderSearchCard(user) {
        const id = user._id || user.imdb_user_id;
        const name = user.full_name || user.username || 'Unknown User';
        const city = user.location_city || '';
        const country = user.location_country || '';
        const initials = name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();

        const itsMe =
            authUser &&
            (authUser._id === id || authUser.username === user.username);

        const alreadyFriend = isAlreadyFriend(id);
        const alreadyRequested = requestSentMap[id];

        return (
            <div key={id || Math.random()} className="search-card">
                <div
                    role="button"
                    tabIndex={0}
                    className="search-card-clickable"
                    title={name}
                    onClick={() => id && navigate(`/profile?user_id=${id}`)}
                    onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && id) {
                            navigate(`/profile?user_id=${id}`);
                        }
                    }}
                >
                    <div className="friend-avatar">
                        <span>{initials}</span>
                    </div>
                    <h3 className="friend-name">{name}</h3>
                    <p className="friend-meta">
                        {[city, country].filter(Boolean).join(', ') || '—'}
                    </p>
                </div>

                {!itsMe && (
                    <div className="search-action-row">
                        {alreadyFriend ? (
                            <button className="search-action-btn already" disabled>
                                Already friends
                            </button>
                        ) : alreadyRequested ? (
                            <button className="search-action-btn pending" disabled>
                                Request sent
                            </button>
                        ) : (
                            <button
                                className="search-action-btn add"
                                onClick={() => handleSendFriendRequest(id)}
                            >
                                ➕ Add friend
                            </button>
                        )}
                    </div>
                )}
            </div>
        );
    }

    if (!authUser) {
        return (
            <div className="friends-page">
                <div className="friends-container">
                    <p className="friends-error">Please sign in to see your friends.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="friends-page">
            <div className="friends-container">
                {/* YOUR FRIENDS */}
                <section className="friends-section">
                    <div className="section-header">
                        <h2 className="section-title">Your friends</h2>
                    </div>

                    {loadingFriends ? (
                        <p className="friends-empty">Loading friends…</p>
                    ) : friendsProfiles.length === 0 ? (
                        <p className="friends-empty">You don't have any friends yet.</p>
                    ) : (
                        <div className="friends-grid">
                            {friendsProfiles.map((f) => renderFriendCard(f))}
                        </div>
                    )}
                </section>

                {/* FIND PEOPLE */}
                <section className="friends-section">
                    <div className="section-header">
                        <h2 className="section-title">Find people</h2>
                        <p className="section-sub">
                            Search by full name or username, then click a profile to view them
                            or send a friend request.
                        </p>
                    </div>

                    <div className="friend-search-bar">
                        <input
                            type="text"
                            className="friend-search-input"
                            placeholder="Search users…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />

                        {/* petit état "typing/loading" à droite du champ */}
                        {searchBusy && (
                            <div className="friend-search-status">
                                Searching…
                            </div>
                        )}
                    </div>


                    {searchError && (
                        <div className="friends-error-msg">
                            {searchError}
                        </div>
                    )}

                    {searchResults.length > 0 && (
                        <div className="search-grid">
                            {searchResults.map((user) => {
                                const id = user._id || user.imdb_user_id;
                                const name = user.full_name || user.username || 'Unknown User';
                                const city = user.location_city || '';
                                const country = user.location_country || '';
                                const initials = name
                                    .split(' ')
                                    .map((n) => n[0])
                                    .join('')
                                    .slice(0, 2)
                                    .toUpperCase();

                                const itsMe =
                                    authUser &&
                                    (authUser._id === id ||
                                        authUser.username === user.username);

                                const alreadyFriend = profile?.friends?.some(fr => {
                                    const fid = typeof fr === 'string' ? fr : fr?._id || fr?.id;
                                    return fid === id;
                                });

                                return (
                                    <div
                                        key={id || name}
                                        className="friend-card search-card"
                                    >
                                        <div
                                            className="friend-card-clickzone"
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => {
                                                if (!id || itsMe) return;
                                                navigate(`/profile?user_id=${id}`);
                                            }}
                                            onKeyDown={(e) => {
                                                if ((e.key === 'Enter' || e.key === ' ') && id && !itsMe) {
                                                    navigate(`/profile?user_id=${id}`);
                                                }
                                            }}
                                        >
                                            <div className="friend-avatar">
                                                <span>{initials}</span>
                                            </div>

                                            <h3 className="friend-name">{name}</h3>

                                            <p className="friend-meta">
                                                {[city, country].filter(Boolean).join(', ') || '—'}
                                            </p>
                                        </div>

                                        {itsMe ? (
                                            <div className="you-pill">you</div>
                                        ) : alreadyFriend ? (
                                            <button
                                                className="friend-action-btn friend-action-btn-disabled"
                                                disabled
                                            >
                                                ✓ Friends
                                            </button>
                                        ) : (
                                            <button
                                                className="friend-action-btn"
                                                onClick={async () => {

                                                    try {
                                                        const res = await fetch(
                                                            `/users/${authUser._id}/friends/${id}`,
                                                            { method: 'POST' }
                                                        );
                                                        if (!res.ok) {
                                                            alert('Could not add friend.');
                                                            return;
                                                        }

                                                        alert('Friend request sent / Friend added!');
                                                    } catch (err) {
                                                        alert('Problem adding friend.');
                                                    }
                                                }}
                                            >
                                                + Add friend
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* message "no users found" : seulement si l'input est non vide ET qu'on a déjà fetch au moins une fois */}
                    {hasFetchedOnce &&
                        searchQuery.trim() !== '' &&
                        searchResults.length === 0 &&
                        !searchBusy &&
                        !searchError && (
                            <p className="friends-empty">
                                No users found for “{searchQuery.trim()}”.
                            </p>
                        )}

                </section>
            </div>
        </div>
    );
}
