import json
from datetime import datetime
from urllib.parse import quote_plus

POSTER_PLACEHOLDER_TEMPLATE = (
    "https://ui-avatars.com/api/"
    "?name={name}&background=023047&color=ffffff&size=512&length=2"
)


def build_poster_placeholder(title: str | None = None):
    """
    Build a fallback poster image that mirrors the people avatar placeholder.

    Args:
        title (str | None): Title to encode into the placeholder.
    
    Returns:    
        str: URL of the generated placeholder image.
    """
    base_title = (title or "").strip() or "Movie"
    encoded = quote_plus(base_title)
    return POSTER_PLACEHOLDER_TEMPLATE.format(name=encoded)


POSTER_PLACEHOLDER = build_poster_placeholder()


def is_series_doc(doc: dict):
    """
    Determine whether a MongoDB document represents a TV series entry.

    Args:
        doc (dict): Document fetched from the collection.

    Returns:
        bool: True when the document looks like a series, otherwise False.
    """
    imdb_type = str(doc.get("imdb_type") or "").lower()
    if not imdb_type:
        return False
    if imdb_type.startswith("tv"):
        return True
    return "series" in imdb_type and "movie" not in imdb_type


def is_movie_doc(doc: dict):
    """
    Determine whether a MongoDB document represents a movie entry.

    Args:
        doc (dict): Document fetched from the collection.

    Returns:
        bool: True when the record should be treated as a movie.
    """
    imdb_type = str(doc.get("imdb_type") or "").lower()
    if not imdb_type:
        return True
    if imdb_type.startswith("movie"):
        return True
    return not is_series_doc(doc)


def safe_float(value, default=0.0):
    """
    Convert arbitrary values into floats while guarding against failures.

    Args:
        value (Any): Raw value to convert.
        default (float): Fallback value when parsing is unsuccessful.

    Returns:
        float: Parsed float or the provided default.
    """
    if value is None:
        return default
    try:
        return float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return default


def safe_int(value, default=0):
    """
    Parse a value into an integer, tolerating strings and floats.

    Args:
        value (Any): Raw value to convert.
        default (int): Fallback value when parsing fails.

    Returns:
        int: Parsed integer or the default.
    """
    if value is None:
        return default
    try:
        return int(float(str(value).split()[0]))
    except (TypeError, ValueError):
        return default


def parse_year(doc: dict):
    """
    Extract the release year from a document using several fallback fields.

    Args:
        doc (dict): MongoDB document being processed.

    Returns:
        int | None: Year as an integer when available, otherwise None.
    """
    for key in ("year", "release_year"):
        if key in doc and doc[key] not in (None, ""):
            return safe_int(doc[key], None)
    release_date = doc.get("release_date")
    if release_date:
        try:
            return int(str(release_date)[:4])
        except (TypeError, ValueError):
            return None
    return None


def parse_release_datetime(doc: dict):
    """
    Produce a datetime object representing a document's release information.

    Args:
        doc (dict): MongoDB document being processed.

    Returns:
        datetime: Parsed datetime or datetime.min when no date can be resolved.
    """
    release_date = doc.get("release_date")
    if release_date:
        string_value = str(release_date).strip()
        if string_value:
            for pattern in ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y"):
                try:
                    return datetime.strptime(string_value, pattern)
                except ValueError:
                    continue
            try:
                return datetime.fromisoformat(string_value)
            except ValueError:
                pass
    year = parse_year(doc)
    if year:
        month = safe_int(doc.get("release_month"), 1)
        day = safe_int(doc.get("release_day"), 1)
        month = min(max(month, 1), 12)
        day = min(max(day, 1), 28)
        try:
            return datetime(year, month, day)
        except ValueError:
            try:
                return datetime(year, month, 1)
            except ValueError:
                return datetime(year, 1, 1)
    return datetime.min


