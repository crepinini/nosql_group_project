import json
import os
import re
from uuid import uuid4

from bson import ObjectId
from bson.errors import InvalidId
from flask import Flask, jsonify, request
from flask_cors import CORS
from pymongo import MongoClient
import redis
from datetime import datetime

from users_functions import *

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False
CORS(app)

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
client = MongoClient(MONGO_URI)
db = client["api_users"]
users_collection = db["users"]
my_friends_collection = db["my_friends"]
friend_requests = db["friend_requests"]

r = redis.Redis(
    host=os.environ.get("REDIS_HOST", "localhost"),
    port=int(os.environ.get("REDIS_PORT", 6379)),
    db=int(os.environ.get("REDIS_DB", 0)),
)

CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", 600))


@app.route("/users", methods=["GET"])
def list_users():
    """
    Handle GET requests for the users collection.

    Returns:
        Response: Flask response with user entries or error payload.
    """
    search = request.args.get("q")
    limit_param = request.args.get("limit")

    try:
        limit = int(limit_param) if limit_param else None
        if limit is not None:
            limit = max(1, limit)
    except ValueError:
        limit = None

    cache_key = build_cache_key("users", search or "", limit_param or "")
    cached = r.get(cache_key)
    if cached:
        print("users cache hit!")
        return jsonify(json.loads(cached))

    query = {}
    if search:
        regex = {"$regex": f"^{search}", "$options": "i"}
        query = {"$or": [{"username": regex}, {"full_name": regex}]}

    cursor = users_collection.find(query)
    if limit:
        cursor = cursor.limit(limit)

    documents = [serialize_document(doc) for doc in cursor]
    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(documents))
    return jsonify(documents)


@app.route("/users/<user_id>", methods=["GET"])
def get_user_detail(user_id: str):
    """
    Handle GET requests for a single user record.

    Args:
        user_id (str): Identifier taken from the path segment.

    Returns:
        Response: Flask response with user data or error payload.
    """
    cache_key = build_cache_key("user_detail", user_id)
    cached = r.get(cache_key)
    if cached:
        print("user detail cache hit!")
        return jsonify(json.loads(cached))

    document = find_user(user_id, users_collection)
    if not document:
        return jsonify({"error": "User not found"}), 404

    serialized = serialize_document(document)
    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(serialized))
    return jsonify(serialized)


@app.route("/auth/login", methods=["POST"])
def authenticate_user():
    """
    Handle POST requests for user authentication.

    Returns:
        Response: Flask response with user data or error payload.
    """
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    user = find_user(username, users_collection)
    if not user or user.get("password") != password:
        return jsonify({"error": "Invalid credentials"}), 401

    serialized = serialize_document(user)
    return jsonify(serialized)

@app.route("/auth/login/<user_id>", methods=["PUT"])
def update_authenticate_user(user_id: str):
    """
    Handle PUT requests to update login details.

    Args:
        user_id (str): Identifier extracted from the path.

    Returns:
        Response: JSON payload indicating success or failure.
    """
    payload = request.get_json(silent=True) or {}
    new_username = payload.get("username")
    new_password = payload.get("password")
    if not new_username and not new_password:
        return jsonify({"error": "Username and password are required"}), 400
    user = find_user(user_id, users_collection)
    if not user:
        return jsonify({"error":"User not found"}), 404
    updates = {}
    if new_username:
        updates["username"] = new_username
    if new_password:
        updates["password"]=new_password
    result = users_collection.update_one({"_id": ObjectId(user["_id"])}, {"$set": updates}) # update in MongoDb
    return jsonify({"message": "Your data has been successfully updated!"})

