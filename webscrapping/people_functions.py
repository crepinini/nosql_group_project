# person_functions.py
import json
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from threading import Lock

import requests
from bs4 import BeautifulSoup

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/117.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36",
]

REQUEST_DELAY_RANGE = (1.5, 3.0)
REQUEST_COOLDOWN_EVERY = 40
REQUEST_COOLDOWN_RANGE = (8.0, 15.0)


PEOPLE_SAVE_BATCH_SIZE = 15
PEOPLE_PROGRESS_DELAY_RANGE = (1.1, 2.2)

people_persist_lock = Lock()
people_first_item = True
title_cache_lock = Lock()

request_lock = Lock()
last_request_ts = 0.0
request_counter = 0


def polite_request_pause():
    """
    Serialize outbound requests and space them out to avoid server throttling.
    """
    global last_request_ts, request_counter

    with request_lock:
        min_delay = random.uniform(*REQUEST_DELAY_RANGE)
        now = time.perf_counter()
        wait_seconds = max(0.0, min_delay - (now - last_request_ts))

    if wait_seconds > 0:
        time.sleep(wait_seconds)

    cooldown = None
    with request_lock:
        last_request_ts = time.perf_counter()
        request_counter += 1
        if request_counter % REQUEST_COOLDOWN_EVERY == 0:
            cooldown = random.uniform(*REQUEST_COOLDOWN_RANGE)

    if cooldown:
        time.sleep(cooldown)


def soup(url: str):
    """
    Retrieve and parse an IMDb page into BeautifulSoup.

    Args:
        url: Absolute IMDb URL to fetch.

    Returns:
        Parsed BeautifulSoup tree for the requested page.
    """
    for attempt in range(5):
        polite_request_pause()
        headers = {
            "User-Agent": random.choice(USER_AGENTS),
            "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Connection": "keep-alive",
            "DNT": "1",
            "Upgrade-Insecure-Requests": "1",
            "Referer": "https://www.imdb.com/",
        }

        response = requests.get(url, headers=headers, timeout=20)
        html = response.text

        if response.status_code in (429, 503) or "captcha" in html.lower():
            backoff = random.uniform(15, 30) * (attempt + 1)
            print(f"[!] IMDb rate limit encountered for {url}. Backing off for {backoff:.1f} seconds.")
            time.sleep(backoff)
            continue

        if response.status_code == 403 or "Request blocked" in html:
            backoff = random.uniform(120, 180)
            print(f"[!] IMDb blocked access for {url}. Cooling down for {backoff:.1f} seconds.")
            time.sleep(backoff)
            continue

        if response.ok and len(html.strip()) > 500:
            return BeautifulSoup(html, "html.parser")

        print(f"[!] Empty or invalid content for {url} (status {response.status_code}). Retrying...")
        time.sleep(random.uniform(8, 16))

    raise RuntimeError(f"Failed to fetch valid content from IMDb for {url}")


def dedup_people(people: list):
    """
    Remove duplicate people entries while preserving order.

    Args:
        people: Iterable of person dictionaries to deduplicate.

    Returns:
        List of unique person dictionaries.
    """
    seen = set()
    result = []
    for person in people:
        key = person.get("imdb_name_id") or person.get("name")
        if key and key not in seen:
            result.append(person)
            seen.add(key)
    return result


def people_from_credit_block(soup_obj, label_regex: str):
    """
    Extract people listed under a principal credits block of an IMDb title page.

    Args:
        soup_obj: Parsed title page content.
        label_regex: Regex used to match the credit label (director, writer, etc.).

    Returns:
        List of unique person dictionaries extracted from the block.
    """
    people = []
    for li in soup_obj.find_all("li", {"data-testid": "title-pc-principal-credit"}):
        text = li.get_text(" ", strip=True)
        if not re.search(label_regex, text, re.I):
            continue
        for anchor in li.find_all("a", href=True):
            if "/name/" not in anchor["href"]:
                continue
            name = anchor.get_text(strip=True)
            match = re.search(r"/name/(nm\d+)/", anchor["href"])
            if name and match:
                nm_id = match.group(1)
                people.append({"name": name, "imdb_name_id": nm_id, "url": f"https://www.imdb.com/name/{nm_id}/"})
    return dedup_people(people)


