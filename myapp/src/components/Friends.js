import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { getStoredUser, subscribeToAuthChanges } from './Login/auth';
import './Friends.css';

export default function Friends() {
    const navigate = useNavigate();

    // --- AUTH USER SYNC ---
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

    // --- LOAD MY PROFILE ---
    const [profile, setProfile] = useState(null);
    const [loadingProfile, setLoadingProfile] = useState(true);

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
                    setProfile(null);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoadingProfile(false);
                }
            }
        })();

        return () => controller.abort();
    }, [authUser]);

    // --- LOAD FRIEND DETAILS (from profile.friends list) ---
    const [friendsProfiles, setFriendsProfiles] = useState([]);
    const [loadingFriends, setLoadingFriends] = useState(false);

    useEffect(() => {
        if (
            !profile ||
            !Array.isArray(profile.friends) ||
            profile.friends.length === 0
        ) {
            setFriendsProfiles([]);
            return;
        }

        const controller = new AbortController();

        (async () => {
            try {
                setLoadingFriends(true);

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
                    setFriendsProfiles([]);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoadingFriends(false);
                }
            }
        })();

        return () => controller.abort();
    }, [profile?.friends]);

    // --- SORT FRIENDS ALPHABETICALLY FOR DISPLAY ---
    const sortedFriends = useMemo(() => {
        if (!Array.isArray(friendsProfiles)) return [];
        const cleaned = friendsProfiles
            .map((f) => {
                const id = f._id || f.imdb_user_id || '';
                const name = f.full_name || f.username || 'Unknown User';
                const city = f.location_city || '';
                const country = f.location_country || '';
                const location = [city, country].filter(Boolean).join(', ') || '—';

                const initials = name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase();

                return { id, name, location, initials };
            })
            .filter((f) => f.id && f.name); // évite les trous vides

        cleaned.sort((a, b) => {
            const an = a.name.toLowerCase();
            const bn = b.name.toLowerCase();
            if (an < bn) return -1;
            if (an > bn) return 1;
            return 0;
        });

        return cleaned;
    }, [friendsProfiles]);

    // --- REMOVE FRIEND ---
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

            // update local ui
            setFriendsProfiles((prev) => prev.filter((f) => (f._id || f.imdb_user_id) !== friendId));

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

    // --- SEARCH USERS ---
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

    // --- REQUEST MAPS (pending requests) ---
    const [requestSentMap, setRequestSentMap] = useState({});
    const [serverPendingMap, setServerPendingMap] = useState({});

    // load "already pending?" from backend for each result
    useEffect(() => {
        if (!authUser?._id) return;
        if (!Array.isArray(searchResults) || searchResults.length === 0) {
            setServerPendingMap({});
            return;
        }

        let abort = false;

        (async () => {
            const updated = {};

            for (const user of searchResults) {
                const targetId = user._id || user.imdb_user_id;
                if (!targetId || targetId === authUser._id) continue;

                try {
                    const res = await fetch(
                        `/friend-requests/${targetId}`
                    );
                    if (!res.ok) continue;

                    const pendingList = await res.json();

                    const iAlreadyAsked = pendingList.some(
                        (req) => req.from_user === authUser._id
                    );

                    if (iAlreadyAsked) {
                        updated[targetId] = true;
                    }
                } catch (err) {
                    console.error('check pending failed for', targetId, err);
                }
            }

            if (!abort) {
                setServerPendingMap(updated);
            }
        })();

        return () => {
            abort = true;
        };
    }, [authUser?._id, searchResults]);

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

                setRequestSentMap((prev) => {
                    const copy = { ...prev };
                    delete copy[targetId];
                    return copy;
                });

                alert('Could not send friend request.');
                return;
            }

            // mark pending
            setServerPendingMap((prev) => ({ ...prev, [targetId]: true }));
        } catch (err) {
            console.error('Error sending friend request:', err);
            setRequestSentMap((prev) => {
                const copy = { ...prev };
                delete copy[targetId];
                return copy;
            });
            alert('Error sending friend request.');
        }
    }

    async function handleCancelFriendRequest(targetId) {
        if (!authUser?._id || !targetId) return;

        try {
            const res = await fetch(
                `/friend-request/${authUser._id}/${targetId}/cancel`,
                { method: 'POST' }
            );

            if (!res.ok) {
                console.error('Failed to cancel request', res.status);
                alert('Could not cancel friend request.');
                return;
            }

            setRequestSentMap((prev) => {
                const copy = { ...prev };
                delete copy[targetId];
                return copy;
            });

            setServerPendingMap((prev) => {
                const copy = { ...prev };
                delete copy[targetId];
                return copy;
            });
        } catch (err) {
            console.error('Error cancelling friend request:', err);
            alert('Error cancelling friend request.');
        }
    }

    // --- Helpers ---
    const isOwnPage = useMemo(() => {
        if (!authUser || !profile) return false;
        return (
            authUser._id === profile._id ||
            authUser.username === profile.username
        );
    }, [authUser, profile]);

    function renderFriendCardGrid(friendObj) {
        // friendObj est { id, name, location, initials } venant de sortedFriends
        const { id, name, location, initials } = friendObj;

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
                    className="friend-card-inner"
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
                    <p className="friend-meta">{location}</p>
                </div>
            </div>
        );
    }

    // --- AUTH GUARD ---
    if (!authUser) {
        return <Navigate to="/login" replace />;
    }

    // --- RENDER ---
    return (
        <div className="friends-page">
            <div className="friends-container">
                {/* YOUR FRIENDS */}
                <section className="friends-section">
                    <div className="section-header">
                        <h2 className="section-title">Your friends</h2>
                        <p className="section-sub">
                            People you're connected with
                        </p>
                    </div>

                    {loadingFriends ? (
                        <p className="friends-empty">Loading friends…</p>
                    ) : sortedFriends.length === 0 ? (
                        <p className="friends-empty">You don't have any friends yet.</p>
                    ) : (
                        <div className="friends-grid">
                            {sortedFriends.map(renderFriendCardGrid)}
                        </div>
                    )}
                </section>

                {/* FIND PEOPLE */}
                <section className="friends-section">
                    <div className="section-header">
                        <h2 className="section-title">Find people</h2>
                        <p className="section-sub">
                            Search by full name or username, then click a profile
                            to view them or send a friend request.
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
                        {searchBusy && (
                            <div className="friend-search-status">Searching…</div>
                        )}
                    </div>

                    {searchError && (
                        <div className="friends-error">{searchError}</div>
                    )}

                    {searchResults.length > 0 && (
                        <div className="search-grid">
                            {searchResults.map((user) => {
                                const id = user._id || user.imdb_user_id;
                                const name = user.full_name || user.username || 'Unknown User';
                                const city = user.location_city || '';
                                const country = user.location_country || '';
                                const location = [city, country].filter(Boolean).join(', ') || '—';
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

                                // check if already friend
                                const alreadyFriend = profile?.friends?.some((fr) => {
                                    const fid =
                                        typeof fr === 'string' ? fr : fr?._id || fr?.id;
                                    return fid === id;
                                });

                                const alreadyRequested =
                                    requestSentMap[id] === true ||
                                    serverPendingMap[id] === true;

                                return (
                                    <div key={id || name} className="search-card">
                                        <div
                                            className="search-card-clickable"
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => {
                                                if (id) navigate(`/profile?user_id=${id}`);
                                            }}
                                            onKeyDown={(e) => {
                                                if (
                                                    (e.key === 'Enter' || e.key === ' ') &&
                                                    id
                                                ) {
                                                    navigate(`/profile?user_id=${id}`);
                                                }
                                            }}
                                        >
                                            <div className="friend-avatar">
                                                <span>{initials}</span>
                                            </div>
                                            <h3 className="friend-name">{name}</h3>
                                            <p className="friend-meta">{location}</p>
                                        </div>

                                        {/* Action button zone */}
                                        {itsMe ? (
                                            <div className="friend-action-btn friend-action-btn-disabled">
                                                you
                                            </div>
                                        ) : alreadyFriend ? (
                                            <div className="friend-action-btn friend-action-btn-disabled">
                                                ✓ Friends
                                            </div>
                                        ) : alreadyRequested ? (
                                            <button
                                                className="friend-action-btn"
                                                style={{
                                                    background:
                                                        'rgba(255,255,255,0.08)',
                                                    color: '#ccc',
                                                    border:
                                                        '1px solid rgba(255,255,255,0.2)',
                                                }}
                                                onClick={async () => {
                                                    await handleCancelFriendRequest(id);
                                                }}
                                            >
                                                Cancel request
                                            </button>
                                        ) : (
                                            <button
                                                className="friend-action-btn"
                                                onClick={async () => {
                                                    await handleSendFriendRequest(id);
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

                    {/* "no user found" message */}
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