@app.route("/auth/register", methods=["POST"])
def create_user():
    """
    Handle POST requests that create user accounts.

    Returns:
        Response: Flask response with created record or error payload.
    """
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    email = (payload.get("email") or "").strip()
    first_name = (payload.get("first_name") or "").strip()
    last_name = (payload.get("last_name") or "").strip()
    location_city = (payload.get("location_city") or "").strip()
    location_country = (payload.get("location_country") or "").strip()
    birthdate = (payload.get("birthdate") or "").strip()
    about_me = (payload.get("about_me") or "").strip()

    required_fields = {
        "username": username,
        "password": password,
        "email": email,
        "first_name": first_name,
        "last_name": last_name,
        "location_city": location_city,
        "location_country": location_country,
        "birthdate": birthdate,
    }

    missing = [field for field, value in required_fields.items() if not value]
    if missing:
        message = f"Missing required fields: {', '.join(missing)}"
        return jsonify({"error": message}), 400

    try:
        birthdate_obj = datetime.strptime(birthdate, "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"error": "Invalid birthdate format. Please use YYYY-MM-DD."}), 400

    min_year = 1920
    current_year = datetime.utcnow().year
    if birthdate_obj.year < min_year or birthdate_obj.year > current_year:
        return jsonify({"error": f"Birth date must be between {min_year} and {current_year}."}), 400
    if birthdate_obj > datetime.utcnow().date():
        return jsonify({"error": "Birth date cannot be in the future."}), 400

    username_regex = {"$regex": f"^{re.escape(username)}$", "$options": "i"}
    existing_user = users_collection.find_one({"username": username_regex})
    if existing_user:
        return jsonify({"error": "Username already exists. Please choose another username"}), 409

    email_regex = {"$regex": f"^{re.escape(email)}$", "$options": "i"}
    existing_email = users_collection.find_one({"email": email_regex})
    if existing_email:
        return jsonify({"error": "Email already exists. Please sign in or use a different email"}), 409

    full_name = f"{first_name} {last_name}".strip()
    member_since = datetime.utcnow().date().isoformat()

    new_user = {
        "_id": generate_next_user_id(users_collection),
        "username": username,
        "password": password,
        "email": email,
        "first_name": first_name,
        "last_name": last_name,
        "full_name": full_name or username,
        "member_since": member_since,
        "birthdate": birthdate,
        "location_city": location_city,
        "location_country": location_country,
        "about_me": about_me,
        "favorites_movies": [],
        "favorites_people": [],
        "reviews": [],
        "friends": [],
        "friend_requests": [],
        "list": [],
        "stats": {
            "total_favorites": 0,
            "total_reviews": 0,
            "friends_count": 0,
        },
        "movie_ratings": {},
        "watch_statuses": {},
    }

    result = users_collection.insert_one(new_user)
    created_user = users_collection.find_one({"_id": new_user["_id"]})
    invalidate_user_list_cache(r)
    serialized = serialize_document(created_user)
    return jsonify(serialized), 201

@app.route("/auth/delete/<user_id>", methods=["DELETE"])
def delete_user(user_id: str):
    """
    Handle DELETE requests that remove user accounts.

    Args:
        user_id (str): Identifier taken from the path segment.

    Returns:
        Response: Flask response with delete status payload.
    """
    if not ObjectId.is_valid(user_id):
        return jsonify({"error": "The ID of the user is invalid"}), 400
    user = users_collection.find_one({"_id": ObjectId(user_id)})
    if not user:
        return jsonify({"error": "User not found"}), 404
    users_collection.delete_one({"_id": ObjectId(user_id)})
    invalidate_user_cache(user_id, r)
    return jsonify({"message": "User is successfully deleted"})

@app.route("/myfriends", methods=["GET"])
def get_my_friends():
    """
    Handle GET requests for the cached friends list.

    Returns:
        Response: Flask response with friend entries or error payload.
    """
    cache_key = "my_friends_list"
    cached = r.get(cache_key)
    if cached:
        print("cache hit! /myfriends")
        return jsonify(json.loads(cached))

    friends = [serialize_document(friend) for friend in my_friends_collection.find()]
    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(friends))
    return jsonify(friends)


@app.route("/my_friends/<friend_id>", methods=["GET"])
def get_my_friend(friend_id: str):
    """
    Handle GET requests for a cached friend record.

    Args:
        friend_id (str): Identifier taken from the path segment.

    Returns:
        Response: Flask response with friend data or error payload.
    """
    cache_key = build_cache_key("friend", friend_id)
    cached = r.get(cache_key)
    if cached:
        print("cache hit! /my_friends/<id>")
        return jsonify(json.loads(cached))

    friend = None
    try:
        friend = my_friends_collection.find_one({"_id": ObjectId(friend_id)})
    except (InvalidId, TypeError):
        pass

    if not friend:
        friend = my_friends_collection.find_one({"_id": friend_id})

    if not friend:
        return jsonify({"error": "Friend not found"}), 404

    serialized = serialize_document(friend)
    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(serialized))
    return jsonify(serialized)