def main_actors_from_cast(soup_obj):
    """
    Extract actors from the cast list of an IMDb title page.

    Args:
        soup_obj: Parsed title page content.

    Returns:
        List of unique person dictionaries for the cast.
    """
    people = []
    for anchor in soup_obj.find_all("a", {"data-testid": "title-cast-item__actor"}, href=True):
        name = anchor.get_text(strip=True)
        match = re.search(r"/name/(nm\d+)/", anchor["href"])
        if name and match:
            nm_id = match.group(1)
            people.append({"name": name, "imdb_name_id": nm_id, "url": f"https://www.imdb.com/name/{nm_id}/"})
    return dedup_people(people)


def fetch_people_for_title(tt_id: str):
    """
    Collect main contributors for a given IMDb title identifier.

    Args:
        tt_id: IMDb title id (e.g. ``tt0903747``).

    Returns:
        Mapping with the IMDb id and grouped people entries.
    """
    url = f"https://www.imdb.com/title/{tt_id}/"
    try:
        soup_obj = soup(url)
    except Exception:
        return {"imdb_id": tt_id, "people": {"main_actors": [], "creators": [], "writers": [], "directors": []}}

    people = {
        "main_actors": main_actors_from_cast(soup_obj),
        "creators": people_from_credit_block(soup_obj, r"\bCreator(s)?\b"),
        "writers": people_from_credit_block(soup_obj, r"\bWriter(s)?\b"),
        "directors": people_from_credit_block(soup_obj, r"\bDirector(s)?\b"),
    }
    return {"imdb_id": tt_id, "people": people}


def fetch_person_details(nm_id: str):
    """
    Retrieve person level details (photo, short summary, long biography) from IMDb.

    Args:
        nm_id: IMDb person id (e.g. ``nm0000243``).

    Returns:
        Dict with optional ``photo_url``, ``summary`` and ``biography`` keys.
    """
    details = {"photo_url": None, "summary": None, "biography": None}
    if not nm_id:
        return details

    url_main = f"https://www.imdb.com/name/{nm_id}/"
    try:
        soup_obj = soup(url_main)
    except Exception:
        soup_obj = None

    if soup_obj:
        summary_el = soup_obj.find("div", {"data-testid": re.compile(r"(name-bio-text|nm_bio|mini_bio)", re.I)})
        if summary_el:
            details["summary"] = summary_el.get_text(" ", strip=True)
        if not details["summary"]:
            meta_desc = soup_obj.find("meta", attrs={"name": "description"})
            if meta_desc and meta_desc.get("content"):
                details["summary"] = meta_desc["content"].strip()

        for sc in soup_obj.find_all("script", {"type": "application/ld+json"}):
            if not sc.string:
                continue
            try:
                data = json.loads(sc.string)
                objs = data if isinstance(data, list) else [data]
                for obj in objs:
                    if isinstance(obj, dict) and obj.get("@type") == "Person" and obj.get("image"):
                        details["photo_url"] = obj["image"]
                        break
                if details["photo_url"]:
                    break
            except Exception:
                pass

        def clean_photo(url_value: str):
            if not url_value:
                return None
            if url_value.startswith("//"):
                url_value = "https:" + url_value
            bad_hosts = ("fls-na.amazon.com", "uedata=")
            if any(host in url_value for host in bad_hosts):
                return None
            return url_value

        if not details["photo_url"]:
            og = soup_obj.find("meta", attrs={"property": "og:image"}) or soup_obj.find("meta", attrs={"name": "og:image"})
            details["photo_url"] = clean_photo(og.get("content") if og else None)

        if not details["photo_url"]:
            img = soup_obj.select_one(
                '[data-testid="name-page__hero-left-section"] img, '
                '[data-testid="hero__media"] img, '
                'img.ipc-image'
            )
            details["photo_url"] = clean_photo(img.get("src") if img and img.get("src") else None)

        if not details["photo_url"]:
            img = soup_obj.select_one('img[alt][src]')
            if img and img.get("src"):
                details["photo_url"] = clean_photo(img.get("src"))

    url_bio = f"https://www.imdb.com/name/{nm_id}/bio/"
    try:
        bio_soup = soup(url_bio)
        bio_block = bio_soup.find("div", {"data-testid": re.compile(r"(name-bio-text|nm_bio|mini_bio)", re.I)})
        if not bio_block:
            h2 = bio_soup.find(lambda tag: tag.name in ("h2", "h3") and "Biography" in tag.get_text(" ", strip=True))
            if h2:
                bio_block = h2.find_next("div")
        if bio_block:
            text = bio_block.get_text(" ", strip=True)
            if text:
                details["biography"] = text
        if not details["biography"]:
            paragraph = bio_soup.find("p")
            if paragraph:
                details["biography"] = paragraph.get_text(" ", strip=True)
    except Exception:
        pass

    return details

