import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { buildMoviesUrl, buildPeopleUrl, buildUsersUrl } from '../config';
import {
  getStoredUser,
  subscribeToAuthChanges,
} from './Login/auth';
import './MyList.css';

const FALLBACK_POSTER =
  'https://via.placeholder.com/400x600.png?text=Poster+Unavailable';
const FALLBACK_PROFILE =
  'https://via.placeholder.com/400x600.png?text=Profile+Unavailable';

const PAGE_SIZE = 10;
const NAV_PAGE_SIZE = PAGE_SIZE;

const buildPageButtons = (page, totalPages) => {
  if (totalPages <= 1) {
    return [{ type: 'page', value: 1 }];
  }

  if (totalPages <= 7) {
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
};

const formatRuntime = (duration) => {
  if (!duration) {
    return null;
  }
  const minutes = Number(duration);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${String(remaining).padStart(2, '0')}m`;
};

const formatSeasons = (value) => {
  if (value == null) {
    return null;
  }
  if (Array.isArray(value)) {
    const total = value.length;
    if (!total) {
      return null;
    }
    return `${total} season${total === 1 ? '' : 's'}`;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  const rounded = Math.round(parsed);
  return `${rounded} season${rounded === 1 ? '' : 's'}`;
};

const resolveMovieId = (entity) => {
  if (!entity) {
    return null;
  }
  return (
    entity.movie_id ||
    entity._id ||
    entity.imdb_id ||
    entity.id ||
    null
  );
};

const resolvePersonId = (entity) => {
  if (!entity) {
    return null;
  }
  if (typeof entity === 'string') {
    return entity.trim() || null;
  }
  return (
    entity.person_id ||
    entity.personId ||
    entity.id ||
    entity.imdb_name_id ||
    entity.imdbNameId ||
    entity._id ||
    null
  );
};

const normalizePerson = (person) => {
  const resolvedId =
    resolvePersonId(person) ||
    (person?.name ? String(person.name).trim() : '');
  const id = resolvedId ? String(resolvedId) : '';

  const professionSource =
    person?.primary_profession ??
    person?.primaryProfession ??
    person?.professions ??
    person?.profession ??
    null;

  let primaryProfession = null;
  if (Array.isArray(professionSource)) {
    primaryProfession = professionSource.filter(Boolean).join(', ');
  } else if (professionSource) {
    primaryProfession = String(professionSource);
  }

  const photoUrl =
    person?.photo_url ||
    person?.image_url ||
    person?.photoUrl ||
    person?.imageUrl ||
    null;

  return {
    id,
    name: person?.name || 'Unknown talent',
    primaryProfession,
    photoUrl,
    raw: person,
  };
};

const toLower = (value) => (value ? String(value).toLowerCase() : '');

const formatDateLabel = (isoString) => {
  if (!isoString) {
    return '';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const MyList = () => {
  const [authUser, setAuthUser] = useState(() => getStoredUser());
  const navigate = useNavigate();
  const [lists, setLists] = useState([]);
  const [selectedListId, setSelectedListId] = useState(null);
  const [selectedOwner, setSelectedOwner] = useState('self');
  const [listsLoading, setListsLoading] = useState(Boolean(authUser));
  const [listsError, setListsError] = useState(null);

  const [friendLists, setFriendLists] = useState([]);
  const [friendSearch, setFriendSearch] = useState('');
  const [friendListsLoading, setFriendListsLoading] = useState(false);
  const [friendListsError, setFriendListsError] = useState(null);
  const [friendListsRefreshKey, setFriendListsRefreshKey] = useState(0);
  const [listNavPage, setListNavPage] = useState(1);
  const [friendNavPage, setFriendNavPage] = useState(1);

  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    type: 'movies',
  });
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsForm, setDetailsForm] = useState({ name: '', description: '' });
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [visibilitySaving, setVisibilitySaving] = useState(false);

  const [catalog, setCatalog] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(null);
  const [peopleCatalog, setPeopleCatalog] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [peopleError, setPeopleError] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [pendingItems, setPendingItems] = useState(new Set());
  const [removingItems, setRemovingItems] = useState(new Set());
  const [page, setPage] = useState(1);

  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges(() => {
      setAuthUser(getStoredUser());
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const userId = authUser?._id || authUser?.id || authUser?.username || '';

  useEffect(() => {
    if (!userId) {
      setLists([]);
      setSelectedListId(null);
      setListsLoading(false);
      return;
    }

    let abort = false;
    const loadLists = async () => {
      try {
        setListsLoading(true);
        setListsError(null);
        const res = await fetch(
          buildUsersUrl(`/users/${encodeURIComponent(userId)}/lists`),
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (abort) {
          return;
        }
        const safeLists = Array.isArray(data) ? data : [];
        setLists(safeLists);
        if (selectedOwner === 'self') {
          if (!safeLists.some((entry) => entry.list_id === selectedListId)) {
            setSelectedListId(safeLists[0]?.list_id || null);
          }
        }
      } catch (err) {
        if (!abort) {
          console.error('Failed to load custom lists', err);
          setListsError('Unable to load your custom lists right now.');
        }
      } finally {
        if (!abort) {
          setListsLoading(false);
        }
      }
    };

    loadLists();
    return () => {
      abort = true;
    };
  }, [userId, selectedOwner, selectedListId]);

  useEffect(() => {
    if (selectedOwner !== 'self') {
      return;
    }
    if (!lists.length) {
      if (selectedListId !== null) {
        setSelectedListId(null);
      }
      return;
    }
    if (!selectedListId || !lists.some((entry) => entry.list_id === selectedListId)) {
      setSelectedListId(lists[0]?.list_id || null);
    }
  }, [lists, selectedOwner, selectedListId]);

  useEffect(() => {
    let abort = false;
    const loadCatalog = async () => {
      try {
        setCatalogLoading(true);
        setCatalogError(null);
        const res = await fetch(buildMoviesUrl('/movies-series'));
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!abort) {
          setCatalog(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!abort) {
          console.error('Failed to load catalog', err);
          setCatalogError('Unable to load the library of titles.');
        }
      } finally {
        if (!abort) {
          setCatalogLoading(false);
        }
      }
    };

    loadCatalog();
    return () => {
      abort = true;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let aborted = false;

    const loadPeople = async () => {
      try {
        setPeopleLoading(true);
        setPeopleError(null);
        const endpoint = buildPeopleUrl('/people?limit=400');
        const res = await fetch(endpoint, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const payload = await res.json();
        if (!aborted) {
          const rawEntries = Array.isArray(payload)
            ? payload
            : Array.isArray(payload?.results)
            ? payload.results
            : [];
          const normalized = rawEntries
            .map(normalizePerson)
            .filter((entry) => entry.id);
          setPeopleCatalog(normalized);
        }
      } catch (err) {
        if (!aborted && err.name !== 'AbortError') {
          console.error('Failed to load people catalog', err);
          setPeopleError('Unable to load the cast & crew directory right now.');
        }
      } finally {
        if (!aborted) {
          setPeopleLoading(false);
        }
      }
    };

    loadPeople();

    return () => {
      aborted = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setFriendLists([]);
      setFriendListsLoading(false);
      return;
    }

    const controller = new AbortController();
    let aborted = false;
    (async () => {
      try {
        setFriendListsLoading(true);
        setFriendListsError(null);
        const res = await fetch(
          buildUsersUrl(`/users/${encodeURIComponent(userId)}/friends/lists`),
          { signal: controller.signal },
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!aborted) {
          setFriendLists(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!aborted && err.name !== 'AbortError') {
          console.error('Failed to load friends lists', err);
          setFriendListsError("Unable to load your friends' public lists right now.");
        }
      } finally {
        if (!aborted) {
          setFriendListsLoading(false);
        }
      }
    })();

    return () => {
      aborted = true;
      controller.abort();
    };
  }, [userId, friendListsRefreshKey]);

  const filteredFriends = useMemo(() => {
    const term = friendSearch.trim().toLowerCase();
    if (!term) {
      return friendLists;
    }
    return friendLists.filter((friend) => {
      const name =
        (friend.friend_name ||
          friend.username ||
          friend.friend_id ||
          '')
          .toString()
          .toLowerCase();
      return name.includes(term);
    });
  }, [friendLists, friendSearch]);

  const listNavPageCount = useMemo(() => {
    const total = lists.length;
    return total ? Math.ceil(total / NAV_PAGE_SIZE) : 1;
  }, [lists]);

  const paginatedLists = useMemo(() => {
    if (!lists.length) {
      return [];
    }
    const start = (listNavPage - 1) * NAV_PAGE_SIZE;
    return lists.slice(start, start + NAV_PAGE_SIZE);
  }, [lists, listNavPage]);

  const listNavButtons = useMemo(
    () => buildPageButtons(listNavPage, listNavPageCount),
    [listNavPage, listNavPageCount],
  );

  const listNavSummary = useMemo(() => {
    if (!lists.length) {
      return '';
    }
    const start = (listNavPage - 1) * NAV_PAGE_SIZE + 1;
    const displayed = Math.max(paginatedLists.length, 1);
    const end = Math.min(start + displayed - 1, lists.length);
    return `Showing ${start}-${end} of ${lists.length} lists`;
  }, [lists, listNavPage, paginatedLists.length]);

  const friendNavPageCount = useMemo(() => {
    const total = filteredFriends.length;
    return total ? Math.ceil(total / NAV_PAGE_SIZE) : 1;
  }, [filteredFriends]);

  const paginatedFriends = useMemo(() => {
    if (!filteredFriends.length) {
      return [];
    }
    const start = (friendNavPage - 1) * NAV_PAGE_SIZE;
    return filteredFriends.slice(start, start + NAV_PAGE_SIZE);
  }, [filteredFriends, friendNavPage]);

  const friendNavButtons = useMemo(
    () => buildPageButtons(friendNavPage, friendNavPageCount),
    [friendNavPage, friendNavPageCount],
  );

  const friendNavSummary = useMemo(() => {
    if (!filteredFriends.length) {
      return '';
    }
    const start = (friendNavPage - 1) * NAV_PAGE_SIZE + 1;
    const displayed = Math.max(paginatedFriends.length, 1);
    const end = Math.min(start + displayed - 1, filteredFriends.length);
    return `Showing ${start}-${end} of ${filteredFriends.length} friends`;
  }, [filteredFriends, friendNavPage, paginatedFriends.length]);

  useEffect(() => {
    if (selectedOwner === 'self') {
      return;
    }
    const friend = friendLists.find((entry) => entry.friend_id === selectedOwner);
    if (!friend) {
      setSelectedOwner('self');
      setSelectedListId(lists[0]?.list_id || null);
      return;
    }

    const isVisible = filteredFriends.some(
      (entry) => entry.friend_id === selectedOwner,
    );
    if (!isVisible) {
      setSelectedOwner('self');
      setSelectedListId(lists[0]?.list_id || null);
      return;
    }

    if (
      !selectedListId ||
      !friend.lists.some((entry) => entry.list_id === selectedListId)
    ) {
      setSelectedListId(friend.lists[0]?.list_id || null);
    }
  }, [friendLists, filteredFriends, selectedOwner, selectedListId, lists]);

  useEffect(() => {
    if (selectedOwner !== 'self' && searchTerm) {
      setSearchTerm('');
    }
  }, [selectedOwner, searchTerm]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(lists.length / NAV_PAGE_SIZE));
    if (listNavPage > maxPage) {
      setListNavPage(maxPage);
    }
  }, [lists, listNavPage]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredFriends.length / NAV_PAGE_SIZE));
    if (friendNavPage > maxPage) {
      setFriendNavPage(maxPage);
    }
  }, [filteredFriends, friendNavPage]);

  useEffect(() => {
    if (selectedOwner !== 'self' || !selectedListId) {
      return;
    }
    const index = lists.findIndex((entry) => entry.list_id === selectedListId);
    if (index === -1) {
      return;
    }
    const targetPage = Math.floor(index / NAV_PAGE_SIZE) + 1;
    if (targetPage !== listNavPage) {
      setListNavPage(targetPage);
    }
  }, [selectedOwner, selectedListId, lists, listNavPage]);

  useEffect(() => {
    if (selectedOwner === 'self') {
      return;
    }
    const index = filteredFriends.findIndex(
      (entry) => entry.friend_id === selectedOwner,
    );
    if (index === -1) {
      return;
    }
    const targetPage = Math.floor(index / NAV_PAGE_SIZE) + 1;
    if (targetPage !== friendNavPage) {
      setFriendNavPage(targetPage);
    }
  }, [selectedOwner, filteredFriends, friendNavPage]);

  useEffect(() => {
    setFriendNavPage(1);
  }, [friendSearch]);

const catalogById = useMemo(() => {
  const map = new Map();
  catalog.forEach((entry) => {
    const id = resolveMovieId(entry);
    if (id) {
      map.set(id, entry);
    }
  });
  return map;
}, [catalog]);

  const peopleById = useMemo(() => {
    const map = new Map();
    peopleCatalog.forEach((entry) => {
      if (entry.id) {
        map.set(entry.id, entry);
      }
    });
    return map;
  }, [peopleCatalog]);

  const selectedFriend = useMemo(
    () =>
      selectedOwner === 'self'
        ? null
        : friendLists.find((entry) => entry.friend_id === selectedOwner) || null,
    [selectedOwner, friendLists],
  );

  const selectedList = useMemo(() => {
    if (selectedOwner === 'self') {
      return lists.find((entry) => entry.list_id === selectedListId) || null;
    }
    const friend = friendLists.find((entry) => entry.friend_id === selectedOwner);
    if (!friend) {
      return null;
    }
    return friend.lists.find((entry) => entry.list_id === selectedListId) || null;
  }, [selectedOwner, lists, selectedListId, friendLists]);

  const selectedListType = (selectedList?.type || 'movies').toLowerCase();
  const selectedListNoun = selectedListType === 'people' ? 'people' : 'titles';
  const searchLabel =
    selectedListType === 'people' ? 'Add cast & crew' : 'Add movies or series';
  const searchPlaceholder =
    selectedListType === 'people' ? 'Search by name or profession...' : 'Search the catalog...';
  const searchSourceLoading = selectedListType === 'people' ? peopleLoading : catalogLoading;
  const searchSourceError = selectedListType === 'people' ? peopleError : catalogError;

  const canModifySelectedList = selectedOwner === 'self' && Boolean(selectedList);
  const selectedFriendName =
    selectedFriend?.friend_name ||
    selectedFriend?.username ||
    selectedFriend?.friend_id ||
    '';
  const selectedFriendProfileIdRaw =
    selectedFriend?.friend_id ||
    selectedFriend?.username ||
    '';
  const selectedFriendProfileId = selectedFriendProfileIdRaw
    ? String(selectedFriendProfileIdRaw).trim()
    : '';
  const visibilityText = selectedList
    ? selectedList.is_public
      ? 'Public list'
      : 'Private list'
    : '';
  const visibilityClass = selectedList?.is_public
    ? 'mylist-detail__visibility mylist-detail__visibility--public'
    : 'mylist-detail__visibility mylist-detail__visibility--private';

  useEffect(() => {
    if (selectedOwner === 'self' && selectedList && !editingDetails) {
      setDetailsForm({
        name: selectedList.name || '',
        description: selectedList.description || '',
      });
    }
    setPage(1);
  }, [selectedOwner, selectedList, editingDetails]);

  const selectedItems = useMemo(() => {
    const items = Array.isArray(selectedList?.items) ? selectedList.items : [];
    const listType = (selectedList?.type || 'movies').toLowerCase();
    return items
      .map((item) => {
        const explicitId =
          listType === 'people'
            ? item.person_id || item.personId
            : item.movie_id || item.movieId;
        const fallbackId =
          listType === 'people' ? resolvePersonId(item) : resolveMovieId(item);
        const entityId = explicitId
          ? String(explicitId).trim()
          : fallbackId
          ? String(fallbackId).trim()
          : '';
        if (!entityId) {
          return null;
        }
        const meta =
          listType === 'people'
            ? peopleById.get(entityId) || null
            : catalogById.get(entityId) || null;
        return {
          ...item,
          entityId,
          meta,
          listType,
        };
      })
      .filter(Boolean);
  }, [selectedList, catalogById, peopleById]);

  const totalPages = useMemo(() => {
    const count = selectedItems.length;
    if (count === 0) {
      return 1;
    }
    return Math.ceil(count / PAGE_SIZE);
  }, [selectedItems]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const paginatedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return selectedItems.slice(start, start + PAGE_SIZE);
  }, [selectedItems, page]);

  const pageButtons = useMemo(
    () => buildPageButtons(page, totalPages),
    [page, totalPages],
  );

  const pageSummary = useMemo(() => {
    const total = selectedItems.length;
    if (!total) {
      return '';
    }
    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(start + paginatedItems.length - 1, total);
    const base = `Showing ${start}-${end} of ${total} ${selectedListNoun}`;
    return totalPages > 1 ? `${base} (page ${page} of ${totalPages})` : base;
  }, [selectedItems.length, paginatedItems.length, page, totalPages, selectedListNoun]);

  const selectedItemIds = useMemo(() => {
    const ids = new Set();
    selectedItems.forEach((item) => {
      if (item.entityId) {
        ids.add(item.entityId);
      }
    });
    return ids;
  }, [selectedItems]);

  const searchResults = useMemo(() => {
    const rawTerm = searchTerm.trim();
    if (!rawTerm) {
      return [];
    }
    const term = toLower(rawTerm);
    const listType = (selectedList?.type || 'movies').toLowerCase();

    if (listType === 'people') {
      return peopleCatalog
        .filter((entry) => {
          if (!entry.id || selectedItemIds.has(entry.id)) {
            return false;
          }
          const name = toLower(entry.name);
          const profession = toLower(entry.primaryProfession || '');
          return name.includes(term) || profession.includes(term);
        })
        .slice(0, 8)
        .map((entry) => ({
          id: entry.id,
          label: entry.name,
          subtitle: entry.primaryProfession || 'Cast & Crew',
          meta: entry,
          type: 'people',
        }));
    }

    return catalog
      .filter((entry) => {
        const id = resolveMovieId(entry);
        if (!id || selectedItemIds.has(id)) {
          return false;
        }
        const title = toLower(entry.title);
        const altTitle = toLower(entry.primaryTitle);
        return title.includes(term) || altTitle.includes(term);
      })
      .slice(0, 8)
      .map((entry) => {
        const id = resolveMovieId(entry);
        const year =
          entry.year ||
          entry.release_year ||
          (entry.release_date ? String(entry.release_date).slice(0, 4) : null);
        const typeLabel = entry.imdb_type || entry.type || 'Title';
        return {
          id,
          label: entry.title || entry.primaryTitle || 'Untitled',
          subtitle: [year, typeLabel].filter(Boolean).join(' | '),
          meta: entry,
          type: 'movies',
        };
      });
  }, [catalog, peopleCatalog, searchTerm, selectedItemIds, selectedList]);

  const handleSubmitCreate = async (event) => {
    event.preventDefault();
    if (!userId) {
      setCreateError('Please sign in to create a list.');
      return;
    }
    const trimmedName = createForm.name.trim();
    if (!trimmedName) {
      setCreateError('Give your list a name.');
      return;
    }
    try {
      setCreating(true);
      setCreateError('');
      const res = await fetch(
        buildUsersUrl(`/users/${encodeURIComponent(userId)}/lists`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmedName,
            description: createForm.description.trim(),
            type: createForm.type,
          }),
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || 'Unable to create the list.');
      }
      const data = await res.json();
      setLists((prev) => [...prev, data]);
      setSelectedListId(data.list_id);
      setCreateForm((prev) => ({
        name: '',
        description: '',
        type: prev.type,
      }));
    } catch (err) {
      console.error('Create list failed', err);
      setCreateError(err.message || 'Unable to create the list.');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteList = async (listId) => {
    if (!userId || !listId || selectedOwner !== 'self') {
      return;
    }
    const confirmed = window.confirm(
      'Are you sure you want to delete this list?',
    );
    if (!confirmed) {
      return;
    }
    try {
      const res = await fetch(
        buildUsersUrl(
          `/users/${encodeURIComponent(userId)}/lists/${encodeURIComponent(listId)}`,
        ),
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || 'Unable to delete the list.');
      }
      setLists((prev) => prev.filter((entry) => entry.list_id !== listId));
      setFriendListsRefreshKey((prev) => prev + 1);
      if (selectedListId === listId) {
        const remaining = lists.filter((entry) => entry.list_id !== listId);
        setSelectedListId(remaining[0]?.list_id || null);
      }
    } catch (err) {
      console.error('Delete list failed', err);
      setDetailsError(err.message || 'Unable to delete the list.');
    }
  };

  const handleStartEdit = () => {
    if (!canModifySelectedList) {
      return;
    }
    setDetailsForm({
      name: selectedList.name || '',
      description: selectedList.description || '',
    });
    setDetailsError('');
    setEditingDetails(true);
  };

  const handleCancelEdit = () => {
    setEditingDetails(false);
    setDetailsError('');
    if (selectedList && selectedOwner === 'self') {
      setDetailsForm({
        name: selectedList.name || '',
        description: selectedList.description || '',
      });
    }
  };

  const handleSubmitDetails = async (event) => {
    event.preventDefault();
    if (!userId || !selectedList || !canModifySelectedList) {
      return;
    }
    const name = detailsForm.name.trim();
    if (!name) {
      setDetailsError('List name cannot be empty.');
      return;
    }
    try {
      setDetailsSaving(true);
      setDetailsError('');
      const res = await fetch(
        buildUsersUrl(
          `/users/${encodeURIComponent(userId)}/lists/${encodeURIComponent(selectedList.list_id)}`,
        ),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            description: detailsForm.description.trim(),
          }),
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || 'Unable to update the list.');
      }
      const data = await res.json();
      setLists((prev) =>
        prev.map((entry) =>
          entry.list_id === data.list_id ? data : entry,
        ),
      );
      setEditingDetails(false);
    } catch (err) {
      console.error('Update list failed', err);
      setDetailsError(err.message || 'Unable to update the list.');
    } finally {
      setDetailsSaving(false);
    }
  };

  const mutateItemsSet = (setState, mutator) => {
    setState((prev) => {
      const next = new Set(prev);
      mutator(next);
      return next;
    });
  };

  const handleAddItem = async (entityId) => {
    if (!entityId || !selectedList || !userId || !canModifySelectedList) {
      return;
    }
    const listType = (selectedList.type || 'movies').toLowerCase();
    const normalizedId = String(entityId).trim();
    if (!normalizedId) {
      return;
    }
    mutateItemsSet(setPendingItems, (set) => set.add(normalizedId));
    try {
      const res = await fetch(
        buildUsersUrl(
          `/users/${encodeURIComponent(userId)}/lists/${encodeURIComponent(selectedList.list_id)}/items`,
        ),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            listType === 'people'
              ? { person_id: normalizedId }
              : { movie_id: normalizedId },
          ),
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || 'Unable to add the selected entry to the list.');
      }
      const data = await res.json();
      setLists((prev) =>
        prev.map((entry) =>
          entry.list_id === data.list_id ? data : entry,
        ),
      );
      setSearchTerm('');
    } catch (err) {
      console.error('Add item failed', err);
      setDetailsError(err.message || 'Unable to add the selected entry.');
    } finally {
      mutateItemsSet(setPendingItems, (set) => set.delete(normalizedId));
    }
  };

  const handleOpenDetail = (entityId, typeOverride) => {
    const normalizedId = entityId ? String(entityId).trim() : '';
    if (!normalizedId) {
      return;
    }
    const listType = (typeOverride || selectedList?.type || 'movies').toLowerCase();
    if (listType === 'people') {
      navigate(`/people/${encodeURIComponent(normalizedId)}`);
    } else {
      navigate(`/movies-series/${encodeURIComponent(normalizedId)}`);
    }
  };

  const handleRemoveItem = async (entityId) => {
    if (!entityId || !selectedList || !userId || !canModifySelectedList) {
      return;
    }
    const normalizedId = String(entityId).trim();
    if (!normalizedId) {
      return;
    }
    mutateItemsSet(setRemovingItems, (set) => set.add(normalizedId));
    try {
      const res = await fetch(
        buildUsersUrl(
          `/users/${encodeURIComponent(userId)}/lists/${encodeURIComponent(selectedList.list_id)}/items/${encodeURIComponent(normalizedId)}`,
        ),
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || 'Unable to remove the selected entry.');
      }
      const data = await res.json();
      setLists((prev) =>
        prev.map((entry) =>
          entry.list_id === data.list_id ? data : entry,
        ),
      );
    } catch (err) {
      console.error('Remove item failed', err);
      setDetailsError(err.message || 'Unable to remove the selected entry.');
    } finally {
      mutateItemsSet(setRemovingItems, (set) => set.delete(normalizedId));
    }
  };

  const handleToggleVisibility = async () => {
    if (!userId || !selectedList || !canModifySelectedList) {
      return;
    }
    const nextVisibility = !Boolean(selectedList.is_public);
    try {
      setVisibilitySaving(true);
      setDetailsError('');
      const res = await fetch(
        buildUsersUrl(
          `/users/${encodeURIComponent(userId)}/lists/${encodeURIComponent(selectedList.list_id)}`,
        ),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_public: nextVisibility }),
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || 'Unable to update the visibility.');
      }
      const data = await res.json();
      setLists((prev) =>
        prev.map((entry) =>
          entry.list_id === data.list_id ? data : entry,
        ),
      );
      setFriendListsRefreshKey((prev) => prev + 1);
    } catch (err) {
      console.error('Toggle visibility failed', err);
      setDetailsError(err.message || 'Unable to change the list visibility.');
    } finally {
      setVisibilitySaving(false);
    }
  };

  if (!authUser) {
    return <Navigate to="/login" replace />;
  }

  return (
    <section className="mylist">
      <header className="mylist__header">
        <div>
          <h1>My Custom Lists</h1>
          <p>Create and manage your own lists of movies, series, cast, and crew.</p>
        </div>
        {catalogLoading ? (
          <span className="mylist__status">Loading library...</span>
        ) : catalogError ? (
          <span className="mylist__status mylist__status--error">
            {catalogError}
          </span>
        ) : null}
      </header>

      <div className="mylist__layout">
        <aside className="mylist__sidebar" aria-label="Your lists">
          <form className="mylist-create" onSubmit={handleSubmitCreate}>
            <h2>Create a new list</h2>
            <div className="mylist-create__types" role="group" aria-label="List type">
              <button
                type="button"
                className={`mylist-create__type-btn${
                  createForm.type === 'movies' ? ' mylist-create__type-btn--active' : ''
                }`}
                onClick={() =>
                  setCreateForm((prev) => ({
                    ...prev,
                    type: 'movies',
                  }))
                }
                disabled={creating}
              >
                Movies &amp; Series
              </button>
              <button
                type="button"
                className={`mylist-create__type-btn${
                  createForm.type === 'people' ? ' mylist-create__type-btn--active' : ''
                }`}
                onClick={() =>
                  setCreateForm((prev) => ({
                    ...prev,
                    type: 'people',
                  }))
                }
                disabled={creating}
              >
                Cast &amp; Crew
              </button>
            </div>
            <label className="mylist-create__field">
              <span>Name</span>
              <input
                type="text"
                value={createForm.name}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                placeholder="e.g. Cozy Christmas Movies"
                disabled={creating}
                required
              />
            </label>
            <label className="mylist-create__field">
              <span>Description</span>
              <textarea
                rows={2}
                value={createForm.description}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder="Optional - add a note about this list"
                disabled={creating}
              />
            </label>
            {createError ? (
              <p className="mylist-create__error">{createError}</p>
            ) : null}
            <button
              className="mylist-create__submit"
              type="submit"
              disabled={creating}
            >
              {creating ? 'Creating...' : 'Create list'}
            </button>
          </form>

          <div className="mylist-nav">
            <h2>Your lists</h2>
            {listsLoading ? (
              <p className="mylist-nav__status">Loading lists...</p>
            ) : listsError ? (
              <p className="mylist-nav__status mylist-nav__status--error">
                {listsError}
              </p>
            ) : lists.length === 0 ? (
              <p className="mylist-nav__status">
                You haven&apos;t created any custom lists yet.
              </p>
            ) : (
              <>
                <ul>
                  {paginatedLists.map((entry) => (
                    <li key={entry.list_id}>
                      <button
                        type="button"
                        className={`mylist-nav__item${
                          selectedOwner === 'self' && entry.list_id === selectedListId
                            ? ' mylist-nav__item--active'
                            : ''
                        }`}
                        onClick={() => {
                          setSelectedOwner('self');
                          setSelectedListId(entry.list_id);
                          setEditingDetails(false);
                          setDetailsError('');
                          setPage(1);
                        }}
                      >
                        <span className="mylist-nav__item-title">
                          {entry.name || 'Untitled list'}
                        </span>
                        <span className="mylist-nav__item-count">
                          {(entry.items || []).length} titles
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div
                  className="mylist-pagination mylist-pagination--compact"
                  aria-label="Your lists pagination controls"
                >
                  <div
                    className="mylist-pagination__pager"
                    role="group"
                    aria-label="Select list page"
                  >
                    <button
                      type="button"
                      className="mylist-pagination__button"
                      onClick={() => setListNavPage((prev) => Math.max(1, prev - 1))}
                      disabled={listNavPage <= 1}
                    >
                      Prev
                    </button>
                    {listNavButtons.map((entry) => {
                      if (entry.type === 'ellipsis') {
                        return (
                          <span
                            key={entry.key}
                            className="mylist-pagination__ellipsis"
                            aria-hidden="true"
                          >
                            &hellip;
                          </span>
                        );
                      }
                      const pageNumber = entry.value;
                      return (
                        <button
                          key={`your-lists-${pageNumber}`}
                          type="button"
                          className={`mylist-pagination__button ${
                            pageNumber === listNavPage ? 'mylist-pagination__button--active' : ''
                          }`}
                          onClick={() => setListNavPage(pageNumber)}
                          aria-current={pageNumber === listNavPage ? 'page' : undefined}
                        >
                          {pageNumber}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="mylist-pagination__button"
                      onClick={() =>
                        setListNavPage((prev) => Math.min(listNavPageCount, prev + 1))
                      }
                      disabled={listNavPage >= listNavPageCount}
                    >
                      Next
                    </button>
                  </div>
                  <p className="mylist-pagination__summary">
                    {listNavSummary || `Page ${listNavPage} of ${listNavPageCount}`}
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="mylist-friends">
            <h2>Friends' public lists</h2>
            <label className="mylist-friends__search" htmlFor="mylist-friend-search">
              <span>Search a friend</span>
              <input
                id="mylist-friend-search"
                type="search"
                value={friendSearch}
                placeholder="Filter by friend name"
                onChange={(event) => setFriendSearch(event.target.value)}
                disabled={friendListsLoading}
              />
            </label>
            {friendListsLoading ? (
              <p className="mylist-friends__status">Loading friends' lists...</p>
            ) : friendListsError ? (
              <p className="mylist-friends__status mylist-friends__status--error">
                {friendListsError}
              </p>
            ) : friendLists.length === 0 ? (
              <p className="mylist-friends__status">
                None of your friends have shared public lists yet.
              </p>
            ) : filteredFriends.length === 0 ? (
              <p className="mylist-friends__status">
                No friends match your search.
              </p>
            ) : (
              <>
                <ul className="mylist-friends__list">
                  {paginatedFriends.map((friend) => {
                    const friendName =
                      friend.friend_name || friend.username || friend.friend_id;
                    return (
                      <li key={friend.friend_id} className="mylist-friends__friend">
                        <div className="mylist-friends__friend-header">
                          <span className="mylist-friends__friend-name">{friendName}</span>
                          <span className="mylist-friends__friend-count">
                            {friend.lists.length} list{friend.lists.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <ul className="mylist-friends__lists">
                          {friend.lists.map((list) => {
                            const isActive =
                              selectedOwner === friend.friend_id &&
                              selectedListId === list.list_id;
                            return (
                              <li key={`${friend.friend_id}-${list.list_id}`}>
                                <button
                                  type="button"
                                  className={`mylist-friends__item${
                                    isActive ? ' mylist-friends__item--active' : ''
                                  }`}
                                  onClick={() => {
                                    setSelectedOwner(friend.friend_id);
                                    setSelectedListId(list.list_id);
                                    setEditingDetails(false);
                                    setDetailsError('');
                                    setPage(1);
                                  }}
                                >
                                  <span className="mylist-friends__item-title">
                                    {list.name || 'Untitled list'}
                                  </span>
                                  <span className="mylist-friends__item-count">
                                    {(list.items || []).length} titles
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
                <div
                  className="mylist-pagination mylist-pagination--compact"
                  aria-label="Friends pagination controls"
                >
                  <div
                    className="mylist-pagination__pager"
                    role="group"
                    aria-label="Select friend page"
                  >
                    <button
                      type="button"
                      className="mylist-pagination__button"
                      onClick={() => setFriendNavPage((prev) => Math.max(1, prev - 1))}
                      disabled={friendNavPage <= 1}
                    >
                      Prev
                    </button>
                    {friendNavButtons.map((entry) => {
                      if (entry.type === 'ellipsis') {
                        return (
                          <span
                            key={entry.key}
                            className="mylist-pagination__ellipsis"
                            aria-hidden="true"
                          >
                            &hellip;
                          </span>
                        );
                      }
                      const pageNumber = entry.value;
                      return (
                        <button
                          key={`friend-lists-${pageNumber}`}
                          type="button"
                          className={`mylist-pagination__button ${
                            pageNumber === friendNavPage
                              ? 'mylist-pagination__button--active'
                              : ''
                          }`}
                          onClick={() => setFriendNavPage(pageNumber)}
                          aria-current={pageNumber === friendNavPage ? 'page' : undefined}
                        >
                          {pageNumber}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="mylist-pagination__button"
                      onClick={() =>
                        setFriendNavPage((prev) =>
                          Math.min(friendNavPageCount, prev + 1),
                        )
                      }
                      disabled={friendNavPage >= friendNavPageCount}
                    >
                      Next
                    </button>
                  </div>
                  <p className="mylist-pagination__summary">
                    {friendNavSummary || `Page ${friendNavPage} of ${friendNavPageCount}`}
                  </p>
                </div>
              </>
            )}
          </div>
        </aside>

        <section className="mylist__content" aria-live="polite">
          {!selectedList ? (
            <div className="mylist-placeholder">
              <h2>Select a list to get started</h2>
              <p>
                Pick one of your collections or create a new list on the left
                to curate your favourite titles.
              </p>
            </div>
          ) : (
            <div className="mylist-detail">
              <header className="mylist-detail__header">
                {editingDetails && canModifySelectedList ? (
                  <form
                    className="mylist-detail__form"
                    onSubmit={handleSubmitDetails}
                  >
                    <label>
                      <span>Name</span>
                      <input
                        type="text"
                        value={detailsForm.name}
                        onChange={(event) =>
                          setDetailsForm((prev) => ({
                            ...prev,
                            name: event.target.value,
                          }))
                        }
                        disabled={detailsSaving}
                        required
                      />
                    </label>
                    <label>
                      <span>Description</span>
                      <textarea
                        rows={2}
                        value={detailsForm.description}
                        onChange={(event) =>
                          setDetailsForm((prev) => ({
                            ...prev,
                            description: event.target.value,
                          }))
                        }
                        disabled={detailsSaving}
                      />
                    </label>
                    {detailsError ? (
                      <p className="mylist-detail__error">{detailsError}</p>
                    ) : null}
                    <div className="mylist-detail__buttons">
                      <button
                        type="button"
                        className="mylist-detail__button mylist-detail__button--ghost"
                        onClick={handleCancelEdit}
                        disabled={detailsSaving}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="mylist-detail__button"
                        disabled={detailsSaving}
                      >
                        {detailsSaving ? 'Saving...' : 'Save details'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div>
                      <h2>{selectedList.name || 'Untitled list'}</h2>
                      {selectedOwner !== 'self' && selectedFriendName ? (
                        <p className="mylist-detail__note">
                          Shared by {selectedFriendName}
                        </p>
                      ) : null}
                      {selectedList.description ? (
                        <p>{selectedList.description}</p>
                      ) : null}
                      <p className="mylist-detail__meta">
                        Created {formatDateLabel(selectedList.created_at)}
                        {' | '}
                        Updated {formatDateLabel(selectedList.updated_at)}
                        {' | '}
                        {selectedItems.length} {selectedListNoun}
                      </p>
                      {visibilityText ? (
                        <p className={visibilityClass}>{visibilityText}</p>
                      ) : null}
                    </div>
                    <div className="mylist-detail__actions">
                      {detailsError ? (
                        <p className="mylist-detail__error">{detailsError}</p>
                      ) : null}
                      {canModifySelectedList ? (
                        <>
                          <button
                            type="button"
                            className="mylist-detail__button mylist-detail__button--ghost"
                            onClick={handleToggleVisibility}
                            disabled={visibilitySaving}
                          >
                            {visibilitySaving
                              ? 'Updating...'
                              : selectedList.is_public
                              ? 'Make private'
                              : 'Make public'}
                          </button>
                          <button
                            type="button"
                            className="mylist-detail__button"
                            onClick={handleStartEdit}
                          >
                            Edit details
                          </button>
                          <button
                            type="button"
                            className="mylist-detail__button mylist-detail__button--danger"
                            onClick={() => handleDeleteList(selectedList.list_id)}
                          >
                            Delete list
                          </button>
                        </>
                      ) : (
                        <div className="mylist-detail__read-only-group">
                          <p className="mylist-detail__read-only">
                            {selectedFriendName
                              ? `Viewing ${selectedFriendName}'s public list.`
                              : 'Viewing a public friend list.'}
                          </p>
                          {selectedFriendProfileId ? (
                            <button
                              type="button"
                              className="mylist-detail__button mylist-detail__button--ghost mylist-detail__button--profile"
                              onClick={() =>
                                navigate(
                                  `/profile?user_id=${encodeURIComponent(selectedFriendProfileId)}`,
                                )
                              }
                            >
                              View friend's profile
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </header>

              <div className="mylist-search">
                {canModifySelectedList ? (
                  <>
                    <label htmlFor="mylist-search-input">
                      {searchLabel}
                    </label>
                    <input
                      id="mylist-search-input"
                      type="search"
                      value={searchTerm}
                      placeholder={searchPlaceholder}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      disabled={searchSourceLoading || !selectedList}
                    />
                    {searchSourceLoading ? (
                      <p className="mylist-search__status">Loading {selectedListNoun}...</p>
                    ) : null}
                    {!searchSourceLoading && searchSourceError ? (
                      <p className="mylist-search__status mylist-search__status--error">
                        Unable to load the {selectedListType === 'people'
                          ? 'cast & crew catalog right now.'
                          : 'catalog of titles right now.'}
                      </p>
                    ) : null}
                    {searchTerm && !searchSourceLoading && searchResults.length === 0 ? (
                      <p className="mylist-search__status">
                        No {selectedListNoun} match your search or they are already in the list.
                      </p>
                    ) : null}
                    {searchResults.length > 0 ? (
                      <ul className="mylist-search__results">
                        {searchResults.map((entry) => {
                          const rawId = entry?.id != null ? String(entry.id) : '';
                          const id = rawId.trim();
                          if (!id) {
                            return null;
                          }
                          const isPending = pendingItems.has(id);
                          return (
                            <li key={id}>
                              <div className="mylist-search__result">
                                <div className="mylist-search__result-meta">
                                  <strong>{entry.label}</strong>
                                  {entry.subtitle ? <span>{entry.subtitle}</span> : null}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleAddItem(id)}
                                  disabled={isPending}
                                >
                                  {isPending ? 'Adding...' : 'Add'}
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <p className="mylist-search__status mylist-search__status--info">

                  </p>
                )}
              </div>

              <div className="mylist-grid">
                {selectedItems.length === 0 ? (
                  <p className="mylist-grid__empty">
                    Your list is empty for now. Use the search above to start
                    adding {selectedListNoun}.
                  </p>
                ) : (
                  paginatedItems.map((item) => {
                    const listType = (item.listType || selectedListType || 'movies').toLowerCase();
                    const entityCandidate =
                      item.entityId ||
                      (listType === 'people' ? resolvePersonId(item) : resolveMovieId(item));
                    const id = entityCandidate ? String(entityCandidate).trim() : '';
                    if (!id) {
                      return null;
                    }
                    const meta = item.meta || {};
                    const isRemoving = removingItems.has(id);

                    let titleText = '';
                    let thumbSrc = '';
                    let thumbAlt = '';
                    let detailParts = [];

                    if (listType === 'people') {
                      const raw = meta.raw || {};
                      titleText = meta.name || item.name || raw?.name || 'Unknown talent';
                      const profession =
                        meta.primaryProfession ||
                        item.primary_profession ||
                        item.primaryProfession ||
                        (Array.isArray(raw?.primary_profession)
                          ? raw.primary_profession.filter(Boolean).join(', ')
                          : raw?.primary_profession || raw?.primaryProfession);
                      detailParts = profession ? [profession] : [];
                      thumbSrc =
                        meta.photoUrl ||
                        raw?.photo_url ||
                        raw?.image_url ||
                        raw?.photoUrl ||
                        raw?.imageUrl ||
                        FALLBACK_PROFILE;
                      thumbAlt = titleText ? `Portrait of ${titleText}` : 'Profile unavailable';
                    } else {
                      const typeRaw = meta.imdb_type || meta.type || '';
                      const typeLabel = typeRaw ? String(typeRaw) : 'Title';
                      const lowerType = String(typeRaw).toLowerCase();
                      const isSeries =
                        lowerType.includes('series') || lowerType.startsWith('tv');
                      const yearLabel =
                        meta.year ||
                        meta.release_year ||
                        (meta.release_date ? String(meta.release_date).slice(0, 4) : null) ||
                        null;
                      const runtimeLabel =
                        formatRuntime(
                          meta.duration ||
                            meta.runtimeMinutes ||
                            meta.runtime ||
                            meta.running_time ||
                            meta.length_minutes,
                        ) || null;
                      const seasonsLabel = isSeries
                        ? formatSeasons(
                            meta.series_total_seasons ||
                              meta.total_seasons ||
                              meta.totalSeasons ||
                              meta.seasons,
                          )
                        : null;
                      detailParts = [
                        yearLabel,
                        typeLabel,
                        isSeries ? seasonsLabel : runtimeLabel,
                      ].filter(Boolean);
                      titleText = meta.title || meta.primaryTitle || item.title || 'Untitled';
                      thumbSrc =
                        meta.poster_url ||
                        meta.posterUrl ||
                        meta.cover_url ||
                        meta.image_url ||
                        FALLBACK_POSTER;
                      thumbAlt = meta.title
                        ? `Poster for ${meta.title}`
                        : titleText !== 'Untitled'
                        ? `Poster for ${titleText}`
                        : 'Poster unavailable';
                    }
                    return (
                      <article
                        key={id}
                        className={`mylist-card${listType === 'people' ? ' mylist-card--people' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleOpenDetail(id, listType)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleOpenDetail(id, listType);
                          }
                        }}
                      >
                        <div className="mylist-card__thumb">
                          <img
                            src={thumbSrc || (listType === 'people' ? FALLBACK_PROFILE : FALLBACK_POSTER)}
                            alt={thumbAlt}
                            loading="lazy"
                          />
                        </div>
                        <div className="mylist-card__body">
                          <h3>{titleText}</h3>
                        </div>
                        <div className="mylist-card__footer">
                          <p className="mylist-card__added">
                            Added {formatDateLabel(item.added_at)}
                          </p>
                          {detailParts.length ? (
                            <p className="mylist-card__meta">
                              {detailParts.join(' | ')}
                            </p>
                          ) : null}
                          {canModifySelectedList ? (
                            <button
                              type="button"
                              className="mylist-card__remove"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleRemoveItem(id);
                              }}
                              disabled={isRemoving}
                            >
                              {isRemoving ? 'Removing...' : 'Remove'}
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>

              <div className="mylist-pagination" aria-label="Pagination controls">
                <div className="mylist-pagination__pager" role="group" aria-label="Select page">
                  <button
                    type="button"
                    className="mylist-pagination__button"
                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    disabled={page <= 1}
                  >
                    Prev
                  </button>
                  {pageButtons.map((entry) => {
                    if (entry.type === 'ellipsis') {
                      return (
                        <span
                          key={entry.key}
                          className="mylist-pagination__ellipsis"
                          aria-hidden="true"
                        >
                          &hellip;
                        </span>
                      );
                    }

                    const pageNumber = entry.value;
                    return (
                      <button
                        key={pageNumber}
                        type="button"
                        className={`mylist-pagination__button ${
                          pageNumber === page ? 'mylist-pagination__button--active' : ''
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
                    className="mylist-pagination__button"
                    onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={page >= totalPages}
                  >
                    Next
                  </button>
                </div>
                <p className="mylist-pagination__summary">
                  {pageSummary || `Page ${page} of ${totalPages}`}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </section>
  );
};

export default MyList;