def get_actor_list(doc: dict):
    """
    Build a list of actor names from multiple possible fields on a document.

    Args:
        doc (dict): MongoDB document containing actor information.

    Returns:
        list[str]: Ordered, de-duplicated list of actor names.
    """
    candidates = []
    for key in ("main_actors", "first_four_actors", "actors", "cast"):
        value = doc.get(key)
        if isinstance(value, list):
            candidates.extend(str(entry).strip() for entry in value if entry)
        elif isinstance(value, str):
            parts = [
                segment.strip()
                for segment in value.replace("|", ",").replace("/", ",").split(",")
                if segment.strip()
            ]
            candidates.extend(parts)
    deduped = []
    seen = set()
    for name in candidates:
        lower = name.lower()
        if lower in seen:
            continue
        seen.add(lower)
        deduped.append(name)
    return deduped


def format_actor_reason(names: list[str]):
    """
    Convert a list of actor names into a short bullet-friendly string.

    Args:
        names (list[str]): Actor names contributing to a recommendation.

    Returns:
        str: Human-readable summary of actors.
    """
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} & {names[1]}"
    remaining = len(names) - 2
    return f"{names[0]}, {names[1]} +{remaining}"


def copy_with_reason(doc: dict, reason: str = None):
    """
    Duplicate a document and optionally attach a human explanation field.

    Args:
        doc (dict): Original MongoDB document.
        reason (str, optional): Justification to include under ``__reason``.

    Returns:
        dict: Copy of the document including the optional reason.
    """
    payload = dict(doc)
    if reason:
        payload["__reason"] = reason
    return payload


def should_exclude(doc: dict, exclude_ids: set[str]):
    """
    Decide whether a document should be filtered out using identifier lists.

    Args:
        doc (dict): Candidate document.
        exclude_ids (set[str]): Identifiers to omit from results.

    Returns:
        bool: True when the document matches an exclusion identifier.
    """
    if not exclude_ids:
        return False
    identifiers = set()
    if doc.get("_id"):
        identifiers.add(str(doc["_id"]))
    if doc.get("imdb_id"):
        identifiers.add(str(doc["imdb_id"]))
    return any(identifier in exclude_ids for identifier in identifiers)


def filter_by_type(documents: set[dict], item_type: str | None, exclude_ids: set[str]):
    """
    Restrict documents to a given type while honoring exclusion lists.

    Args:
        documents (set[dict]): Documents to evaluate.
        item_type (str | None): Requested type (`"movie"` or `"series"`).
        exclude_ids (set[str]): Identifiers that must be ignored.

    Returns:
        list[dict]: Documents that match the desired type.
    """
    normalized_type = str(item_type or "").lower()
    filtered = []
    for doc in documents:
        if should_exclude(doc, exclude_ids):
            continue
        if normalized_type == "movie" and not is_movie_doc(doc):
            continue
        if normalized_type == "series" and not is_series_doc(doc):
            continue
        filtered.append(doc)
    return filtered


def trim_results(items: set[dict], limit: int):
    """
    Trim recommendation results, dropping temporary fields and enforcing limits.

    Args:
        items (set[dict]): Candidate recommendation payloads.
        limit (int): Maximum number of records to emit.

    Returns:
        list[dict]: Final list with ``__score`` removed.
    """
    results = []
    for entry in items:
        cleaned = dict(entry)
        cleaned.pop("__score", None)
        results.append(cleaned)
        if len(results) >= limit:
            break
    return results


def compute_actor_weights(documents: set[dict]):
    """
    Produce preference weights for actors based on document appearance order.

    Args:
        documents (set[dict]): Documents representing liked titles.

    Returns:
        dict[str, int]: Weight per actor name, favoring higher billing.
    """
    weights = {}
    for doc in documents:
        actors = get_actor_list(doc)
        for index, actor in enumerate(actors):
            if not actor:
                continue
            base = max(4 - index, 1)
            weights[actor] = weights.get(actor, 0) + base
    return weights


def merge_weight_maps(*mappings: dict[str, int]):
    """
    Combine multiple actor weight dictionaries by summing their values.

    Args:
        *mappings (dict[str, int]): Weight maps gathered from different sources.

    Returns:
        dict[str, int]: Aggregated weights across all inputs.
    """
    merged = {}
    for mapping in mappings:
        if not mapping:
            continue
        for key, value in mapping.items():
            merged[key] = merged.get(key, 0) + value
    return merged