def ensure_json_array_closed(path: Path):
    """
    Append a closing bracket to an array file if it was left open.
    
    Args:
        path (Path): Path to the JSON file.
    """
    if not path.exists():
        return
    content = path.read_text(encoding="utf-8")
    stripped = content.rstrip()
    if not stripped or stripped.endswith("]"):
        return
    path.write_text(stripped + "\n]\n", encoding="utf-8")


def ensure_people_json_closed(path: Path):
    """
    Ensure an existing people JSON document has its closing brackets.

    Args:
        path (Path): Path to the JSON file.
    """
    if not path.exists():
        return
    content = path.read_text(encoding="utf-8")
    stripped = content.rstrip()
    if not stripped or stripped.endswith("}"):
        return
    if stripped.endswith("]"):
        path.write_text(stripped + "\n}\n", encoding="utf-8")
    else:
        path.write_text(stripped + "\n  ]\n}\n", encoding="utf-8")


def initialize_people_output(path: Path, generated_at: str, source: str):
    """
    Start the JSON document with metadata and prepare for streaming writes.
    
    Args:
        path (Path): Path to the output JSON file.
        generated_at (str): ISO timestamp for generation time.
        source (str): Source identifier for metadata.
    """
    global people_first_item
    path.parent.mkdir(parents=True, exist_ok=True)
    header = [
        "{",
        f'  "generated_at": {json.dumps(generated_at)},',
        f'  "source": {json.dumps(source)},',
        '  "people": [',
    ]
    path.write_text("\n".join(header) + "\n", encoding="utf-8")
    people_first_item = True


def persist_people(buffer: list[dict], path: Path):
    """
    Append buffered people entries to the JSON array, returning the count written.
    
    Args:
        buffer (list): List of person dictionaries to persist.
        path (Path): Path to the output JSON file.
    """
    global people_first_item
    if not buffer:
        return 0

    count = len(buffer)
    with people_persist_lock, path.open("a", encoding="utf-8") as fh:
        for record in buffer:
            serialized = json.dumps(record, ensure_ascii=False, indent=4)
            indented = "    " + serialized.replace("\n", "\n    ")
            if people_first_item:
                fh.write(indented)
                people_first_item = False
            else:
                fh.write(",\n" + indented)
    buffer.clear()
    return count


def finalize_people_output(path: Path):
    """
    Close the JSON document.

    Args:
        path (Path): Path to the output JSON file.
    """
    with people_persist_lock, path.open("a", encoding="utf-8") as fh:
        fh.write("\n  ]\n}\n")


def write_people_snapshot(people_map: dict, path: Path, source: str):
    """
    Rewrite the people JSON with the current in-memory snapshot.
    
    Args:
        people_map (dict): Mapping of IMDb person ids to their data.
        path (Path): Path to the output JSON file.
        source (str): Source identifier for metadata.
    """
    generated_at = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    initialize_people_output(path, generated_at, source)

    buffer = []
    def person_sort_key(person: dict) -> tuple[int, str, str, str]:
        movies = [
            movie.get("_id")
            for movie in person.get("movie") or []
            if isinstance(movie, dict) and movie.get("_id")
        ]
        if movies:
            first_movie = min(movies)
            return (0, first_movie, person.get("name") or "", person.get("imdb_name_id") or "")
        return (1, "", person.get("name") or "", person.get("imdb_name_id") or "")

    for person in sorted(people_map.values(), key=person_sort_key):
        person_copy = dict(person)
        roles = sorted(person_copy.get("role") or [])
        movies = sorted(
            (dict(movie) for movie in person_copy.get("movie") or []),
            key=lambda m: (m.get("title") or "", m.get("_id") or ""),
        )
        person_copy["role"] = roles
        person_copy["movie"] = movies

        buffer.append(person_copy)
        if len(buffer) >= PEOPLE_SAVE_BATCH_SIZE:
            persist_people(buffer, path)
    persist_people(buffer, path)
    finalize_people_output(path)


