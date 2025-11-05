import json
import os

from flask import Flask, jsonify, request
from pymongo import MongoClient
from pymongo.collation import Collation
import redis

from people_functions import serialize_document, build_cache_key, clamp, build_people_pipeline, build_people_payload


app = Flask(__name__)

client = MongoClient(os.getenv("MONGO_URI", "mongodb://localhost:27017"))
db = client["api_people"]
people_collection = db["people"]

r = redis.Redis(
    host=os.environ.get("REDIS_HOST", "localhost"),
    port=int(os.environ.get("REDIS_PORT", 6379)),
    db=int(os.environ.get("REDIS_DB", 0)),
)

CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", 600))


@app.route("/people", methods=["GET"])
def get_people():
    """
    Handle GET requests for people listings.

    Returns:
        Response: Flask response with people data and metadata.
    """
    search = request.args.get("q")
    role = (request.args.get("role") or "all").lower()
    sort_option = (request.args.get("sort") or "default").lower()
    limit_param = request.args.get("limit")
    page_param = request.args.get("page")
    page_size_param = request.args.get("page_size")

    try:
        limit = int(limit_param) if limit_param else None
    except ValueError:
        limit = None

    try:
        page = int(page_param) if page_param else 1
    except ValueError:
        page = 1

    try:
        page_size = int(page_size_param) if page_size_param else None
    except ValueError:
        page_size = None

    if page_size is None:
        page_size = limit if limit is not None else 30

    page_size = clamp(page_size, 1, 200)
    page = max(page, 1)
    skip = (page - 1) * page_size

    cache_key = build_cache_key("people", search or "", role or "", sort_option or "", str(page), str(page_size))
    cached = r.get(cache_key)
    if cached:
        print("people cache hit!")
        return jsonify(json.loads(cached))

    pipeline = build_people_pipeline(search, role, sort_option, skip, page_size)

    collation = Collation(locale="en", strength=2)
    cursor = people_collection.aggregate(pipeline, collation=collation)
    documents = list(cursor)

    payload = build_people_payload(documents, page, page_size, sort_option, role, search)

    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(payload))
    return jsonify(payload)


@app.route("/people/<id>", methods=["GET"])
def get_person(id: str):
    """
    Handle GET requests for a person by identifier.

    Args:
        id (str): Identifier from the path segment.

    Returns:
        Response: Flask response with person data or error payload.
    """
    cache_key = build_cache_key("people_detail", id)
    cached = r.get(cache_key)
    if cached:
        print("people detail cache hit!")
        return jsonify(json.loads(cached))

    query = {"$or": [{"_id": id}, {"imdb_name_id": id}]}
    document = people_collection.find_one(query)
    if not document:
        return jsonify({"error": "Person not found"}), 404

    serialized = serialize_document(document)
    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(serialized))
    return jsonify(serialized)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002, debug=True)
