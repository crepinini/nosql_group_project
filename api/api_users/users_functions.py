from datetime import datetime
from typing import Any
from uuid import uuid4

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import DESCENDING
from pymongo.collection import Collection
import redis


def generate_next_user_id(users_collection: Collection):
    """
    Generate the next user identifier.

    Args:
        users_collection (Collection): MongoDB collection handle.

    Returns:
        str: Identifier formatted like ``u000000000001``.
    """
    latest_user = users_collection.find_one({"_id": {"$regex": r"^u\d{12}$"}}, sort=[("_id", DESCENDING)], projection={"_id": 1})
    
    if not latest_user:
        return "u000000000001"

    raw_identifier = str(latest_user.get("_id", "")).strip()
    try:
        numeric = int(raw_identifier[1:])
    except (ValueError, TypeError):
        numeric = 0

    return f"u{numeric + 1:012d}"


def serialize_document(document: dict | None):
    """
    Serialize a MongoDB document to a JSON-friendly dictionary.

    Args:
        document (dict | None): MongoDB document.

    Returns:
        dict: Safe copy with string identifiers and no password field.
    """
    if not document:
        return {}
    payload = dict(document)
    if "_id" in payload and not isinstance(payload["_id"], str):
        payload["_id"] = str(payload["_id"])
    payload.pop("password", None)
    payload.pop("movie_comments", None)
    return payload


def build_cache_key(prefix: str, *parts: Any):
    """
    Build a Redis cache key with a prefix and optional segments.

    Args:
        prefix (str): Root part of the key.
        *parts: Additional segments.

    Returns:
        str: Colon-separated cache key.
    """
    normalized = [prefix]
    for part in parts:
        normalized.append(str(part) if part is not None else "")
    return ":".join(normalized)