def load_title_cache(path: Path):
    """
    Load cached title people payloads.
    
    Args:
        path (Path): Path to the input JSON file.

    Returns:
        dict: Mapping of IMDb title ids to their cached payloads.    
    """
    if not path.exists():
        return {}
    try:
        payload_raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    if not payload_raw.strip():
        return {}
    try:
        payload = json.loads(payload_raw)
    except Exception as exc:  # pragma: no cover - defensive
        print(f"[!] Could not parse title cache {path} ({exc}). Discarding.")
        return {}
    if isinstance(payload, dict):
        titles = payload.get("titles")
        if isinstance(titles, dict):
            return {str(k): v for k, v in titles.items() if isinstance(v, dict)}
    if isinstance(payload, list):
        result = {}
        for entry in payload:
            if isinstance(entry, dict):
                imdb_id = entry.get("imdb_id")
                if isinstance(imdb_id, str):
                    result[imdb_id] = entry
        return result
    return {}


def persist_title_cache(cache: dict, path: Path):
    """
    Persist the cached title payloads to disk.

    Args:
        cache (dict): Mapping of IMDb title ids to their cached payloads.
        path (Path): Path to the output JSON file.
    """
    with title_cache_lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "titles": {
                key: cache[key]
                for key in sorted(cache.keys())
            },
        }
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def clone_person_entry(entry: dict) -> dict:
    """Create a shallow clone of a person entry with defensive copies of lists."""
    if not isinstance(entry, dict):
        return {}
    cloned = dict(entry)
    cloned["role"] = list(entry.get("role") or [])
    cloned["movie"] = [
        dict(movie)
        for movie in entry.get("movie") or []
        if isinstance(movie, dict)
    ]
    return cloned


def merge_person_entry(target: dict, incoming: dict) -> None:
    """Merge person payloads while deduplicating roles and movie credits."""
    if not isinstance(target, dict) or not isinstance(incoming, dict):
        return
    for key in ("name", "url", "photo_url", "biography"):
        if not target.get(key) and incoming.get(key):
            target[key] = incoming[key]
    target_roles = set(target.get("role") or [])
    incoming_roles = set(incoming.get("role") or [])
    target["role"] = sorted(target_roles.union(incoming_roles))

    existing_movies: dict[str | None, dict] = {}
    for movie in target.get("movie") or []:
        if not isinstance(movie, dict):
            continue
        key = movie.get("_id") or movie.get("title")
        existing_movies[key] = dict(movie)
    for movie in incoming.get("movie") or []:
        if not isinstance(movie, dict):
            continue
        key = movie.get("_id") or movie.get("title")
        if key not in existing_movies:
            existing_movies[key] = dict(movie)
    target["movie"] = sorted(
        existing_movies.values(),
        key=lambda m: (m.get("title") or "", m.get("_id") or ""),
    )


def load_existing_people(path: Path):
    """
    Load previously generated people payloads from disk.

    Returns:
        Tuple of (people_map, processed_movie_ids, next_person_numeric_id).
    """
    people_map: dict[str, dict] = {}
    processed_ids = set()
    max_numeric = 0
    try:
        payload_raw = path.read_text(encoding="utf-8")
        if not payload_raw.strip():
            return people_map, processed_ids, 1
        payload = json.loads(payload_raw)
    except FileNotFoundError:
        return people_map, processed_ids, 1
    except Exception as exc:  # pragma: no cover - defensive
        print(f"[!] Could not load existing people from {path} ({exc}). Ignoring content.")
        return people_map, processed_ids, 1

    if isinstance(payload, dict):
        people_iter = payload.get("people") or []
    elif isinstance(payload, list):
        people_iter = payload
    else:
        people_iter = []

    for person in people_iter:
        if not isinstance(person, dict):
            continue
        nm = person.get("imdb_name_id")
        if not nm:
            continue
        clone = clone_person_entry(person)
        people_map[nm] = clone
        raw_id = clone.get("_id")
        if isinstance(raw_id, str) and raw_id.startswith("p") and raw_id[1:].isdigit():
            max_numeric = max(max_numeric, int(raw_id[1:]))
        for movie in clone.get("movie") or []:
            mid = movie.get("_id")
            if mid:
                processed_ids.add(mid)
    return people_map, processed_ids, max_numeric + 1 if max_numeric else 1


