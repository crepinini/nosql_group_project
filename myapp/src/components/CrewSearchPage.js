import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildPeopleUrl } from '../config';
import './CrewSearchPage.css';

const FALLBACK_AVATAR =
  'https://ui-avatars.com/api/?name=MM&background=023047&color=ffffff&size=256&length=2';
const PAGE_SIZE_OPTIONS = [30, 60, 120];
const FILTER_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Cast', value: 'cast' },
  { label: 'Crew', value: 'crew' },
  { label: 'Director', value: 'director' },
  { label: 'Writer', value: 'writer' },
  { label: 'Creator', value: 'creator' },
];
const SORT_OPTIONS = [
  { label: 'Default', value: 'default' },
  { label: 'Name A-Z', value: 'name-asc' },
  { label: 'Name Z-A', value: 'name-desc' },
  { label: 'Most titles', value: 'credits-desc' },
  { label: 'Fewest titles', value: 'credits-asc' },
];

const toArray = (value) => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    return value
      .split(/[|,/]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
};

const uniqueLower = (items) => {
  const seen = new Set();
  return items
    .map((item) => (item == null ? '' : String(item).trim()))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
};

const normalizeRoles = (person) => {
  const possible = [
    person.role,
    person.roles,
    person.professions,
    person.primary_profession,
    person.known_for_role,
  ];

  const expanded = possible.flatMap((entry) => toArray(entry));
  if (!expanded.length && person.movie) {
    const inferred = []
      .concat(person.movie)
      .flat()
      .map((entry) => entry?.role || entry?.category || '')
      .filter(Boolean);
    expanded.push(...inferred);
  }

  return uniqueLower(expanded);
};

const categorizeRoles = (roles) => {
  const normalized = roles.map((role) => role.toLowerCase());

  const matches = (patterns) =>
    normalized.some((entry) =>
      patterns.some((pattern) =>
        pattern instanceof RegExp ? pattern.test(entry) : entry.includes(pattern),
      ),
    );

  const categories = new Set();

  if (matches([/(actor|actress|cast|performer|voice)/i])) {
    categories.add('cast');
  }

  if (
    matches([
      /(director|writer|creator|producer|screenplay|cinematograph|crew|composer|editor)/i,
    ])
  ) {
    categories.add('crew');
  }

  if (matches([/(director)/i])) {
    categories.add('director');
  }

  if (matches([/(writer|screenplay|screenwriter|playwright)/i])) {
    categories.add('writer');
  }

  if (matches([/(creator|showrunner|developer)/i])) {
    categories.add('creator');
  }

  if (!categories.size) {
    categories.add('crew');
  }

  return Array.from(categories);
};

const buildProfileLink = (person) => {
  const identifier = person?._id || person?.imdb_name_id;
  return identifier ? `/actors/${identifier}` : null;
};

const normalizeKnownFor = (entries) => {
  if (!Array.isArray(entries)) {
    return [];
  }

  const deduped = [];
  const seen = new Set();

  entries.forEach((entry) => {
    if (!entry || !entry.title) {
      return;
    }

    const key = entry._id || entry.imdb_id || entry.title;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push(entry);
  });

  const resolveScore = (entry) => {
    const candidates = [
      entry?.popularity,
      entry?.popularity_score,
      entry?.popularityScore,
      entry?.rating,
      entry?.imdb_rating,
      entry?.vote_average,
    ];

    for (const candidate of candidates) {
      const numeric = Number(candidate);
      if (!Number.isNaN(numeric)) {
        return numeric;
      }
    }
    return 0;
  };

  deduped.sort((a, b) => resolveScore(b) - resolveScore(a));

  return deduped.length ? [deduped[0]] : [];
};

const collectCreditsCount = (person) => {
  const sources = [
    person.movie,
    person.movies,
    person.series,
    person.tv_series,
    person.tvSeries,
    person.credits,
  ];

  const seen = new Set();

  sources.forEach((source) => {
    if (!Array.isArray(source)) {
      return;
    }
    source.forEach((entry) => {
      if (entry == null) {
        return;
      }
      if (typeof entry === 'string' || typeof entry === 'number') {
        const key = String(entry).trim();
        if (key) {
          seen.add(key);
        }
        return;
      }
      const key =
        entry._id ||
        entry.id ||
        entry.imdb_id ||
        entry.imdbId ||
        entry.title ||
        entry.name;
      if (key) {
        seen.add(String(key));
      }
    });
  });

  return seen.size;
};

