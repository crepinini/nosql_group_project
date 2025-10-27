import os
import json
from bson import ObjectId
from flask import Flask, jsonify, request
from pymongo import MongoClient
import redis

app = Flask(__name__)

# ---- Connections -------------------------------------------------------------
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
client = MongoClient(MONGO_URI)
db = client["api_users"]

my_friends_collection = db["my_friends"]
users_collection = db["users"]

r = redis.Redis(
    host=os.environ.get("REDIS_HOST", "localhost"),
    port=int(os.environ.get("REDIS_PORT", 6379)),
    db=int(os.environ.get("REDIS_DB", 0)),
    decode_responses=True,  # store/read strings -> simpler json.dumps/loads
)

CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", 60))


# ---- Helpers -----------------------------------------------------------------
def serialize_id(doc):
    """Return a shallow copy with _id converted to string (if present)."""
    if not doc:
        return doc
    out = dict(doc)
    if "_id" in out and not isinstance(out["_id"], str):
        out["_id"] = str(out["_id"])
    return out


def find_user_any_id(user_id: str, projection=None):
    """
    Find a user by either imdb_user_id or _id (case-insensitive).
    Works with values like 'ur123...' or 'U000000000001' (or lower-case).
    """
    query = {
        "$or": [
            {"imdb_user_id": user_id},
            {"_id": user_id},
            {"imdb_user_id": {"$regex": f"^{user_id}$", "$options": "i"}},
            {"_id": {"$regex": f"^{user_id}$", "$options": "i"}},
        ]
    }
    return users_collection.find_one(query, projection)


# ---- Routes: Friends ---------------------------------------------------------
@app.route("/myfriends", methods=["GET"])
def get_my_friends():
    cache_key = "my_friends_list"
    cached = r.get(cache_key)
    if cached:
        print("cache hit! /myfriends")
        return jsonify(json.loads(cached))

    print("cache miss /myfriends -> Mongo")
    friends = [serialize_id(x) for x in my_friends_collection.find()]
    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(friends))
    return jsonify(friends)


@app.route("/my_friends/<friend_id>", methods=["GET"])
def get_my_friend(friend_id):
    cache_key = f"friend:{friend_id}"
    cached = r.get(cache_key)
    if cached:
        print("cache hit! /my_friends/<id>")
        return jsonify(json.loads(cached))

    # Try ObjectId, then string _id
    try:
        doc = my_friends_collection.find_one({"_id": ObjectId(friend_id)})
    except Exception:
        doc = my_friends_collection.find_one({"_id": friend_id})

    if not doc:
        return jsonify({"error": "Friend not found"}), 404

    doc = serialize_id(doc)
    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(doc))
    return jsonify(doc)


# ---- Routes: Profile & Favorites --------------------------------------------
@app.route("/myprofile", methods=["GET"])
def get_profile():
    user_id = request.args.get("user_id", "ur12345678")
    cache_key = f"profile:{user_id}"
    cached = r.get(cache_key)
    if cached:
        print("cache hit! /myprofile")
        return jsonify(json.loads(cached))

    print("cache miss /myprofile -> Mongo")
    user = find_user_any_id(user_id)
    if not user:
        return jsonify({"error": "Profile not found"}), 404

    user = serialize_id(user)
    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(user))
    return jsonify(user)


@app.route("/mylist", methods=["GET"])
def get_my_list():
    user_id = request.args.get("user_id", "ur12345678")
    limit_param = request.args.get("limit")
    try:
        limit = int(limit_param) if limit_param else None
    except ValueError:
        limit = None

    cache_key = f"favorites:{user_id}:{limit if limit else 'all'}"
    cached = r.get(cache_key)
    if cached:
        print("cache hit! /mylist")
        return jsonify(json.loads(cached))

    print("cache miss /mylist -> Mongo")
    doc = find_user_any_id(user_id, projection={"_id": 0, "favorites": 1})
    if not doc or "favorites" not in doc:
        return jsonify({"error": "Favorites not found"}), 404

    favorites = doc["favorites"] or []
    if limit is not None and limit > 0:
        favorites = favorites[:limit]

    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(favorites))
    return jsonify(favorites)


# ---- Main --------------------------------------------------------------------
if __name__ == "__main__":
    # Port 5004 to match your docker-compose and proxy
    app.run(host="0.0.0.0", port=5004, debug=True)