@app.route("/myprofile", methods=["GET"])
def get_profile():
    """
    Handle GET requests for profile information.

    Returns:
        Response: Flask response with profile data or error payload.
    """
    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id query parameter is required"}), 400

    cache_key = build_cache_key("profile", user_id)
    cached = r.get(cache_key)
    if cached:
        print("cache hit! /myprofile")
        return jsonify(json.loads(cached))

    user = find_user(user_id, users_collection)
    if not user:
        return jsonify({"error": "Profile not found"}), 404

    serialized = serialize_document(user)
    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(serialized))
    return jsonify(serialized)


@app.route("/mylist", methods=["GET"])
def get_my_list():
    """
    Handle GET requests for a user's favorite titles.

    Returns:
        Response: Flask response with favorites data or error payload.
    """
    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id query parameter is required"}), 400
    limit_param = request.args.get("limit")

    try:
        limit = int(limit_param) if limit_param else None
    except ValueError:
        limit = None

    cache_key = build_cache_key("favorites", user_id, limit if limit is not None else "all")
    cached = r.get(cache_key)
    if cached:
        print("cache hit! /mylist")
        return jsonify(json.loads(cached))

    projection = {"favorites_movies": 1, "_id": 0}
    document = find_user(user_id, users_collection, projection=projection)
    favorites = document.get("favorites_movies") if document else None
    if favorites is None:
        return jsonify({"error": "Favorites not found"}), 404
    if limit is not None:
        favorites = favorites[: max(limit, 0)]

    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(favorites))
    return jsonify(favorites)

@app.route("/users/<user_id>/lists", methods=["GET"])
def get_user_lists(user_id: str):
    """
    Handle GET requests for lists owned by a user.

    Args:
        user_id (str): Identifier taken from the path segment.

    Returns:
        Response: Flask response with list data or error payload.
    """
    user = find_user(user_id, users_collection)
    if not user:
        return jsonify({"error": "User not found"}), 404
    lists = ensure_user_lists(user, users_collection)
    return jsonify(lists)

@app.route("/users/<user_id>/lists", methods=["POST"])
def create_user_list(user_id: str):
    """
    Handle POST requests that add a list for a user.

    Args:
        user_id (str): Identifier taken from the path segment.

    Returns:
        Response: Flask response with created list or error payload.
    """
    user = find_user(user_id, users_collection)
    if not user:
        return jsonify({"error": "User not found"}), 404

    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    description = (payload.get("description") or "").strip()
    is_public = parse_boolean(payload.get("is_public"), default=False)
    list_type = (payload.get("type") or "").strip().lower()
    if list_type not in {"movies", "people"}:
        list_type = "movies"

    if not name:
        return jsonify({"error": "List name is required"}), 400

    lists = ensure_user_lists(user, users_collection)
    now = utc_timestamp_iso()
    new_list = {
        "list_id": f"lst_{uuid4().hex[:12]}",
        "name": name,
        "description": description,
        "items": [],
        "created_at": now,
        "updated_at": now,
        "is_public": is_public,
        "type": list_type,
    }
    lists.append(new_list)
    save_user_lists(user, lists, users_collection, r)
    return jsonify(new_list), 201

@app.route("/users/<user_id>/friends/lists", methods=["GET"])
def get_friend_public_lists(user_id: str):
    """
    Handle GET requests for public lists from friends.

    Args:
        user_id (str): Identifier taken from the path segment.

    Returns:
        Response: Flask response with friend list data or error payload.
    """
    user = find_user(user_id, users_collection)
    if not user:
        return jsonify({"error": "User not found"}), 404

    friend_ids = extract_friend_ids(user)
    if not friend_ids:
        return jsonify([])

    public_payload = []
    for friend_id in friend_ids:
        friend_doc = find_user(friend_id, users_collection)
        if not friend_doc:
            continue

        friend_lists = ensure_user_lists(friend_doc, users_collection)
        visible_lists = []
        for entry in friend_lists:
            if not parse_boolean(entry.get("is_public"), default=False):
                continue
            visible_lists.append({
                "list_id": entry.get("list_id"),
                "name": entry.get("name"),
                "description": entry.get("description"),
                "items": entry.get("items", []),
                "created_at": entry.get("created_at"),
                "updated_at": entry.get("updated_at"),
                "is_public": True,
                "type": entry.get("type") or "movies",
            })

        if not visible_lists:
            continue

        public_payload.append({
            "friend_id": str(friend_doc.get("_id")),
            "friend_name": friend_doc.get("full_name") or friend_doc.get("username"),
            "username": friend_doc.get("username"),
            "lists": visible_lists,
        })

    return jsonify(public_payload)

