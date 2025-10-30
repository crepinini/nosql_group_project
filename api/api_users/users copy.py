import json
import os

from bson import ObjectId
from bson.errors import InvalidId
from flask import Flask, jsonify, request
from flask_cors import CORS
from pymongo import MongoClient
import redis
from datetime import datetime


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

CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", 60))


def serialize_document(document):
    if not document:
        return {}
    payload = dict(document)
    if "_id" in payload and not isinstance(payload["_id"], str):
        payload["_id"] = str(payload["_id"])
    payload.pop("password", None)
    return payload


def build_cache_key(prefix, *parts):
    normalized = [prefix]
    for part in parts:
        normalized.append(str(part) if part is not None else "")
    return ":".join(normalized)


def invalidate_user_cache(user_id):
    keys = [
        build_cache_key("user_detail", user_id),
        build_cache_key("profile", user_id),
        build_cache_key("favorites", user_id, ""),
        build_cache_key("favorites", user_id, "all"),
    ]
    for key in keys:
        try:
            r.delete(key)
        except redis.RedisError:
            continue


def find_user(identifier, projection=None):
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


@app.route("/users", methods=["GET"])
def list_users():
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
        regex = {"$regex": search, "$options": "i"}
        query = {"$or": [{"username": regex}, {"full_name": regex}]}

    cursor = users_collection.find(query)
    if limit:
        cursor = cursor.limit(limit)

    documents = [serialize_document(doc) for doc in cursor]
    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(documents))
    return jsonify(documents)


@app.route("/users/<user_id>", methods=["GET"])
def get_user_detail(user_id):
    cache_key = build_cache_key("user_detail", user_id)
    cached = r.get(cache_key)
    if cached:
        print("user detail cache hit!")
        return jsonify(json.loads(cached))

    document = find_user(user_id)
    if not document:
        return jsonify({"error": "User not found"}), 404

    serialized = serialize_document(document)
    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(serialized))
    return jsonify(serialized)


@app.route("/auth/login", methods=["POST"])
def authenticate_user():
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    user = find_user(username)
    if not user or user.get("password") != password:
        return jsonify({"error": "Invalid credentials"}), 401

    serialized = serialize_document(user)
    return jsonify(serialized)

@app.route("/auth/login/<user_id>", methods=["PUT"])
def update_authenticate_user(user_id):
    payload = request.get_json(silent=True) or {}
    new_username = payload.get("username")
    new_password = payload.get("password")
    if not new_username and not new_password:
        return jsonify({"error": "Username and password are required"}), 400
    user = find_user(user_id)
    if not user:
        return jsonify({"error":"User not found"}), 404
    updates = {}
    if new_username:
        updates["username"] = new_username
    if new_password:
        updates["password"]=new_password
    result = users_collection.update_one({"_id": ObjectId(user["_id"])}, {"$set": updates}) # update in MongoDb
    return jsonify({"message": "Your data has been successfully updated!"})

@app.route("/myfriends", methods=["GET"])
def get_my_friends():
    cache_key = "my_friends_list"
    cached = r.get(cache_key)
    if cached:
        print("cache hit! /myfriends")
        return jsonify(json.loads(cached))

    friends = [serialize_document(friend) for friend in my_friends_collection.find()]
    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(friends))
    return jsonify(friends)


@app.route("/my_friends/<friend_id>", methods=["GET"])
def get_my_friend(friend_id):
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
    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id query parameter is required"}), 400

    cache_key = build_cache_key("profile", user_id)
    cached = r.get(cache_key)
    if cached:
        print("cache hit! /myprofile")
        return jsonify(json.loads(cached))

    user = find_user(user_id)
    if not user:
        return jsonify({"error": "Profile not found"}), 404

    serialized = serialize_document(user)
    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(serialized))
    return jsonify(serialized)


@app.route("/mylist", methods=["GET"])
def get_my_list():
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
    document = find_user(user_id, projection=projection)
    favorites = document.get("favorites_movies") if document else None
    if favorites is None:
        return jsonify({"error": "Favorites not found"}), 404
    if limit is not None:
        favorites = favorites[: max(limit, 0)]

    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(favorites))
    return jsonify(favorites)

@app.route("/users/<user_id>/favorites", methods=["POST"])
def update_user_favorites(user_id):
    payload = request.get_json(silent=True) or {}
    movie_id = (payload.get("movie_id") or "").strip()
    action = (payload.get("action") or "toggle").strip().lower()

    if not movie_id:
        return jsonify({"error": "movie_id is required"}), 400

    valid_actions = {"add", "remove", "toggle"}
    if action not in valid_actions:
        return jsonify({"error": "Unsupported action"}), 400

    user = find_user(user_id)
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

    invalidate_user_cache(user_id)
    return jsonify(favorites)