def parse_identifier_list(raw_value: any):
    """
    Parse a value into a sanitized list of identifier strings.

    Args:
        raw_value (Any): Potentially comma-separated identifiers.

    Returns:
        list[str]: Cleaned list of identifiers.
    """
    if not raw_value:
        return []
    if isinstance(raw_value, (list, tuple)):
        items = raw_value
    else:
        items = str(raw_value).split(",")
    parsed = []
    for item in items:
        text = str(item).strip()
        if text:
            parsed.append(text)
    return parsed


def build_document_lookup(documents: set[dict]):
    """
    Build a mapping of identifiers to their corresponding documents.

    Args:
        documents (set[dict]): Collection documents.

    Returns:
        dict[str, dict]: Lookup using ``_id`` or ``imdb_id`` keys.
    """
    lookup = {}
    for doc in documents:
        if doc.get("_id"):
            lookup[str(doc["_id"])] = doc
        if doc.get("imdb_id"):
            lookup[str(doc["imdb_id"])] = doc
    return lookup


def gather_favorite_docs(documents: set[dict], favorite_ids: set[str]):
    """
    Resolve favorite identifier strings into a deduplicated document list.

    Args:
        documents (set[dict]): Full catalog of documents.
        favorite_ids (set[str]): Identifiers declared as favorites.

    Returns:
        list[dict]: Documents in the order of the provided identifiers.
    """
    if not favorite_ids:
        return []
    lookup = build_document_lookup(documents)
    seen = set()
    favorites = []
    for identifier in favorite_ids:
        doc = lookup.get(identifier)
        if not doc:
            continue
        ref = doc.get("_id") or doc.get("imdb_id")
        if ref and ref in seen:
            continue
        if ref:
            seen.add(ref)
        favorites.append(doc)
    return favorites


def build_actor_category(documents: set[dict], item_type: str | None, limit: int, exclude_ids: set[str], weights: dict[str, int]):
    """
    Recommend titles that share actors with favorites using weight scores.

    Args:
        documents (set[dict]): Pool of candidate documents.
        item_type (str | None): Requested filter (`"movie"` / `"series"`).
        limit (int): Maximum number of results to return.
        exclude_ids (set[str]): Identifiers to omit.
        weights (dict[str, int]): Actor preference weights.

    Returns:
        list[dict]: Recommendations sorted by shared actor weight.
    """
    if not weights:
        return []
    pool = filter_by_type(documents, item_type, exclude_ids)
    results = []
    for doc in pool:
        actors = get_actor_list(doc)
        overlaps = [actor for actor in actors if actor in weights]
        if not overlaps:
            continue
        score = sum(weights[actor] for actor in overlaps)
        reason = f"Features {format_actor_reason(overlaps)} you like"
        enriched = copy_with_reason(doc, reason)
        enriched["__score"] = score
        results.append(enriched)
    results.sort(
        key=lambda item: (
            -item.get("__score", 0),
            -safe_float(item.get("rating")),
            -safe_int(item.get("rating_count")),
        )
    )
    return trim_results(results, limit)


def build_actor_follow_category(documents: set[dict], item_type: str | None, limit: int, exclude_ids: set[str], actor_names: set[str]):
    """
    Recommend titles that feature the actors the user follows directly.

    Args:
        documents (set[dict]): Pool of candidate documents.
        item_type (str | None): Requested filter (`"movie"` / `"series"`).
        limit (int): Maximum number of results to return.
        exclude_ids (set[str]): Identifiers to omit.
        actor_names (set[str]): Actor names the user likes.

    Returns:
        list[dict]: Recommendations highlighting followed actors.
    """
    if not actor_names:
        return []

    normalized = {}
    for name in actor_names:
        if not name:
            continue
        label = str(name).strip()
        if not label:
            continue
        normalized[label.lower()] = label
    if not normalized:
        return []

    pool = filter_by_type(documents, item_type, exclude_ids)
    results = []
    for doc in pool:
        actors = get_actor_list(doc)
        matches = []
        for actor in actors:
            lowered = actor.lower()
            if lowered in normalized:
                matches.append(normalized[lowered])
        if not matches:
            continue
        reason = f"Features {format_actor_reason(matches)} you follow"
        enriched = copy_with_reason(doc, reason)
        enriched["__score"] = len(matches)
        results.append(enriched)

    results.sort(
        key=lambda item: (
            -item.get("__score", 0),
            -safe_float(item.get("rating")),
            -safe_float(item.get("popularity")),
        )
    )
    return trim_results(results, limit)