@app.route("/users/<user_id>/lists/<list_id>", methods=["PATCH"])
def update_user_list(user_id: str, list_id: str):
    """
    Handle PATCH requests for a user's list.

    Args:
        user_id (str): User identifier from the path.
        list_id (str): List identifier from the path.

    Returns:
        Response: Flask response with updated list or error payload.
    """
    user = find_user(user_id, users_collection)
    if not user:
        return jsonify({"error": "User not found"}), 404

    lists = ensure_user_lists(user, users_collection)
    target = find_user_list(user, list_id, users_collection, lists_cache=lists)
    if not target:
        return jsonify({"error": "List not found"}), 404

    payload = request.get_json(silent=True) or {}
    updated = False

    if "name" in payload:
        name = (payload.get("name") or "").strip()
        if not name:
            return jsonify({"error": "List name cannot be empty"}), 400
        target["name"] = name
        updated = True
    if "description" in payload:
        description = (payload.get("description") or "").strip()
        target["description"] = description
        updated = True
    if "is_public" in payload:
        target["is_public"] = parse_boolean(
            payload.get("is_public"),
            default=target.get("is_public", False)
        )
        updated = True

    if not updated:
        return jsonify({"error": "No valid fields to update"}), 400

    target["updated_at"] = utc_timestamp_iso()
    save_user_lists(user, lists, users_collection, r)
    return jsonify(target)

@app.route("/users/<user_id>/lists/<list_id>", methods=["DELETE"])
def delete_user_list(user_id: str, list_id: str):
    """
    Handle DELETE requests for a user's list.

    Args:
        user_id (str): User identifier from the path.
        list_id (str): List identifier from the path.

    Returns:
        Response: Flask response with delete status payload.
    """
    user = find_user(user_id, users_collection)
    if not user:
        return jsonify({"error": "User not found"}), 404

    lists = ensure_user_lists(user, users_collection)
    new_lists = [entry for entry in lists if entry.get("list_id") != list_id]
    if len(new_lists) == len(lists):
        return jsonify({"error": "List not found"}), 404

    save_user_lists(user, new_lists, users_collection, r)
    return jsonify({"status": "deleted"})

@app.route("/users/<user_id>/lists/<list_id>/items", methods=["POST"])
def add_list_item(user_id: str, list_id: str):
    """
    Handle POST requests that insert an entry in a list.

    Args:
        user_id (str): User identifier from the path.
        list_id (str): List identifier from the path.

    Returns:
        Response: Flask response with updated list or error payload.
    """
    user = find_user(user_id, users_collection)
    if not user:
        return jsonify({"error": "User not found"}), 404

    lists = ensure_user_lists(user, users_collection)
    target = find_user_list(user, list_id, users_collection, lists_cache=lists)
    if not target:
        return jsonify({"error": "List not found"}), 404

    payload = request.get_json(silent=True) or {}
    list_type = str(target.get("type") or "movies").strip().lower()
    if list_type not in {"movies", "people"}:
        list_type = "movies"

    if list_type == "people":
        raw_id = (
            payload.get("person_id")
            or payload.get("personId")
            or payload.get("id")
            or ""
        )
        key_name = "person_id"
        missing_error = "person_id is required"
    else:
        raw_id = (
            payload.get("movie_id")
            or payload.get("movieId")
            or payload.get("id")
            or ""
        )
        key_name = "movie_id"
        missing_error = "movie_id is required"

    item_id = str(raw_id).strip()
    if not item_id:
        return jsonify({"error": missing_error}), 400

    already_present = any(
        item.get(key_name) == item_id for item in target.get("items", [])
    )
    if already_present:
        return jsonify(target)

    now = utc_timestamp_iso()
    target.setdefault("items", []).append({
        key_name: item_id,
        "added_at": now,
    })
    target["updated_at"] = now
    save_user_lists(user, lists, users_collection, r)
    return jsonify(target), 201