@app.route("/users/<user_id>/favorites-people", methods=["POST"])
def update_user_favorite_people(user_id):
    payload = request.get_json(silent=True) or {}
    person_id = (payload.get("person_id") or "").strip()
    action = (payload.get("action") or "toggle").strip().lower()

    if not person_id:
        return jsonify({"error": "person_id is required"}), 400

    valid_actions = {"add", "remove", "toggle"}
    if action not in valid_actions:
        return jsonify({"error": "Unsupported action"}), 400

    user = find_user(user_id)
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

    invalidate_user_cache(user_id)
    return jsonify(favorites)


@app.route("/users/<user_id>/watch-status", methods=["POST"])
def update_watch_status(user_id):
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

    user = find_user(user_id)
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

    invalidate_user_cache(user_id)
    return jsonify(watch_statuses)


@app.route("/users/<user_id>/ratings", methods=["POST"])
def update_movie_rating(user_id):
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

    user = find_user(user_id)
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

    invalidate_user_cache(user_id)
    return jsonify(ratings)


@app.route("/users/<user_id>/comments", methods=["POST"])
def update_movie_comment(user_id):
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

    user = find_user(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    comments = dict(user.get("movie_comments") or {})

    if comment_text:
        comments[movie_id] = {
            "text": comment_text,
            "updated_at": datetime.utcnow().isoformat() + "Z",
        }
    else:
        comments.pop(movie_id, None)

    reviews = user.get("reviews") or []
    if not isinstance(reviews, list):
        reviews = []

    updated_reviews = []
    review_found = False
    for entry in reviews:
        if not isinstance(entry, dict):
            continue
        if entry.get("_id") == movie_id:
            review_found = True
            if comment_text:
                updated_entry = dict(entry)
                updated_entry["review_text"] = comment_text
                updated_entry["date_posted"] = datetime.utcnow().strftime("%Y-%m-%d")
                if "helpful_votes" not in updated_entry:
                    updated_entry["helpful_votes"] = 0
                updated_reviews.append(updated_entry)
            # Skip entry if comment removed
        else:
            updated_reviews.append(entry)

    if comment_text and not review_found:
        updated_reviews.append(
            {
                "_id": movie_id,
                "review_text": comment_text,
                "date_posted": datetime.utcnow().strftime("%Y-%m-%d"),
                "helpful_votes": 0,
            }
        )

    update_ops = {}
    if comments:
        update_ops.setdefault("$set", {})["movie_comments"] = comments
    else:
        update_ops.setdefault("$unset", {})["movie_comments"] = ""

    if updated_reviews:
        update_ops.setdefault("$set", {})["reviews"] = updated_reviews
    else:
        update_ops.setdefault("$unset", {})["reviews"] = ""

    if update_ops:
        users_collection.update_one({"_id": user["_id"]}, update_ops)

    invalidate_user_cache(user_id)
    return jsonify(comments)

@app.route("/friend-request", methods=["POST"])
def send_friend_request():
    data = request.get_json(silent=True) or {}

    from_user = (data.get("from_user") or "").strip()
    to_user = (data.get("to_user") or "").strip()

    if not from_user or not to_user:
        return jsonify({"error": "from_user and to_user are required"}), 400

    if from_user == to_user:
        return jsonify({"error": "cannot friend yourself"}), 400

    u_from = find_user(from_user)
    u_to = find_user(to_user)
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
def get_friend_requests(user_id):
    user = find_user(user_id)
    if not user:
        return jsonify({"error": "user not found"}), 404

    pending = list(friend_requests.find({
        "to_user": str(user["_id"])
    }))

    requests_payload = []
    for req in pending:
        sender_id = req.get("from_user")
        sender_doc = find_user(sender_id)
        requests_payload.append({
            "request_id": str(req["_id"]),
            "from_user": sender_id,
            "from_username": sender_doc.get("username") if sender_doc else None,
            "from_full_name": sender_doc.get("full_name") if sender_doc else None,
        })

    return jsonify(requests_payload)

@app.route("/friend-request/<request_id>/accept", methods=["POST"])
def accept_friend_request(request_id):
    try:
        fr = friend_requests.find_one({"_id": ObjectId(request_id)})
    except (InvalidId, TypeError):
        return jsonify({"error": "invalid request id"}), 400

    if not fr:
        return jsonify({"error": "request not found"}), 404

    from_id = fr.get("from_user")
    to_id = fr.get("to_user")

    user_from = find_user(from_id)
    user_to = find_user(to_id)

    if not user_from or not user_to:
        return jsonify({"error": "user not found"}), 404

    def add_friend(user_doc, other_id):
        current_friends = list(user_doc.get("friends") or [])
        ids_only = [f.get("_id") if isinstance(f, dict) else f for f in current_friends]

        if other_id not in ids_only:
            current_friends.append({"_id": other_id})
            users_collection.update_one(
                {"_id": user_doc["_id"]},
                {"$set": {"friends": current_friends}}
            )

    add_friend(user_from, str(user_to["_id"]))
    add_friend(user_to, str(user_from["_id"]))

    friend_requests.delete_one({"_id": fr["_id"]})

    invalidate_user_cache(from_id)
    invalidate_user_cache(to_id)

    return jsonify({"status": "accepted"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