def build_new_category(documents: set[dict], item_type: str | None, limit: int, exclude_ids: set[str]):
    """
    Recommend the latest releases, prioritizing recency and popularity.

    Args:
        documents (set[dict]): Pool of candidate documents.
        item_type (str | None): Desired item type.
        limit (int): Maximum number of items to return.
        exclude_ids (set[str]): Identifiers to exclude.

    Returns:
        list[dict]: Recent titles annotated with release information.
    """
    pool = filter_by_type(documents, item_type, exclude_ids)
    sorted_pool = sorted(
        pool,
        key=lambda doc: (parse_release_datetime(doc), safe_float(doc.get("popularity"))),
        reverse=True,
    )
    prepared = []
    for doc in sorted_pool:
        release_date = doc.get("release_date")
        reason = ""
        if release_date:
            reason = f"Released on {release_date}"
        else:
            year = parse_year(doc)
            if year:
                reason = f"Released in {year}"
        prepared.append(copy_with_reason(doc, reason))
    return trim_results(prepared, limit)


def build_top_year_category(documents: set[dict], item_type: str | None, limit: int, exclude_ids: set[str], target_year: int):
    """
    Promote top-rated items for a specific year with fallback logic.

    Args:
        documents (set[dict]): Pool of candidate documents.
        item_type (str | None): Requested item type.
        limit (int): Maximum number of results.
        exclude_ids (set[str]): Identifiers that should be skipped.
        target_year (int): Preferred year to highlight.

    Returns:
        list[dict]: High-rated picks for the given or fallback year.
    """
    pool = filter_by_type(documents, item_type, exclude_ids)
    matching = [doc for doc in pool if parse_year(doc) == target_year]
    if not matching:
        available_years = sorted(
            {parse_year(doc) for doc in pool if parse_year(doc)}, reverse=True
        )
        if available_years:
            fallback_year = available_years[0]
            matching = [doc for doc in pool if parse_year(doc) == fallback_year]
            target_year = fallback_year
    sorted_pool = sorted(
        matching,
        key=lambda doc: (
            safe_float(doc.get("rating")),
            safe_int(doc.get("rating_count")),
            safe_float(doc.get("popularity")),
        ),
        reverse=True,
    )
    prepared = []
    for doc in sorted_pool:
        rating = safe_float(doc.get("rating"))
        if rating:
            reason = f"Rated {rating:.1f} in {target_year}"
        else:
            reason = f"Top pick for {target_year}"
        prepared.append(copy_with_reason(doc, reason))
    return trim_results(prepared, limit)


def build_top_year_popular_category(documents: set[dict], item_type: str | None, limit: int, exclude_ids: set[str], target_year: int):
    """
    Surface the most popular titles released in a chosen year.

    Args:
        documents (set[dict]): Pool of candidate documents.
        item_type (str | None): Requested item type.
        limit (int): Maximum number of items to emit.
        exclude_ids (set[str]): Identifiers to omit from results.
        target_year (int): Year constraint for the search.

    Returns:
        list[dict]: Popular titles for the target year with context.
    """
    pool = filter_by_type(documents, item_type, exclude_ids)
    matching = [doc for doc in pool if parse_year(doc) == target_year]
    sorted_pool = sorted(
        matching,
        key=lambda doc: (
            safe_float(doc.get("popularity")),
            safe_float(doc.get("rating")),
            safe_int(doc.get("rating_count")),
        ),
        reverse=True,
    )
    prepared = []
    for doc in sorted_pool:
        popularity = safe_float(doc.get("popularity"))
        if popularity:
            reason = f"Popularity score {popularity:.0f} in {target_year}"
        else:
            reason = f"Trending in {target_year}"
        prepared.append(copy_with_reason(doc, reason))
    return trim_results(prepared, limit)


