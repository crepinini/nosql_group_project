import json
import os

from bson import ObjectId
from bson.errors import InvalidId
from flask import Flask, jsonify, request
from pymongo import MongoClient
import redis


app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
client = MongoClient(MONGO_URI)
db = client["api_users"]
users_collection = db["users"]
my_friends_collection = db["my_friends"]

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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