@app.route("/users/<user_id>/lists/<list_id>/items/<movie_id>", methods=["DELETE"])
def remove_list_item(user_id: str, list_id: str, movie_id: str):
    """
    Handle DELETE requests that remove an entry from a list.

    Args:
        user_id (str): User identifier from the path.
        list_id (str): List identifier from the path.
        movie_id (str): Item identifier from the path.

    Returns:
        Response: Flask response with updated list or error payload.
    """
    user = find_user(user_id, users_collection)
    if not user:
        return jsonify({"error": "User not found"}), 404

    lists = ensure_user_lists(user, users_collection)
    target = find_user_list(user, list_id, users_collection, lists_cache=lists)
    if not target:
        return jsonify({"error": "List not found"}), 404

    list_type = str(target.get("type") or "movies").strip().lower()
    if list_type not in {"movies", "people"}:
        list_type = "movies"
    key_name = "person_id" if list_type == "people" else "movie_id"

    item_id = (movie_id or "").strip()
    if not item_id:
        error_label = "person_id" if list_type == "people" else "movie_id"
        return jsonify({"error": f"{error_label} is required"}), 400

    items = target.get("items") or []
    new_items = [item for item in items if item.get(key_name) != item_id]
    if len(new_items) == len(items):
        return jsonify({"error": "Item not found in list"}), 404

    target["items"] = new_items
    target["updated_at"] = utc_timestamp_iso()
    save_user_lists(user, lists, users_collection, r)
    return jsonify(target)

@app.route("/users/<user_id>/favorites", methods=["POST"])
def update_user_favorites(user_id: str):
    """
    Handle POST requests that modify movie favorites.

    Args:
        user_id (str): User identifier from the path.

    Returns:
        Response: Flask response with favorites data or error payload.
    """
    payload = request.get_json(silent=True) or {}
    movie_id = (payload.get("movie_id") or "").strip()
    action = (payload.get("action") or "toggle").strip().lower()

    if not movie_id:
        return jsonify({"error": "movie_id is required"}), 400

    valid_actions = {"add", "remove", "toggle"}
    if action not in valid_actions:
        return jsonify({"error": "Unsupported action"}), 400

    user = find_user(user_id, users_collection)
    if not user:
        return jsonify({"error": "User not found"}), 404

    favorites = [
        entry for entry in (user.get("favorites_movies") or []) if isinstance(entry, dict)
    ]
    exists = any(entry.get("_id") == movie_id for entry in favorites)

    if action == "add" or (action == "toggle" and not exists):
        if not exists:
            favorites.append({"_id": movie_id})
    elif action == "remove" or (action == "toggle" and exists):
        favorites = [entry for entry in favorites if entry.get("_id") != movie_id]

    users_collection.update_one({"_id": user["_id"]}, {"$set": {"favorites_movies": favorites}})

    invalidate_user_cache(user_id, r)
    return jsonify(favorites)


@app.route("/users/<user_id>/favorites-people", methods=["POST"])
def update_user_favorite_people(user_id: str):
    """
    Handle POST requests that modify people favorites.

    Args:
        user_id (str): User identifier from the path.

    Returns:
        Response: Flask response with favorites data or error payload.
    """
    payload = request.get_json(silent=True) or {}
    person_id = (payload.get("person_id") or "").strip()
    action = (payload.get("action") or "toggle").strip().lower()

    if not person_id:
        return jsonify({"error": "person_id is required"}), 400

    valid_actions = {"add", "remove", "toggle"}
    if action not in valid_actions:
        return jsonify({"error": "Unsupported action"}), 400

    user = find_user(user_id, users_collection)
    if not user:
        return jsonify({"error": "User not found"}), 404

    favorites_source = user.get("favorites_people") or []
    favorites = [entry for entry in favorites_source if isinstance(entry, dict)]
    exists = any(entry.get("_id") == person_id for entry in favorites)

    if action == "add" or (action == "toggle" and not exists):
        if not exists:
            favorites.append({"_id": person_id})
    elif action == "remove" or (action == "toggle" and exists):
        favorites = [entry for entry in favorites if entry.get("_id") != person_id]

    users_collection.update_one(
        {"_id": user["_id"]},
        {"$set": {"favorites_people": favorites}}
    )

    invalidate_user_cache(user_id, r)
    return jsonify(favorites)