def build_popular_category(documents: set[dict], item_type: str | None, limit: int, exclude_ids: set[str]):
    """
    Provide globally popular picks regardless of release year.

    Args:
        documents (set[dict]): Pool of candidate documents.
        item_type (str | None): Desired item type filter.
        limit (int): Maximum number of recommendations.
        exclude_ids (set[str]): Identifiers to exclude from results.

    Returns:
        list[dict]: Popularity-ranked titles with justification text.
    """
    pool = filter_by_type(documents, item_type, exclude_ids)
    sorted_pool = sorted(
        pool,
        key=lambda doc: safe_float(doc.get("popularity")),
        reverse=True,
    )
    prepared = []
    for index, doc in enumerate(sorted_pool, start=1):
        score = safe_float(doc.get("popularity"))
        if score:
            reason = f"Popularity score {score:.0f}"
        else:
            reason = f"Trending pick #{index}"
        prepared.append(copy_with_reason(doc, reason))
    return trim_results(prepared, limit)


def build_critic_favorites_category(documents: set[dict], item_type: str | None, limit: int, exclude_ids: set[str]):
    """
    Highlight items with strong critic reception (Metascore).

    Args:
        documents (set[dict]): Pool of candidate documents.
        item_type (str | None): Requested item type.
        limit (int): Maximum number of items to return.
        exclude_ids (set[str]): Identifiers to suppress.

    Returns:
        list[dict]: Critically acclaimed titles sorted by critic metrics.
    """
    pool = filter_by_type(documents, item_type, exclude_ids)
    scored = []
    for doc in pool:
        score = safe_float(doc.get("metascore"))
        if score <= 0:
            continue
        count = safe_int(doc.get("metascore_reviews_count"))
        reason_parts = [f"Metacritic {score:.0f}"]
        if count:
            unit = "review" if count == 1 else "reviews"
            reason_parts.append(f"{count} {unit}")
        enriched = copy_with_reason(doc, " - ".join(reason_parts))
        scored.append(
            (
                score,
                count,
                safe_float(doc.get("rating")),
                safe_float(doc.get("popularity")),
                enriched,
            )
        )

    ranked = [
        entry[-1]
        for entry in sorted(
            scored,
            key=lambda entry: (entry[0], entry[1], entry[2], entry[3]),
            reverse=True,
        )
    ]
    return trim_results(ranked, limit)


def build_top_ranked_category(documents: set[dict], item_type: str | None, limit: int, exclude_ids: set[str]):
    """
    Feature entries with strong placement on IMDb's top-ranked charts.

    Args:
        documents (set[dict]): Pool of candidate documents.
        item_type (str | None): Requested type filter.
        limit (int): Maximum length of the result list.
        exclude_ids (set[str]): Identifiers that should be ignored.

    Returns:
        list[dict]: Titles sorted by chart rank and rating.
    """
    pool = filter_by_type(documents, item_type, exclude_ids)
    sorted_pool = sorted(
        pool,
        key=lambda doc: (
            safe_int(doc.get("top_rated_rank"), default=10_000) or 10_000,
            -safe_float(doc.get("rating")),
        ),
    )
    prepared = []
    for doc in sorted_pool:
        rank = safe_int(doc.get("top_rated_rank"))
        if rank and rank < 10_000:
            reason = f"IMDb Top {rank}"
        else:
            reason = "Highly acclaimed"
        prepared.append(copy_with_reason(doc, reason))
    return trim_results(prepared, limit)