def parse_boolean(value: Any, default: bool = False):
    """
    Parse a value into a boolean.

    Args:
        value (Any): Candidate value.
        default (bool): Fallback when the value is empty.

    Returns:
        bool: Parsed boolean.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if not normalized:
            return default
        return normalized in {"1", "true", "yes", "on", "public", "visible"}
    return default if value is None else bool(value)


def utc_timestamp_iso():
    """
    Return the current UTC timestamp in ISO 8601 format.

    Returns:
        str: Timestamp string without microseconds and suffixed with ``Z``.
    """
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def ensure_user_lists(user_doc: dict, users_collection: Collection):
    """
    Normalize the user's lists and persist mutations.

    Args:
        user_doc (dict): User document.
        users_collection (Collection): MongoDB collection handle.

    Returns:
        list[dict]: Normalized list entries.
    """
    # Use list data or [] when missing
    raw_lists = user_doc.get("list") if isinstance(user_doc, dict) else None
    mutated = False
    normalized_lists = []

    if not isinstance(raw_lists, list):
        raw_lists = []
        mutated = True

    for entry in raw_lists:
        # Skip entries that are not dicts
        if not isinstance(entry, dict):
            mutated = True
            continue

        # Read ids and fields from the entry
        list_id = (entry.get("list_id") or entry.get("_id") or "").strip()
        if not list_id:
            # Set list_id when it is missing
            list_id = f"lst_{uuid4().hex[:12]}"
            mutated = True

        name = (entry.get("name") or entry.get("title") or "").strip()
        if not name:
            # Set name to "Custom List" when missing
            name = "Custom List"
            mutated = True

        description = (entry.get("description") or "").strip()

        list_type_raw = entry.get("type") or entry.get("list_type") or ""
        list_type = str(list_type_raw).strip().lower()
        # Keep list type to movies or people
        if list_type not in {"movies", "people"}:
            list_type = "movies"
            if list_type_raw:
                mutated = True
        if not list_type_raw:
            mutated = True

        created_at = entry.get("created_at")
        updated_at = entry.get("updated_at")
        if not created_at:
            created_at = utc_timestamp_iso()
            mutated = True
        if not updated_at:
            updated_at = created_at
            mutated = True

        raw_items = entry.get("items")
        if raw_items is None:
            # Use movies_series when items are missing
            raw_items = entry.get("movies_series") or []
            if raw_items:
                mutated = True

        normalized_items = []
        key_name = "person_id" if list_type == "people" else "movie_id"
        if isinstance(raw_items, list):
            for item in raw_items:
                entity_id = ""
                added_at = None
                if isinstance(item, dict):
                    # Check id keys one by one
                    candidates = [
                        key_name,
                        "movie_id",
                        "person_id",
                        "_id",
                        "id",
                    ]
                    for candidate in candidates:
                        if candidate in item and item.get(candidate) not in (None, ""):
                            entity_candidate = item.get(candidate)
                            entity_id = (
                                str(entity_candidate).strip()
                                if not isinstance(entity_candidate, str)
                                else entity_candidate.strip()
                            )
                            if entity_id:
                                break
                    added_at = item.get("added_at")
                elif isinstance(item, str):
                    # Handle string ids like imdb values
                    entity_id = item.strip()
                if not entity_id:
                    # Skip items without ids
                    mutated = True
                    continue
                if not added_at:
                    # Set added_at to utc timestamp when missing
                    added_at = utc_timestamp_iso()
                    mutated = True
                normalized_items.append(
                    {
                        key_name: entity_id,
                        "added_at": added_at,
                    }
                )
        else:
            # Mark mutation when items is not a list
            mutated = True

        visibility_raw = entry.get("is_public")
        if visibility_raw is None:
            visibility_raw = entry.get("visibility")
        # Treat list as not public unless value says true
        is_public = parse_boolean(visibility_raw, default=False)
        if visibility_raw is None and not is_public:
            mutated = True

        normalized_lists.append(
            {
                "list_id": list_id,
                "name": name,
                "description": description,
                "items": normalized_items,
                "created_at": created_at,
                "updated_at": updated_at,
                "is_public": is_public,
                "type": list_type,
            }
        )

    # Save lists back when user has id
    if mutated and isinstance(user_doc, dict) and user_doc.get("_id") is not None:
        users_collection.update_one({"_id": user_doc["_id"]}, {"$set": {"list": normalized_lists}})
        user_doc["list"] = normalized_lists

    # Return the lists result
    return normalized_lists


def save_user_lists(user_doc: dict, lists: list[dict], users_collection: Collection, redis_client: redis.Redis):
    """
    Persist updated lists for a user and invalidate related cache.

    Args:
        user_doc (dict): User document.
        lists (list[dict]): Lists to store.
        users_collection (Collection): MongoDB collection handle.
        redis_client (Redis): Redis client.
    """
    users_collection.update_one({"_id": user_doc["_id"]}, {"$set": {"list": lists}})
    user_doc["list"] = lists
    invalidate_user_cache(str(user_doc.get("_id")), redis_client)


def extract_friend_ids(user_doc: dict):
    """
    Extract friend identifiers from the user document.

    Args:
        user_doc (dict): User document.

    Returns:
        list[str]: Unique friend identifiers.
    """
    friends_raw = user_doc.get("friends") if isinstance(user_doc, dict) else None
    if not friends_raw:
        return []

    friend_ids = set()
    for entry in friends_raw:
        if isinstance(entry, dict):
            friend_id = entry.get("_id") or entry.get("id") or entry.get("user_id") or entry.get("username")
        else:
            friend_id = entry

        if not friend_id:
            continue

        try:
            friend_ids.add(str(friend_id).strip())
        except Exception:
            continue

    return [fid for fid in friend_ids if fid]


def find_user_list(user_doc: dict, list_id: str, users_collection: Collection, lists_cache: list[dict] | None = None):
    """
    Locate a user list by identifier.

    Args:
        user_doc (dict): User document.
        list_id (str): Target list identifier.
        users_collection (Collection): MongoDB collection handle.
        lists_cache (list[dict] | None): Optional pre-fetched lists.

    Returns:
        dict | None: Matching list entry or None.
    """
    if not list_id:
        return None
    lists = lists_cache if lists_cache is not None else ensure_user_lists(user_doc, users_collection)
    for entry in lists:
        if entry.get("list_id") == list_id:
            return entry
    return None


def invalidate_user_cache(user_id: str, redis_client: redis.Redis):
    """
    Invalidate cache entries related to a user.

    Args:
        user_id (str): User identifier.
        redis_client (Redis): Redis client instance.
    """
    keys = [
        build_cache_key("user_detail", user_id),
        build_cache_key("profile", user_id),
        build_cache_key("favorites", user_id, ""),
        build_cache_key("favorites", user_id, "all"),
    ]
    for key in keys:
        try:
            redis_client.delete(key)
        except redis.RedisError:
            continue


def invalidate_user_list_cache(redis_client: redis.Redis):
    """
    Invalidate cached user list entries.

    Args:
        redis_client (Redis): Redis client instance.
    """
    try:
        for key in redis_client.scan_iter("users:*"):
            redis_client.delete(key)
    except redis.RedisError:
        pass


def find_user(identifier: str, users_collection: Collection, projection: dict | None = None):
    """
    Locate a user by identifier or username.

    Args:
        identifier (str): Identifier supplied by the client.
        users_collection (Collection): MongoDB collection handle.
        projection (dict | None): Optional projection.

    Returns:
        dict | None: Matching user document.
    """
    if not identifier:
        return None

    criteria = [
        {"_id": identifier},
        {"username": identifier},
        {"imdb_user_id": identifier},
        {"_id": {"$regex": f"^{identifier}$", "$options": "i"}},
        {"username": {"$regex": f"^{identifier}$", "$options": "i"}},
    ]

    try:
        criteria.append({"_id": ObjectId(identifier)})
    except (InvalidId, TypeError):
        pass

    query = {"$or": criteria}
    return users_collection.find_one(query, projection)


def add_friend(user_doc: dict, other_id: str, users_collection: Collection):
    """
    Attach a friend reference to the user's document.

    Args:
        user_doc (dict): User document.
        other_id (str): Friend identifier.
        users_collection (Collection): MongoDB collection handle.
    """
    current_friends = list(user_doc.get("friends") or [])
    ids_only = [f.get("_id") if isinstance(f, dict) else f for f in current_friends]

    if other_id not in ids_only:
        current_friends.append({"_id": other_id})
        users_collection.update_one({"_id": user_doc["_id"]}, {"$set": {"friends": current_friends}})


def review_matches_movie(entry: dict | None, movie_id: str):
    """
    Check whether a review entry references a given movie identifier.

    Args:
        entry (dict | None): Review entry to inspect.
        movie_id (str): Target movie identifier.

    Returns:
        bool: True when the entry references the movie, otherwise False.
    """
    if not entry or not isinstance(entry, dict):
        return False
    candidates = [
        entry.get("_id"),
        entry.get("id"),
        entry.get("movie_id"),
        entry.get("imdb_id"),
    ]
    for candidate in candidates:
        if candidate is None:
            continue
        if str(candidate).strip() == movie_id:
            return True
    return False