def build_rows_to_process(items: list[dict], processed_movies: set[str], start_movie_index: int | None, end_movie_index: int | None, start_movie_id: str | None, end_movie_id: str | None) -> list[dict]:
    """
    Prepare the list of movies that require people extraction.

    Args:
        items (list[dict]): Raw movie entries loaded from the source dataset.
        processed_movies (set[str]): Movie identifiers already present in the output.
        start_movie_index (int | None): Optional 1-based starting index filter.
        end_movie_index (int | None): Optional 1-based inclusive ending index filter.
        start_movie_id (str | None): Optional movie `_id` marking the first record to include.
        end_movie_id (str | None): Optional movie `_id` marking the last record to include.

    Returns:
        list[dict]: Filtered list of movie rows queued for processing.
    """
    queued_movie_keys = set(processed_movies or set())
    rows_to_process = []

    for row in items or []:
        if not isinstance(row, dict):
            continue
        imdb_raw = row.get("imdb_id") or row.get("imdbId")
        imdb_tt = None
        if imdb_raw:
            match = re.search(r"tt\d{7,}", str(imdb_raw))
            if match:
                imdb_tt = match.group(0)
        movie_id = row.get("_id")
        key_candidates = {movie_id}
        if imdb_tt:
            key_candidates.add(imdb_tt)
        if any(key and key in queued_movie_keys for key in key_candidates):
            continue
        row_copy = dict(row)
        if imdb_tt:
            row_copy["__imdb_tt"] = imdb_tt
        rows_to_process.append(row_copy)
        for key in key_candidates:
            if key:
                queued_movie_keys.add(key)

    start_idx = max((start_movie_index or 1) - 1, 0) if start_movie_index is not None else None
    end_idx = end_movie_index if end_movie_index is not None else None

    hinted_start = resolve_movie_index(rows_to_process, start_movie_id)
    hinted_end = resolve_movie_index(rows_to_process, end_movie_id)

    if hinted_start is not None:
        start_idx = hinted_start
    if hinted_end is not None:
        end_idx = hinted_end + 1  # inclusive

    if start_idx is not None or end_idx is not None:
        start_idx = max(start_idx or 0, 0)
        end_idx = end_idx if end_idx is not None else len(rows_to_process)
        if start_idx >= len(rows_to_process):
            return []
        rows_to_process = rows_to_process[start_idx:end_idx]

    return rows_to_process


def resolve_movie_index(rows: list[dict], movie_id: str | None) -> int | None:
    """
    Locate the zero-based index of a movie within a list by its internal identifier.

    Args:
        rows (list[dict]): Sequence of movie dictionaries to inspect.
        movie_id (str | None): Movie identifier (e.g. `_id`) to locate.

    Returns:
        int | None: Matching index if found, otherwise ``None``.
    """
    if not movie_id:
        return None
    for idx, row in enumerate(rows or []):
        if row.get("_id") == movie_id:
            return idx
    return None


def extract_title_people(row: dict):
    """
    Fetch people payload associated with a single movie row.

    Args:
        row (dict): Movie entry containing at least `_id` and IMDb identifiers.

    Returns:
        dict | None: Normalized mapping with movie metadata and grouped people,
        or ``None`` when IMDb identifiers are unavailable.
    """
    imdb_tt = row.get("__imdb_tt")
    if not imdb_tt:
        imdb_raw = row.get("imdb_id") or row.get("imdbId")
        if not imdb_raw:
            return None
        match = re.search(r"tt\d{7,}", str(imdb_raw))
        if not match:
            return None
        imdb_tt = match.group(0)
    details = fetch_people_for_title(imdb_tt) or {}
    people_group = details.get("people") or {}
    return {
        "_id": row.get("_id"),
        "imdb_id": details.get("imdb_id") or imdb_tt,
        "title": row.get("title"),
        "people": people_group,
    }