def build_awards_category(documents: set[dict], item_type: str | None, limit: int, exclude_ids: set[str], field: str):
    """
    Rank items by award wins or nominations stored on a specific field.

    Args:
        documents (set[dict]): Pool of candidate documents.
        item_type (str | None): Requested item type filter.
        limit (int): Maximum number of items to respond with.
        exclude_ids (set[str]): Identifiers that must be omitted.
        field (str): Field name containing award counts.

    Returns:
        list[dict]: Award-focused recommendations.
    """
    pool = filter_by_type(documents, item_type, exclude_ids)
    sorted_pool = sorted(
        pool,
        key=lambda doc: safe_int(doc.get(field)),
        reverse=True,
    )
    prepared = []
    label = "wins" if field == "awards_wins" else "nominations"
    for doc in sorted_pool:
        count = safe_int(doc.get(field))
        if count:
            unit = "win" if label == "wins" else "nomination"
            plural = "" if count == 1 else "s"
            reason = f"{count} award {unit}{plural}"
        else:
            reason = "Award recognition"
        prepared.append(copy_with_reason(doc, reason))
    return trim_results(prepared, limit)


def resolve_category_items(key: str, documents: set[dict], context: dict, item_type: str | None):
    """
    Dispatch a category key to the matching recommendation builder.

    Args:
        key (str): Category identifier requested by the caller.
        documents (set[dict]): Available catalog documents.
        context (dict): Shared context such as limits and actor weights.
        item_type (str | None): Requested item type (movie/series/all).

    Returns:
        list[dict]: Recommendation payload for the chosen category.
    """
    limit = context["limit"]
    exclude_ids = context["exclude"]
    target_year = context["year"]
    actor_weights_map = context["actor_weights"]
    normalized_type = str(item_type or "").lower()
    if normalized_type not in {"movie", "series"}:
        normalized_type = "all"

    if key == "new":
        return build_new_category(documents, normalized_type, limit, exclude_ids)
    if key == "top-2025":
        return build_top_year_category(documents, normalized_type, limit, exclude_ids, target_year)
    if key == "top-2025-popular":
        return build_top_year_popular_category(documents, normalized_type, limit, exclude_ids, target_year)
    if key == "popular":
        return build_popular_category(documents, normalized_type, limit, exclude_ids)
    if key == "top-ranked":
        return build_top_ranked_category(documents, normalized_type, limit, exclude_ids)
    if key == "critic-favorites":
        return build_critic_favorites_category(documents, normalized_type, limit, exclude_ids)
    if key == "actor-favorite":
        weights = actor_weights_map.get(normalized_type) or {}
        return build_actor_category(documents, normalized_type, limit, exclude_ids, weights)
    if key == "favorite-actors":
        actor_names = context.get("favorite_actor_names") or []
        return build_actor_follow_category(documents, normalized_type, limit, exclude_ids, actor_names)
    if key == "awards-wins":
        return build_awards_category(documents, normalized_type, limit, exclude_ids, "awards_wins")
    if key == "awards-nominations":
        return build_awards_category(documents, normalized_type, limit, exclude_ids, "awards_nominations")
    return []


def parse_limit_param(raw_value: object, default_limit: int, max_limit: int):
    """
    Sanitize limit query parameters, clamping to configured bounds.

    Args:
        raw_value (Any): Limit value provided by the client.
        default_limit (int): Fallback limit when parsing fails.
        max_limit (int): Maximum allowed limit.

    Returns:
        int: Validated limit value.
    """
    try:
        limit = int(raw_value)
        if limit <= 0:
            return default_limit
        return min(limit, max_limit)
    except (TypeError, ValueError):
        return default_limit


def build_exclude_set(favorite_ids: list | None, extra_excludes: list | None):
    """
    Merge favorite identifiers and extra exclusions into a single set.

    Args:
        favorite_ids (set[str] | None): Favorite identifiers.
        extra_excludes (set[str] | None): Additional ids to skip.

    Returns:
        set[str]: Combined identifier set for exclusion checks.
    """
    exclude = set()
    for identifier in favorite_ids or []:
        if identifier:
            exclude.add(str(identifier))
    for identifier in extra_excludes or []:
        if identifier:
            exclude.add(str(identifier))
    return exclude