@app.route("/users/<user_id>/watch-status", methods=["POST"])
def update_watch_status(user_id: str):
    """
    Handle POST requests that update a watch status entry.

    Args:
        user_id (str): User identifier from the path.

    Returns:
        Response: Flask response with status data or error payload.
    """
    payload = request.get_json(silent=True) or {}
    movie_id = (payload.get("movie_id") or "").strip()
    raw_status = payload.get("status")

    if not movie_id:
        return jsonify({"error": "movie_id is required"}), 400

    normalized_input = ""
    if raw_status is None:
        normalized_input = "none"
    elif isinstance(raw_status, str):
        normalized_input = raw_status.strip().lower()

    status_map = {
        "watching": "watching",
        "watch": "watching",
        "watched": "watched",
        "completed": "watched",
        "finished": "watched",
        "plan": "plan",
        "planned": "plan",
        "plan_to_watch": "plan",
        "want": "plan",
        "wishlist": "plan",
        "none": "none",
        "": "none",
    }

    if normalized_input not in status_map:
        return jsonify({"error": "Invalid status value"}), 400

    normalized_status = status_map[normalized_input]

    user = find_user(user_id, users_collection)
    if not user:
        return jsonify({"error": "User not found"}), 404

    watch_statuses = dict(user.get("watch_statuses") or {})
    if normalized_status == "none":
        watch_statuses.pop(movie_id, None)
    else:
        watch_statuses[movie_id] = normalized_status

    if watch_statuses:
        users_collection.update_one(
            {"_id": user["_id"]}, {"$set": {"watch_statuses": watch_statuses}}
        )
    else:
        users_collection.update_one(
            {"_id": user["_id"]}, {"$unset": {"watch_statuses": ""}}
        )

    invalidate_user_cache(user_id, r)
    return jsonify(watch_statuses)


@app.route("/users/<user_id>/ratings", methods=["POST"])
def update_movie_rating(user_id: str):
    """
    Handle POST requests that set a movie rating.

    Args:
        user_id (str): User identifier from the path.

    Returns:
        Response: Flask response with rating data or error payload.
    """
    payload = request.get_json(silent=True) or {}
    movie_id = (payload.get("movie_id") or "").strip()
    rating_raw = payload.get("rating")

    if not movie_id:
        return jsonify({"error": "movie_id is required"}), 400

    rating_value = None
    if rating_raw not in (None, "", "null"):
        try:
            rating_value = int(float(rating_raw))
        except (TypeError, ValueError):
            return jsonify({"error": "rating must be between 1 and 5"}), 400
        if rating_value < 1 or rating_value > 5:
            return jsonify({"error": "rating must be between 1 and 5"}), 400

    user = find_user(user_id, users_collection)
    if not user:
        return jsonify({"error": "User not found"}), 404

    ratings = dict(user.get("movie_ratings") or {})

    if rating_value is None:
        ratings.pop(movie_id, None)
    else:
        ratings[movie_id] = rating_value

    if ratings:
        users_collection.update_one(
            {"_id": user["_id"]}, {"$set": {"movie_ratings": ratings}}
        )
    else:
        users_collection.update_one(
            {"_id": user["_id"]}, {"$unset": {"movie_ratings": ""}}
        )

    invalidate_user_cache(user_id, r)
    return jsonify(ratings)


@app.route("/users/<user_id>/comments", methods=["POST"])
def update_movie_comment(user_id: str):
    """
    Handle POST requests that set a movie comment.

    Args:
        user_id (str): User identifier from the path.

    Returns:
        Response: Flask response with review data or error payload.
    """
    payload = request.get_json(silent=True) or {}
    movie_id = (payload.get("movie_id") or "").strip()
    comment_raw = payload.get("comment")

    if not movie_id:
        return jsonify({"error": "movie_id is required"}), 400

    if comment_raw is None:
        comment_text = ""
    elif isinstance(comment_raw, str):
        comment_text = comment_raw.strip()
    else:
        return jsonify({"error": "comment must be a string"}), 400

    if len(comment_text) > 2000:
        return jsonify({"error": "comment is too long"}), 400

    user = find_user(user_id, users_collection)
    if not user:
        return jsonify({"error": "User not found"}), 404

    reviews = user.get("reviews") or []
    if not isinstance(reviews, list):
        reviews = []

    existing_index = next((index for index, entry in enumerate(reviews) if review_matches_movie(entry, movie_id)), -1)

    updated_reviews = list(reviews)
    now_iso = utc_timestamp_iso()
    today = datetime.utcnow().strftime("%Y-%m-%d")

    if comment_text:
        previous = (
            updated_reviews[existing_index]
            if existing_index >= 0 and isinstance(updated_reviews[existing_index], dict)
            else {}
        )
        review_entry = dict(previous)
        review_entry["_id"] = movie_id
        review_entry["review_text"] = comment_text
        review_entry["updated_at"] = now_iso
        if not review_entry.get("date_posted"):
            review_entry["date_posted"] = today
        if existing_index >= 0:
            updated_reviews[existing_index] = review_entry
        else:
            updated_reviews.append(review_entry)
    elif existing_index >= 0:
        updated_reviews.pop(existing_index)

    update_ops = {}
    if updated_reviews:
        update_ops["$set"] = {"reviews": updated_reviews}
    else:
        update_ops["$unset"] = {"reviews": ""}

    update_ops.setdefault("$unset", {})["movie_comments"] = ""

    if update_ops:
        users_collection.update_one({"_id": user["_id"]}, update_ops)

    invalidate_user_cache(user_id, r)
    return jsonify(updated_reviews)

