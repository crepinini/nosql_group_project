import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import './MoviePeople.css';
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

const uniqueList = (items) => {
  if (!items || !Array.isArray(items)) {
    return [];
  }

  const seen = new Set();
  return items
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item.toLowerCase())) {
        return false;
      }
      seen.add(item.toLowerCase());
      return true;
    });
};

const MoviePeople = ({ movie }) => {
  const [profiles, setProfiles] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const movieId = movie?._id ?? null;

  const sections = useMemo(() => {
    if (!movie) {
      return [];
    }

    const { first_four_actors, main_actors, directors, writers, creator } =
      movie;

    const actorsSource =
      uniqueList(main_actors).length > 0
        ? uniqueList(main_actors)
        : uniqueList(first_four_actors);

    const crewSources = [
      { list: uniqueList(directors), role: 'Director' },
      { list: uniqueList(writers), role: 'Writer' },
      { list: uniqueList(creator), role: 'Creator' },
    ];

    const crewRegistry = new Map();
    crewSources.forEach(({ list, role }) => {
      list.forEach((name) => {
        if (!crewRegistry.has(name)) {
          crewRegistry.set(name, new Set());
        }
        crewRegistry.get(name).add(role);
      });
    });

    const crewPeople = Array.from(crewRegistry.entries()).map(
      ([name, roles]) => ({
        name,
        fallbackRole: Array.from(roles).join(' / '),
      }),
    );

    const base = [
      {
        id: 'actors',
        title: 'Main Cast',
        people: actorsSource.slice(0, 16).map((name) => ({
          name,
          fallbackRole: 'Cast',
        })),
      },
    ];

    if (crewPeople.length > 0) {
      base.push({
        id: 'crew',
        title: 'Crew',
        people: crewPeople.slice(0, 16),
      });
    }

    return base.filter((section) => section.people.length > 0);
  }, [movie]);

  const uniqueNames = useMemo(() => {
    const registry = new Set();
    sections.forEach((section) =>
      section.people.forEach(({ name }) => registry.add(name)),
    );
    return Array.from(registry);
  }, [sections]);

  useEffect(() => {
    setProfiles({});
    setError(null);
    setIsLoading(false);
  }, [movieId]);

  useEffect(() => {
    if (!uniqueNames.length) {
      setProfiles({});
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const fetchProfiles = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const results = await Promise.all(
          uniqueNames.map(async (name) => {
            try {
              const params = new URLSearchParams({
                q: name,
                limit: '1',
              });
              const response = await fetch(
                buildPeopleUrl(`/people?${params.toString()}`),
                {
                  signal: controller.signal,
                },
              );

              if (!response.ok) {
                throw new Error(`Failed to load data for ${name}`);
              }

              const payload = await response.json();
              const entries = Array.isArray(payload)
                ? payload
                : Array.isArray(payload?.results)
                ? payload.results
                : [];
              const person = entries.length > 0 ? entries[0] : null;
              return [name, person];
            } catch (fetchError) {
              console.warn(fetchError);
              return [name, null];
            }
          }),
        );

        if (!cancelled) {
          const nextProfiles = results.reduce((acc, [name, person]) => {
            acc[name] = person;
            return acc;
          }, {});
          setProfiles(nextProfiles);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            'Unable to load detailed cast information. Some details may be missing.',
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchProfiles();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [uniqueNames, movieId]);

  const enrichedSections = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        people: section.people.map(({ name, fallbackRole }) => ({
          name,
          fallbackRole,
          profile: profiles[name] || null,
        })),
      })),
    [sections, profiles],
  );

  if (!sections.length) {
    return null;
  }

  return (
    <section
      className="movie-people"
      aria-labelledby="movie-people-heading"
      id="actors"
    >
      <div className="movie-people__header">
        <h2 id="movie-people-heading">Meet the People Behind the Story</h2>
        <p>
          Key cast and crew members shaping this title. Scroll sideways to view
          more faces, and open a profile for additional details.
        </p>
      </div>

      {error ? (
        <div className="movie-people__status movie-people__status--error">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className="movie-people__status" role="status">
          Loading cast & crew...
        </div>
      ) : null}

      {enrichedSections.map((section) => (
        <div className="movie-people__group" key={section.id}>
          <div className="movie-people__group-header">
            <h3>{section.title}</h3>
          </div>
          <div className="movie-people__list" role="list">
            {section.people.map(({ name, profile, fallbackRole }) => {
              const imageUrl = buildAvatarUrl(name, profile?.photo_url);
              const profileRole = profile?.role;
              const roleLabel = Array.isArray(profileRole)
                ? profileRole.join(' / ')
                : profileRole || fallbackRole;
              const internalDestination = profile?._id
                ? `/actors/${profile._id}`
                : null;
              const externalDestination = profile?.url;

              const content = (
                <>
                  <div className="movie-people__avatar">
                    <img
                      src={imageUrl || FALLBACK_AVATAR}
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
                    className="movie-people__item"
                    key={`${section.id}-${name}`}
                    to={internalDestination}
                    role="listitem"
                  >
                    {content}
                  </Link>
                );
              }

              return externalDestination ? (
                <a
                  className="movie-people__item"
                  key={`${section.id}-${name}`}
                  href={externalDestination}
                  target="_blank"
                  rel="noopener noreferrer"
                  role="listitem"
                >
                  {content}
                </a>
              ) : (
                <div
                  className="movie-people__item"
                  key={`${section.id}-${name}`}
                  role="listitem"
                >
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
};

export default MoviePeople;