const normalizePeople = (people) =>
  people.map((person) => {
    const roles = normalizeRoles(person);
    const categories = categorizeRoles(roles);
    const knownForSource =
      person.movie ||
      person.movies ||
      person.series ||
      person.tv_series ||
      person.tvSeries ||
      [];
    const knownFor = normalizeKnownFor(knownForSource);

    return {
      raw: person,
      id: person._id || person.imdb_name_id || person.name,
      name: person.name || 'Unknown talent',
      photoUrl: person.photo_url || person.image_url || null,
      roles,
      categories,
      knownFor,
      creditsCount: collectCreditsCount(person),
      profileLink: buildProfileLink(person),
      externalUrl: person.url || person.imdb_url || null,
    };
  });

const CrewSearchPage = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [category, setCategory] = useState('all');
  const [sortOption, setSortOption] = useState('default');
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [page, setPage] = useState(1);
  const [people, setPeople] = useState([]);
  const [totalPeople, setTotalPeople] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedTerm(searchTerm.trim());
    }, 350);

    return () => clearTimeout(handle);
  }, [searchTerm]);

  useEffect(() => {
    const controller = new AbortController();

    const loadPeople = async () => {
      const params = new URLSearchParams();
      if (debouncedTerm) {
        params.set('q', debouncedTerm);
      }
      params.set('role', category);
      params.set('sort', sortOption);
      params.set('page', String(page));
      params.set('page_size', String(pageSize));

      const query = params.toString();
      const endpoint = buildPeopleUrl(`/people?${query}`);

      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(endpoint, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `Unable to load cast & crew directory (HTTP ${response.status}).`,
          );
        }

        const payload = await response.json();

        const rawResults = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.results)
          ? payload.results
          : [];

        setPeople(normalizePeople(rawResults));
        const totalValue =
          typeof payload?.total === 'number' ? payload.total : rawResults.length;

        const pageSizeValue =
          typeof payload?.pageSize === 'number' && payload.pageSize > 0
            ? payload.pageSize
            : pageSize;

        setTotalPeople(totalValue);

        const computedTotalPages =
          typeof payload?.totalPages === 'number'
            ? payload.totalPages
            : pageSizeValue
            ? Math.ceil(totalValue / pageSizeValue)
            : 0;

        setTotalPages(computedTotalPages);
      } catch (err) {
        if (err.name !== 'AbortError') {
          const hint = endpoint.startsWith('http')
            ? `Please verify the people service at ${endpoint} is reachable.`
            : 'Please verify the people service is reachable through the development proxy (port 5002).';
          setError(`${err.message || 'Unknown error occurred.'} ${hint}`);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadPeople();

    return () => controller.abort();
  }, [debouncedTerm, category, sortOption, page, pageSize]);

  useEffect(() => {
    if (totalPages && page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pageButtons = useMemo(() => {
    if (!totalPages) {
      return [];
    }

    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, index) => ({
        type: 'page',
        value: index + 1,
      }));
    }

    const candidates = new Set([1, totalPages]);
    for (let offset = -1; offset <= 1; offset += 1) {
      candidates.add(page + offset);
    }

    if (page <= 3) {
      candidates.add(2);
      candidates.add(3);
      candidates.add(4);
    }

    if (page >= totalPages - 2) {
      candidates.add(totalPages - 1);
      candidates.add(totalPages - 2);
      candidates.add(totalPages - 3);
    }

    const sortedPages = Array.from(candidates)
      .filter((value) => value >= 1 && value <= totalPages)
      .sort((a, b) => a - b);

    const buttons = [];
    let previous = null;

    sortedPages.forEach((value) => {
      if (previous !== null && value - previous > 1) {
        buttons.push({ type: 'ellipsis', key: `ellipsis-${previous}-${value}` });
      }
      buttons.push({ type: 'page', value });
      previous = value;
    });

    return buttons;
  }, [totalPages, page]);

  const summaryText = useMemo(() => {
    const hasFilters = Boolean(debouncedTerm) || category !== 'all';

    if (!totalPeople) {
      return hasFilters ? '0 matches for the selected filters' : 'No profiles yet';
    }

    if (!people.length) {
      return 'No profiles on this page.';
    }

    const rangeStart = (page - 1) * pageSize + 1;
    const rangeEnd = Math.min(rangeStart + people.length - 1, totalPeople);
    const currentPage = Math.min(page, Math.max(totalPages, 1));
    const pageLabel = totalPages > 1 ? ` (page ${currentPage} of ${totalPages})` : '';
    return `Showing ${rangeStart}-${rangeEnd} of ${totalPeople} profiles${pageLabel}`;
  }, [
    debouncedTerm,
    category,
    people.length,
    page,
    pageSize,
    totalPeople,
    totalPages,
  ]);

  return (
    <section className="crew-page">
      <header className="crew-page__header">
        <div>
          <h1>Cast & Crew</h1>
        </div>
        <div className="crew-page__summary" aria-live="polite">
          {summaryText}
        </div>
      </header>

      <form
        className="crew-page__controls"
        role="search"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="crew-page__search-label" htmlFor="crew-search">
          Search people
        </label>
        <input
          id="crew-search"
          className="crew-page__search-input"
          type="search"
          placeholder="Search by name"
          value={searchTerm}
          onChange={(event) => {
            setSearchTerm(event.target.value);
            setPage(1);
          }}
        />
        <div className="crew-page__filter-bar">
          <div className="crew-page__sort">
            <label htmlFor="crew-sort">Sort</label>
            <div className="crew-page__sort-control">
              <select
                id="crew-sort"
                className="crew-page__sort-select"
                value={sortOption}
                onChange={(event) => {
                  setSortOption(event.target.value);
                  setPage(1);
                }}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="crew-page__filters" role="group" aria-label="Filter by role">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`crew-page__filter ${
                  category === option.value ? 'crew-page__filter--active' : ''
                }`}
                onClick={() => {
                  setCategory(option.value);
                  setPage(1);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </form>

      {error ? (
        <div className="crew-page__status crew-page__status--error" role="alert">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className="crew-page__status" role="status">
          Loading profiles...
        </div>
      ) : null}

      {!isLoading && !error && totalPeople === 0 ? (
        <div className="crew-page__status" role="status">
          No people matched your filters. Try a different search or reset the filters.
        </div>
      ) : null}

      {totalPeople > 0 ? (
        <div className="crew-page__toolbar" aria-label="Pagination controls">
          <div className="crew-page__page-size">
            <label htmlFor="crew-page-size">Profiles per page</label>
            <select
              id="crew-page-size"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="crew-page__pager" role="group" aria-label="Select page">
            <button
              type="button"
              className="crew-page__pager-button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page <= 1}
            >
              Prev
            </button>
            {pageButtons.map((entry) => {
              if (entry.type === 'ellipsis') {
                return (
                  <span key={entry.key} className="crew-page__pager-ellipsis" aria-hidden="true">
                    &hellip;
                  </span>
                );
              }

              const pageNumber = entry.value;
              return (
                <button
                  key={pageNumber}
                  type="button"
                  className={`crew-page__pager-button ${
                    pageNumber === page ? 'crew-page__pager-button--active' : ''
                  }`}
                  onClick={() => setPage(pageNumber)}
                  aria-current={pageNumber === page ? 'page' : undefined}
                >
                  {pageNumber}
                </button>
              );
            })}
            <button
              type="button"
              className="crew-page__pager-button"
              onClick={() =>
                setPage((prev) =>
                  totalPages ? Math.min(totalPages, prev + 1) : prev,
                )
              }
              disabled={page >= totalPages || totalPages === 0}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      <div className="crew-grid">
        {people.map((person) => {
          const content = (
            <>
              <div className="crew-card__avatar">
                <img
                  src={person.photoUrl || FALLBACK_AVATAR}
                  alt={person.name}
                  loading="lazy"
                />
              </div>
              <div className="crew-card__body">
                <h2 className="crew-card__name">{person.name}</h2>
                {person.roles.length ? (
                  <ul className="crew-card__roles">
                    {person.roles.slice(0, 4).map((role) => (
                      <li key={role}>{role}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="crew-card__roles crew-card__roles--muted">
                    Role unavailable
                  </div>
                )}
                {person.knownFor.length ? (
                  <div className="crew-card__known-for">
                    <span className="crew-card__known-for-label">Known for</span>
                    <ul>
                      {person.knownFor.map((entry) => (
                        <li
                          key={entry._id || entry.title}
                          className="crew-card__known-for-item"
                        >
                          {entry.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </>
          );

          if (person.profileLink) {
            return (
              <Link
                key={person.id}
                to={person.profileLink}
                className="crew-card"
              >
                {content}
              </Link>
            );
          }

          if (person.externalUrl) {
            return (
              <a
                key={person.id}
                href={person.externalUrl}
                className="crew-card"
                target="_blank"
                rel="noopener noreferrer"
              >
                {content}
              </a>
            );
          }

          return (
            <div key={person.id} className="crew-card">
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default CrewSearchPage;