@app.route("/friend-request", methods=["POST"])
def send_friend_request():
    """
    Handle POST requests that create friend requests.

    Returns:
        Response: Flask response with request data or error payload.
    """
    data = request.get_json(silent=True) or {}

    from_user = (data.get("from_user") or "").strip()
    to_user = (data.get("to_user") or "").strip()

    if not from_user or not to_user:
        return jsonify({"error": "from_user and to_user are required"}), 400

    if from_user == to_user:
        return jsonify({"error": "cannot friend yourself"}), 400

    u_from = find_user(from_user, users_collection)
    u_to = find_user(to_user, users_collection)
    if not u_from or not u_to:
        return jsonify({"error": "user not found"}), 404

    already_friends_ids = [
        f.get("_id") if isinstance(f, dict) else f
        for f in (u_from.get("friends") or [])
    ]
    if str(u_to["_id"]) in already_friends_ids:
        return jsonify({"error": "already friends"}), 409

    existing = friend_requests.find_one({
        "from_user": str(u_from["_id"]),
        "to_user": str(u_to["_id"]),
    })
    if existing:
        return jsonify({"message": "request already sent"}), 200

    result = friend_requests.insert_one({
        "from_user": str(u_from["_id"]),
        "to_user": str(u_to["_id"]),
    })

    return jsonify({
        "request_id": str(result.inserted_id),
        "from_user": str(u_from["_id"]),
        "to_user": str(u_to["_id"]),
    }), 201

@app.route("/friend-requests/<user_id>", methods=["GET"])
def get_friend_requests(user_id: str):
    """
    Handle GET requests for pending friend requests.

    Args:
        user_id (str): User identifier from the path.

    Returns:
        Response: Flask response with request data or error payload.
    """
    user = find_user(user_id, users_collection)
    if not user:
        return jsonify({"error": "user not found"}), 404

    pending = list(friend_requests.find({
        "to_user": str(user["_id"])
    }))

    requests_payload = []
    for req in pending:
        sender_id = req.get("from_user")
        sender_doc = find_user(sender_id, users_collection)
        requests_payload.append({
            "request_id": str(req["_id"]),
            "from_user": sender_id,
            "from_username": sender_doc.get("username") if sender_doc else None,
            "from_full_name": sender_doc.get("full_name") if sender_doc else None,
        })

    return jsonify(requests_payload)

@app.route("/friend-request/<request_id>/accept", methods=["POST"])
def accept_friend_request(request_id: str):
    """
    Handle POST requests that accept friend requests.

    Args:
        request_id (str): Request identifier from the path.

    Returns:
        Response: Flask response with status payload.
    """
    try:
        fr = friend_requests.find_one({"_id": ObjectId(request_id)})
    except (InvalidId, TypeError):
        return jsonify({"error": "invalid request id"}), 400

    if not fr:
        return jsonify({"error": "request not found"}), 404

    from_id = fr.get("from_user")
    to_id = fr.get("to_user")

    user_from = find_user(from_id, users_collection)
    user_to = find_user(to_id, users_collection)

    if not user_from or not user_to:
        return jsonify({"error": "user not found"}), 404

    add_friend(user_from, str(user_to["_id"]), users_collection)
    add_friend(user_to, str(user_from["_id"]), users_collection)

    friend_requests.delete_one({"_id": fr["_id"]})

    invalidate_user_cache(from_id, r)
    invalidate_user_cache(to_id, r)

    return jsonify({"status": "accepted"})


