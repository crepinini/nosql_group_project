import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import './FavoritePeople.css'; // on réutilise les mêmes styles visuels

import { buildPeopleUrl } from '../config';

const FALLBACK_AVATAR =
    'https://ui-avatars.com/api/?name=MM&background=023047&color=ffffff&size=256&length=2';

const buildAvatarUrl = (name, photoUrl) => {
    if (photoUrl) {
        return photoUrl;
    }
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(
        name,
    )}&background=023047&color=ffffff&size=256&length=2`;
};

const FavoritePeopleRail = ({ peopleRefs = [] }) => {
    const [peopleDetails, setPeopleDetails] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const uniqueIds = useMemo(() => {
        if (!Array.isArray(peopleRefs)) return [];
        const seen = new Set();
        return peopleRefs
            .map((ref) => (typeof ref === 'string' ? ref : ref?._id))
            .filter(Boolean)
            .filter((id) => {
                if (seen.has(id)) return false;
                seen.add(id);
                return true;
            });
    }, [peopleRefs]);

    const uniqueIdsKey = useMemo(() => uniqueIds.join(','), [uniqueIds]);

    useEffect(() => {
        setPeopleDetails([]);
        setError(null);
        setLoading(false);
    }, [uniqueIdsKey]);

    useEffect(() => {
        if (!uniqueIds.length) {
            setPeopleDetails([]);
            return;
        }

        let cancelled = false;
        const controller = new AbortController();

        (async () => {
            try {
                setLoading(true);
                setError(null);

                const results = await Promise.all(
                    uniqueIds.map(async (id) => {
                        try {
                            const res = await fetch(
                                buildPeopleUrl(`/people/${encodeURIComponent(id)}`),
                                { signal: controller.signal },
                            );
                            if (!res.ok) {
                                throw new Error(`HTTP ${res.status}`);
                            }
                            const data = await res.json();
                            return { ...data, _id: data._id || id };
                        } catch (err) {
                            console.warn('Failed to load person', id, err);
                            return null;
                        }
                    }),
                );

                if (!cancelled) {
                    setPeopleDetails(results.filter(Boolean));
                }
            } catch (err) {
                if (!cancelled) {
                    console.error(err);
                    setError(
                        'Unable to load your favorite crew/cast. Some info may be missing.',
                    );
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [uniqueIds]);

    const displayPeople = useMemo(() => {

        return peopleDetails.map((person) => {
            const id = person._id;
            const name =
                person.name ||
                person.full_name ||
                person.display_name ||
                'Unknown';
            const roleRaw = person.role || person.primary_role || person.job;
            const roleLabel = Array.isArray(roleRaw)
                ? roleRaw.join(' / ')
                : roleRaw || '';

            const avatarUrl = buildAvatarUrl(name, person.photo_url);

            return {
                id,
                name,
                roleLabel,
                avatarUrl,
                internalDestination: id ? `/people/${id}` : null,
                externalDestination: person.url || null,
            };
        });
    }, [peopleDetails]);

    return (
        <section
            className="movie-people"
            aria-labelledby="favorite-people-heading"
        >
            <div className="movie-people__header">
                <h2 id="favorite-people-heading">Favorite Crew &amp; Cast</h2>
                <p>Your go-to actors, directors and storytellers</p>
            </div>

            {error ? (
                <div className="movie-people__status movie-people__status--error">
                    {error}
                </div>
            ) : null}

            {loading ? (
                <div className="movie-people__status" role="status">
                    Loading your favorites…
                </div>
            ) : null}

            {!loading && !error && displayPeople.length === 0 ? (
                <div className="movie-people__status movie-people__status--empty">
                    You don’t have any favorite people yet
                </div>
            ) : null}

            {displayPeople.length > 0 ? (
                <div className="movie-people__group" key="favorite-people-group">
                    <div className="movie-people__group-header">
                        <h3>People you follow</h3>
                    </div>

                    <div className="movie-people__list" role="list">
                        {displayPeople.map(
                            ({
                                id,
                                name,
                                roleLabel,
                                avatarUrl,
                                internalDestination,
                                externalDestination,
                            }) => {
                                const cardContent = (
                                    <>
                                        <div className="movie-people__avatar">
                                            <img
                                                src={avatarUrl || FALLBACK_AVATAR}
                                                alt={name}
                                                loading="lazy"
                                            />
                                        </div>
                                        <span className="movie-people__name">{name}</span>
                                        {roleLabel ? (
                                            <span className="movie-people__role">{roleLabel}</span>
                                        ) : null}
                                    </>
                                );

                                if (internalDestination) {
                                    return (
                                        <Link
                                            key={id}
                                            className="movie-people__item"
                                            to={internalDestination}
                                            role="listitem"
                                        >
                                            {cardContent}
                                        </Link>
                                    );
                                }

                                if (externalDestination) {
                                    return (
                                        <a
                                            key={id}
                                            className="movie-people__item"
                                            href={externalDestination}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            role="listitem"
                                        >
                                            {cardContent}
                                        </a>
                                    );
                                }

                                return (
                                    <div
                                        key={id || name}
                                        className="movie-people__item"
                                        role="listitem"
                                    >
                                        {cardContent}
                                    </div>
                                );
                            },
                        )}
                    </div>
                </div>
            ) : null}
        </section>
    );
};

export default FavoritePeopleRail;
