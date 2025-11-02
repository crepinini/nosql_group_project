import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { getStoredUser, subscribeToAuthChanges } from './Login/auth';
import './Friends.css';
import RecommendationRail from './RecommendationRail';
import FavoritePeopleRail from './FavoritePeopleRail';


export default function Friends() {
    const navigate = useNavigate();
    // films vus par des amis
    const [friendsWatched, setFriendsWatched] = useState([]);
    // films que des amis regardent en ce moment
    const [friendsWatching, setFriendsWatching] = useState([]);
    // films que des amis prévoient de regarder
    const [friendsPlanning, setFriendsPlanning] = useState([]);

    const [loadingFriendStatus, setLoadingFriendStatus] = useState(false);
    const [friendStatusError, setFriendStatusError] = useState(null);


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
    // --- AGGREGATE FRIENDS' FAVORITES ---
    const [friendsFavMovies, setFriendsFavMovies] = useState([]);
    const [friendsFavPeople, setFriendsFavPeople] = useState([]);

    useEffect(() => {
        if (!Array.isArray(friendsProfiles) || friendsProfiles.length === 0) {
            setFriendsFavMovies([]);
            setFriendsFavPeople([]);
            return;
        }

        const controller = new AbortController();
        (async () => {
            try {
                const movieSet = new Set();
                const peopleSet = new Set();

                for (const friend of friendsProfiles) {
                    // récup profil complet (pour avoir les favoris)
                    const fid = friend._id || friend.imdb_user_id;
                    if (!fid) continue;
                    try {
                        const res = await fetch(`/myprofile?user_id=${encodeURIComponent(fid)}`, {
                            signal: controller.signal,
                        });
                        if (!res.ok) continue;
                        const full = await res.json();

                        // movies
                        const favMovies = full.favorites_movies || [];
                        for (const m of favMovies) {
                            const id = typeof m === "string" ? m : m?._id;
                            if (id) movieSet.add(id);
                        }

                        // people
                        const favPeople = full.favorites_people || [];
                        for (const p of favPeople) {
                            const id = typeof p === "string" ? p : p?._id;
                            if (id) peopleSet.add(id);
                        }
                    } catch {
                        continue;
                    }
                }

                // fetch movie & people details
                async function fetchMovies(ids) {
                    const results = await Promise.all(
                        ids.map(async (id) => {
                            try {
                                const r = await fetch(`/api/movies-series/${id}`);
                                if (!r.ok) return null;
                                return await r.json();
                            } catch {
                                return null;
                            }
                        })
                    );
                    return results.filter(Boolean);
                }

                async function fetchPeople(ids) {
                    const results = await Promise.all(
                        ids.map(async (id) => {
                            try {
                                const r = await fetch(`/api/people/${id}`);
                                if (!r.ok) return null;
                                return await r.json();
                            } catch {
                                return null;
                            }
                        })
                    );
                    return results.filter(Boolean);
                }

                const [moviesData, peopleData] = await Promise.all([
                    fetchMovies(Array.from(movieSet)),
                    fetchPeople(Array.from(peopleSet)),
                ]);

                setFriendsFavMovies(moviesData);
                setFriendsFavPeople(peopleData);
            } catch (err) {
                console.error("Failed to aggregate friends favorites", err);
                setFriendsFavMovies([]);
                setFriendsFavPeople([]);
            }
        })();

        return () => controller.abort();
    }, [friendsProfiles]);


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

    const { watchedIds, watchingIds, planIds } = useMemo(() => {
        const watchedSet = new Set();
        const watchingSet = new Set();
        const planSet = new Set();

        friendsProfiles.forEach(friend => {
            const statuses = friend.watch_statuses || {};

            Object.entries(statuses).forEach(([movieId, status]) => {
                if (!movieId) return;
                if (status === "watched") {
                    watchedSet.add(movieId);
                } else if (status === "watching") {
                    watchingSet.add(movieId);
                } else if (status === "plan") {
                    planSet.add(movieId);
                }
            });
        });

        return {
            watchedIds: Array.from(watchedSet),
            watchingIds: Array.from(watchingSet),
            planIds: Array.from(planSet),
        };
    }, [friendsProfiles]);

    function useMoviesDetails(movieIds) {
        const [list, setList] = useState([]);

        useEffect(() => {
            if (!movieIds || movieIds.length === 0) {
                setList([]);
                return;
            }

            const controller = new AbortController();
            let cancelled = false;

            (async () => {
                const results = [];

                for (const movieId of movieIds) {
                    try {
                        const res = await fetch(`/api/movies-series/${encodeURIComponent(movieId)}`, {
                            signal: controller.signal,
                        });
                        if (!res.ok) continue;

                        const data = await res.json();
                        results.push({
                            id: movieId,
                            title: data.title || "Untitled",
                            poster: data.poster || data.poster_url || null,
                            year: data.year || data.release_year || "",
                            type: data.imdb_type || data.type || "",
                        });
                    } catch (err) {
                        if (err.name !== "AbortError") {
                            console.warn("failed to fetch movie", movieId, err);
                        }
                    }
                }

                if (!cancelled) {
                    setList(results);
                }
            })();

            return () => {
                cancelled = true;
                controller.abort();
            };
        }, [movieIds]);

        return list;
    }

    const watchedList = useMoviesDetails(watchedIds);
    const watchingList = useMoviesDetails(watchingIds);
    const planList = useMoviesDetails(planIds);

    useEffect(() => {
        // si t'as pas d'amis => clear
        if (!Array.isArray(friendsProfiles) || friendsProfiles.length === 0) {
            setFriendsWatched([]);
            setFriendsWatching([]);
            setFriendsPlanning([]);
            return;
        }

        let aborted = false;

        (async () => {
            try {
                setLoadingFriendStatus(true);
                setFriendStatusError(null);

                // 1. pour chaque ami -> on va chercher son profil complet
                const friendProfilesFull = await Promise.all(
                    friendsProfiles.map(async (friend) => {
                        const fid = friend._id || friend.imdb_user_id;
                        if (!fid) return null;
                        try {
                            const r = await fetch(
                                `/myprofile?user_id=${encodeURIComponent(fid)}`
                            );
                            if (!r.ok) return null;
                            return await r.json();
                        } catch (err) {
                            console.warn("failed to fetch full friend profile", fid, err);
                            return null;
                        }
                    })
                );

                // 2. agrégation des IDs par statut
                //    watched   -> "watched"
                //    watching  -> "watching"
                //    planning  -> "plan"
                const watchedIds = new Set();
                const watchingIds = new Set();
                const planningIds = new Set();

                for (const fp of friendProfilesFull) {
                    if (!fp || !fp.watch_statuses) continue;
                    const ws = fp.watch_statuses; // { movieId: "watched" | "watching" | "plan" ... }

                    for (const movieId of Object.keys(ws)) {
                        const status = ws[movieId];
                        if (status === "watched") {
                            watchedIds.add(movieId);
                        } else if (status === "watching") {
                            watchingIds.add(movieId);
                        } else if (status === "plan") {
                            planningIds.add(movieId);
                        }
                    }
                }

                // 3. fetch des fiches film/série pour chaque set
                async function fetchMoviesForSet(idSet) {
                    const idsArr = Array.from(idSet);
                    if (idsArr.length === 0) return [];

                    const results = await Promise.all(
                        idsArr.map(async (mid) => {
                            try {
                                const r = await fetch(`/api/movies-series/${encodeURIComponent(mid)}`);
                                if (!r.ok) return null;
                                const data = await r.json();
                                // On garde l'id d'origine au cas où
                                return { ...data, _id: data._id || mid };
                            } catch (err) {
                                console.warn("fail movie fetch", mid, err);
                                return null;
                            }
                        })
                    );

                    // filtre les nulls
                    return results.filter(Boolean);
                }

                const [watchedMovies, watchingMovies, planningMovies] = await Promise.all([
                    fetchMoviesForSet(watchedIds),
                    fetchMoviesForSet(watchingIds),
                    fetchMoviesForSet(planningIds),
                ]);

                if (!aborted) {
                    setFriendsWatched(watchedMovies);
                    setFriendsWatching(watchingMovies);
                    setFriendsPlanning(planningMovies);
                }
            } catch (err) {
                console.error("friend status aggregation failed", err);
                if (!aborted) {
                    setFriendStatusError("Couldn't load what your friends are watching.");
                    setFriendsWatched([]);
                    setFriendsWatching([]);
                    setFriendsPlanning([]);
                }
            } finally {
                if (!aborted) {
                    setLoadingFriendStatus(false);
                }
            }
        })();

        return () => {
            aborted = true;
        };
    }, [friendsProfiles]);



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
            {/* FRIEND ACTIVITY RAILS */}
            <section className="friends-section">
                <RecommendationRail
                    title="Friends’ Favorite Movies & Series"
                    subtitle="What your friends love the most"
                    items={friendsFavMovies}
                    loading={loadingFriends}
                    error={null}
                    emptyMessage="Your friends haven’t added any favorites yet."
                />
                <RecommendationRail
                    title="Your friends watched"
                    subtitle="Recently watched by your friends"
                    items={friendsWatched}
                    loading={loadingFriendStatus}
                    error={friendStatusError}
                    emptyMessage="None of your friends logged anything as watched yet."
                />

                <RecommendationRail
                    title="Your friends are watching"
                    subtitle="Currently being watched"
                    items={friendsWatching}
                    loading={loadingFriendStatus}
                    error={friendStatusError}
                    emptyMessage="None of your friends are watching something right now."
                />

                <RecommendationRail
                    title="Your friends are going to watch"
                    subtitle="On their 'plan to watch' lists"
                    items={friendsPlanning}
                    loading={loadingFriendStatus}
                    error={friendStatusError}
                    emptyMessage="No upcoming plans from your friends yet."
                />
            </section>

            <section className="friends-favorites">

                <FavoritePeopleRail
                    titleOverride="Friends’ Favorite People (Crew & Cast)"
                    subtitleOverride="Actors, directors, and creators your friends love"
                    peopleRefs={
                        friendsFavPeople.map(p => ({ _id: p._id || p.id || p.person_id }))
                    }
                />
            </section>


        </div>

    );
}