@app.route("/friend-request/<request_id>/refuse", methods=["POST"])
def refuse_friend_request(request_id: str):
    """
    Handle POST requests that refuse friend requests.

    Args:
        request_id (str): Request identifier from the path.

    Returns:
        Response: Flask response with status payload.
    """
    try:
        fr = friend_requests.find_one({"_id": ObjectId(request_id)})
    except (InvalidId, TypeError):
        return jsonify({"error": "invalid request id"}), 400

    if not fr:
        return jsonify({"error": "request not found"}), 404

    friend_requests.delete_one({"_id": fr["_id"]})

    return jsonify({"status": "refused"})

@app.route("/friend-request/<from_user>/<to_user>/cancel", methods=["POST"])
def cancel_friend_request(from_user: str, to_user: str):
    """Cancel a sent friend request."""
    fr = friend_requests.find_one({
        "from_user": from_user,
        "to_user": to_user
    })

    if not fr:
        return jsonify({"error": "no such friend request"}), 404

    friend_requests.delete_one({"_id": fr["_id"]})

    return jsonify({"status": "cancelled"})

@app.route("/myprofile/<user_id>", methods=["PUT"])
def update_profile(user_id: str):
    """
    Handle PUT requests that update profile fields.

    Args:
        user_id (str): Identifier taken from the path segment.

    Returns:
        Response: Flask response with updated profile or error payload.
    """
    payload = request.get_json() or {}

    user = users_collection.find_one({"_id": user_id})
    if not user:
        return jsonify({"error": "User not found"}), 404

    fields = ["about_me", "password", "full_name", "location_city", "location_country"]
    updates = {}

    for field in fields:
        if field in payload:
            if field == "password" and (payload[field] is None or str(payload[field]).strip() == ""):
                continue
            updates[field] = payload[field]

    if not updates:
        return jsonify({"error": "No valid fields to update"}), 400

    users_collection.update_one({"_id": user_id}, {"$set": updates})

    try:
        r.delete(f"profile:{user_id}")
        r.delete(f"user_detail:{user_id}")
    except Exception as e:
        print("cache delete failed:", e)

    updated_user = users_collection.find_one({"_id": user_id})
    updated_user["_id"] = str(updated_user["_id"])
    updated_user.pop("password", None)
    updated_user.pop("movie_comments", None)

    return jsonify(updated_user)


@app.route("/users/<user_a>/friends/<user_b>", methods=["DELETE"])
def delete_friend(user_a: str, user_b: str):
    """
    Handle DELETE requests that remove friend links.

    Args:
        user_a (str): Identifier for the first user.
        user_b (str): Identifier for the second user.

    Returns:
        Response: Flask response with status payload.
    """
    user_A = find_user(user_a, users_collection)
    user_B = find_user(user_b, users_collection)

    if not user_A or not user_B:
        return jsonify({"error": "user not found"}), 404
    new_friends_A = []
    for friend in (user_A.get("friends") or []):
        if isinstance(friend, dict):
            friend_id = friend.get("_id")
        else:
            friend_id = friend
        if friend_id != str(user_B["_id"]):
            new_friends_A.append(friend)

    users_collection.update_one(
        {"_id": user_A["_id"]},
        {"$set": {"friends": new_friends_A}}
    )

    new_friends_B = []
    for friend in (user_B.get("friends") or []):
        if isinstance(friend, dict):
            friend_id = friend.get("_id")
        else:
            friend_id = friend
        if friend_id != str(user_A["_id"]):
            new_friends_B.append(friend)

    users_collection.update_one(
        {"_id": user_B["_id"]},
        {"$set": {"friends": new_friends_B}}
    )

    friend_requests.delete_many({
        "$or": [
            {"from_user": str(user_A["_id"]), "to_user": str(user_B["_id"])},
            {"from_user": str(user_B["_id"]), "to_user": str(user_A["_id"])}
        ]
    })
    
    try:
        r.delete(f"profile:{user_a}")
        r.delete(f"profile:{user_b}")
        r.delete(f"user_detail:{user_a}")
        r.delete(f"user_detail:{user_b}")
        print(f"cache deleted for users {user_a} and {user_b}")
    except Exception as e:
        print("cache delete failed:", e)

    return jsonify({"status": "friend deleted"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