def collect_title_payloads(rows_to_process: list[dict], title_cache_path: str | Path, max_workers: int) -> tuple[list[dict], list[str]]:
    """
    Build title payloads by combining cached records with freshly fetched data.

    Args:
        rows_to_process (list[dict]): Movie rows that require people lookup.
        title_cache_path (str | Path): Path to the JSON cache storing prior lookups.
        max_workers (int): Maximum number of threads to use for network requests.

    Returns:
        tuple[list[dict], list[str]]: Collected title payloads and a list of fetch error messages.
    """
    cache_path = Path(title_cache_path)
    title_cache = load_title_cache(cache_path)
    titles_payload = []
    title_errors = []

    total_titles = len(rows_to_process)
    processed_titles = 0
    cache_dirty = False
    rows_to_fetch = []

    for row in rows_to_process:
        if not isinstance(row, dict):
            continue
        imdb_tt = row.get("__imdb_tt")
        if not imdb_tt:
            imdb_raw = row.get("imdb_id") or row.get("imdbId")
            if imdb_raw:
                match = re.search(r"tt\d{7,}", str(imdb_raw))
                if match:
                    imdb_tt = match.group(0)
        cache_key = imdb_tt or row.get("imdb_id")
        cache_entry = title_cache.get(cache_key) if cache_key else None
        row_title = row.get("title") or row.get("_id") or row.get("imdb_id") or "unknown title"
        if cache_entry:
            entry = dict(cache_entry)
            if row.get("_id") and not entry.get("_id"):
                entry["_id"] = row.get("_id")
                if cache_key:
                    title_cache[cache_key] = entry
                    cache_dirty = True
            titles_payload.append(entry)
            processed_titles += 1
            print(
                f"[People] Title {processed_titles}/{total_titles} -> "
                f"{entry.get('imdb_id') or cache_key or 'unknown id'} ({row_title}) [cache]"
            )
        else:
            rows_to_fetch.append(row)

    if cache_dirty:
        persist_title_cache(title_cache, cache_path)

    if rows_to_fetch:
        worker_count = max(1, int(max_workers))
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            future_map = {executor.submit(extract_title_people, row): row for row in rows_to_fetch}
            for future in as_completed(future_map):
                row = future_map[future]
                try:
                    result = future.result()
                except Exception as exc:  # pragma: no cover - defensive
                    title_errors.append(f"{row.get('_id') or row.get('imdb_id')}: {exc}")
                    result = None

                processed_titles += 1
                row_title = row.get("title") or row.get("_id") or row.get("imdb_id") or "unknown title"
                if result:
                    titles_payload.append(result)
                    cache_key = result.get("imdb_id")
                    if cache_key:
                        title_cache[cache_key] = result
                        persist_title_cache(title_cache, cache_path)
                    print(
                        f"[People] Title {processed_titles}/{total_titles} -> "
                        f"{result.get('imdb_id') or 'unknown id'} ({row_title})"
                    )
                else:
                    print(f"[People] Title {processed_titles}/{total_titles} -> skipped ({row_title})")
                time.sleep(random.uniform(*PEOPLE_PROGRESS_DELAY_RANGE))

    return titles_payload, title_errors


def fetch_person_with_metrics(nm_id: str):
    """
    Fetch person details and return metrics useful for logging progress.

    Args:
        nm_id (str): IMDb name identifier (e.g. ``nm0000243``).

    Returns:
        Tuple (nm_id, details, elapsed_seconds, snippet, status).
    """
    timer = time.perf_counter()
    status = "ok"
    snippet = "---"
    try:
        details = fetch_person_details(nm_id) or {}
    except Exception as e: 
        details = {}
        status = f"error: {e}"
    else:
        if not details:
            status = "empty"
        raw_snippet = (
            details.get("biography")
            or details.get("summary")
            or details.get("name")
            or ""
        )
        snippet = (raw_snippet.strip() or "---")[:3]
    elapsed = time.perf_counter() - timer
    return nm_id, details, elapsed, snippet, status


def flush_pending_people(pending_names: list[str], people_map: dict, output_path: Path, input_path: Path):
    """
    Write pending people updates to disk when the in-memory batch is non-empty.

    Args:
        pending_names (list[str]): Human-readable names queued for persistence logging.
        people_map (dict): Mapping of IMDb name ids to their person payloads.
        output_path (Path): Destination JSON file for persisted people data.
        input_path (Path): Source movies JSON path used for metadata.

    Returns:
        list[str]: Cleared list of pending names after flushing.
    """
    if not pending_names:
        return []
    write_people_snapshot(people_map, output_path, str(input_path))
    print("[People] Saved snapshot for people: " + ", ".join(pending_names))
    return []


def queue_person_for_flush(pending_names: list[str], display_name: str | None, people_map: dict, output_path: Path, input_path: Path):
    """
    Track pending people updates and flush them once the batch threshold is reached.

    Args:
        pending_names (list[str]): Names of people queued for persistence.
        display_name (str | None): Display name of the person being added to the batch.
        people_map (dict): Mapping of IMDb name ids to person payloads.
        output_path (Path): Destination JSON file for persisted people data.
        input_path (Path): Source movies JSON path used for metadata.

    Returns:
        list[str]: Updated list of pending names (emptied if a flush occurred).
    """
    label = (display_name or "<unknown>").strip() or "<unknown>"
    pending_names.append(label)
    if len(pending_names) >= PEOPLE_SAVE_BATCH_SIZE:
        pending_names = flush_pending_people(pending_names, people_map, output_path, input_path)
    return pending_names