def normalize_category(value: str | None, default_categories: list[str]):
    """
    Normalize free-form category names to supported canonical values.

    Args:
        value (str | None): Raw category name from the client.
        default_categories (set[str]): Allowed canonical categories.

    Returns:
        str | None: Canonical category name when matched, else None.
    """
    if not value:
        return None
    lowered = str(value).strip().lower()
    alias_map = {
        "new-movies": "new",
        "new-series": "new",
        "top-2025-movies": "top-2025",
        "top-2025-series": "top-2025",
        "top-2025-popular-movies": "top-2025-popular",
        "top-2025-popular-series": "top-2025-popular",
        "popular-movies": "popular",
        "popular-series": "popular",
        "top-ranked-movies": "top-ranked",
        "top-ranked-series": "top-ranked",
        "critic-favorites-movies": "critic-favorites",
        "critic-favorites-series": "critic-favorites",
        "actor-favorite-movies": "actor-favorite",
        "actor-favorite-series": "actor-favorite",
        "favorite-actors-movies": "favorite-actors",
        "favorite-actors-series": "favorite-actors",
        "favorite-actors-cast": "favorite-actors",
        "awards-wins-movies": "awards-wins",
        "awards-wins-series": "awards-wins",
        "awards-nominations-movies": "awards-nominations",
        "awards-nominations-series": "awards-nominations",
    }
    lowered = alias_map.get(lowered, lowered)
    for candidate in default_categories:
        if candidate.lower() == lowered:
            return candidate
    return None


def get_genre_tokens(doc: dict):
    """
    Collect genre labels from multiple fields and normalize duplicates.

    Args:
        doc (dict): Document containing genre information.

    Returns:
        list[tuple[str, str]]: Lowercased token with original label pairs.
    """
    tokens = []
    for key in ("genres", "genre_interests", "genre", "categories"):
        value = doc.get(key)
        if isinstance(value, list):
            tokens.extend(str(entry).strip() for entry in value if entry)
        elif isinstance(value, str):
            parts = [
                segment.strip()
                for segment in value.replace("|", ",").replace("/", ",").split(",")
                if segment.strip()
            ]
            tokens.extend(parts)
    normalized = []
    seen = set()
    for token in tokens:
        lowered = token.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append((lowered, token))
    return normalized


def format_shared_genres(overlap: list[tuple[str, str]]):
    """
    Create a compact human-readable description of shared genres.

    Args:
        overlap (set[tuple[str, str]]): Genre entries shared between items.

    Returns:
        str: Summary text describing the overlap.
    """
    if not overlap:
        return ""
    labels = sorted({label for _, label in overlap})
    if not labels:
        return ""
    if len(labels) == 1:
        return labels[0]
    if len(labels) == 2:
        return f"{labels[0]} & {labels[1]}"
    remaining = len(labels) - 2
    return f"{labels[0]}, {labels[1]} +{remaining}"


def build_related_items(base_doc: dict, documents: list, min_shared: int, limit: int, exclude_ids: list, requested_type: str | None = None):
    """
    Recommend items that share genres with a base document.

    Args:
        base_doc (dict): Document to find related items for.
        documents (list[dict]): Pool of candidate documents.
        min_shared (int): Minimum number of shared genres required.
        limit (int): Maximum number of results to return.
        exclude_ids (list): Identifiers to omit from results.
        requested_type (str | None): Optional type filter (`"movie"` / `"series"`).
    Returns:
        list[dict]: Related items sorted by shared genre count.
    """
    base_tokens = get_genre_tokens(base_doc)
    if not base_tokens:
        return []
    base_lookup = {lower for lower, _label in base_tokens}
    if not base_lookup:
        return []

    base_type = "series" if is_series_doc(base_doc) else "movie"
    target_type = requested_type if requested_type in {"movie", "series"} else base_type

    base_identifiers = set()
    if base_doc.get("_id"):
        base_identifiers.add(str(base_doc["_id"]))
    if base_doc.get("imdb_id"):
        base_identifiers.add(str(base_doc["imdb_id"]))

    exclude_full = set(exclude_ids or [])
    exclude_full.update(base_identifiers)

    results = []
    for doc in documents:
        if should_exclude(doc, exclude_full):
            continue
        if target_type == "movie" and not is_movie_doc(doc):
            continue
        if target_type == "series" and not is_series_doc(doc):
            continue
        candidates = get_genre_tokens(doc)
        if not candidates:
            continue
        overlap = [(lower, label) for lower, label in candidates if lower in base_lookup]
        if len(overlap) < min_shared:
            continue
        reason = f"Shares {len(overlap)} genres ({format_shared_genres(overlap)})"
        enriched = copy_with_reason(doc, reason)
        enriched["__score"] = len(overlap)
        results.append(enriched)

    results.sort(
        key=lambda item: (
            -item.get("__score", 0),
            -safe_float(item.get("rating")),
            -safe_float(item.get("popularity")),
        )
    )

    return trim_results(results, limit)


def build_payload(data: dict | None, forced_type: str | None = None):
    """
    Prepare an incoming JSON payload for persistence.

    Args:
        data (dict | None): Submitted JSON body.
        forced_type (str | None): Optional imdb_type override.

    Returns:
        dict | None: Cleaned payload or None when invalid.
    """
    if not data or not isinstance(data, dict) or "title" not in data:
        return None

    payload = dict(data)
    if forced_type:
        payload["imdb_type"] = forced_type
    else:
        payload.setdefault("imdb_type", "Movie")
    return payload


def serialize_document(doc: dict | None):
    """
    Convert a MongoDB document into an API-friendly dictionary.

    Args:
        doc (dict | None): MongoDB document.

    Returns:
        dict: Serializable representation with string identifiers.
    """
    if not doc:
        return {}

    serialized = {}
    for key, value in doc.items():
        if key == "_id":
            serialized[key] = str(value)
        else:
            serialized[key] = value

    name_hint = serialized.get("title") or serialized.get("name") or ""
    fallback_poster = build_poster_placeholder(name_hint)
    poster_value = serialized.get("poster_url")
    if isinstance(poster_value, str):
        trimmed = poster_value.strip()
        lowered = trimmed.lower()
        if not trimmed or lowered in {"none", "n/a", "null"}:
            serialized["poster_url"] = fallback_poster
        else:
            serialized["poster_url"] = trimmed
    else:
        serialized["poster_url"] = fallback_poster

    return serialized


def fetch_documents(collection: object, filter_query: dict | None = None):
    """
    Retrieve and serialize documents from MongoDB.

    Args:
        collection (Collection): PyMongo collection handle.
        filter_query (dict | None): Optional MongoDB filter.

    Returns:
        list[dict]: Serialized documents.
    """
    items = collection.find(filter_query or {})
    return [serialize_document(item) for item in items]


def fetch_single(collection: object, redis_client: object, cache_prefix: str, cache_ttl: int, movie_id: str):
    """
    Fetch a single document, leveraging Redis for caching.

    Args:
        collection (Collection): PyMongo collection handle.
        redis_client (Redis): Redis client instance.
        cache_prefix (str): Prefix used when building cache keys.
        cache_ttl (int): Cache time-to-live in seconds.
        movie_id (str): Identifier of the document to retrieve.

    Returns:
        dict | None: Serialized document or None when not found.
    """
    cache_key = f"{cache_prefix}{movie_id}"
    cached = redis_client.get(cache_key)
    if cached:
        try:
            return json.loads(cached)
        except json.JSONDecodeError:
            pass

    query = {"$or": [{"_id": movie_id}, {"imdb_id": movie_id}]}
    document = collection.find_one(query)
    if not document:
        return None

    serialized = serialize_document(document)
    redis_client.setex(cache_key, cache_ttl, json.dumps(serialized))
    return serialized


def invalidate_detail_cache(redis_client: object, cache_prefix: str):
    """
    Clear cached movie detail entries after a write.

    Args:
        redis_client (Redis): Redis client instance.
        cache_prefix (str): Cache key prefix to purge.
    """
    pattern = f"{cache_prefix}*"
    for key in redis_client.scan_iter(pattern):
        redis_client.delete(key)
