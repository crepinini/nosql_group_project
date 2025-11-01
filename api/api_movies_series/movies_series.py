import os
import json

from flask import Flask, jsonify, request
from pymongo import MongoClient
import redis

from movies_series_functions import *

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False


client = MongoClient(os.getenv("MONGO_URI", "mongodb://localhost:27017"))
db = client["api_movies_series"]
movies_collection = db["movies_series"]


r = redis.Redis(
    host=os.environ.get("REDIS_HOST", "localhost"),
    port=int(os.environ.get("REDIS_PORT", 6379)),
    db=int(os.environ.get("REDIS_DB", 0)),
)

CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", 60))
CACHE_KEYS = {
    "all": "movies_series_all",
    "movies": "movies_only",
    "series": "series_only",
}
MOVIE_DETAIL_CACHE_PREFIX = "movie_detail:"
DEFAULT_RECOMMENDATION_LIMIT = int(os.environ.get("RECOMMENDATION_LIMIT", 18))
MAX_RECOMMENDATION_LIMIT = int(os.environ.get("MAX_RECOMMENDATION_LIMIT", 60))

DEFAULT_RECOMMENDATION_YEAR = int(os.environ.get("RECOMMENDATION_YEAR", 2025))
DEFAULT_RECOMMENDATION_CATEGORIES = [
    "new",
    "top-2025",
    "top-2025-popular",
    "popular",
    "top-ranked",
    "critic-favorites",
    "actor-favorite",
    "awards-wins",
    "awards-nominations",
]


@app.route("/movies-series", methods=["GET"])
def get_movies_series():
    cache_key = CACHE_KEYS["all"]
    cached = r.get(cache_key)
    if cached:
        print("cache hit!")
        return jsonify(json.loads(cached))

    print("cache miss Fetching from MongoDB...")
    items = fetch_documents(movies_collection)
    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(items))
    return jsonify(items)


@app.route("/movies-series/<movie_id>", methods=["GET"])
def get_movie_detail(movie_id):
    document = fetch_single(
        movies_collection, r, MOVIE_DETAIL_CACHE_PREFIX, CACHE_TTL_SECONDS, movie_id
    )
    if not document:
        return jsonify({"error": "Movie not found"}), 404

    return jsonify(document)


@app.route("/movies", methods=["GET"])
def get_movies():
    cache_key = CACHE_KEYS["movies"]
    cached = r.get(cache_key)
    if cached:
        print("cache hit!")
        return jsonify(json.loads(cached))

    print("cache miss Fetching from MongoDB...")
    items = fetch_documents(
        movies_collection, {"imdb_type": {"$regex": "^movie$", "$options": "i"}}
    )
    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(items))
    return jsonify(items)


@app.route("/series", methods=["GET"])
def get_series():
    cache_key = CACHE_KEYS["series"]
    cached = r.get(cache_key)
    if cached:
        print("cache hit!")
        return jsonify(json.loads(cached))

    print("cache miss Fetching from MongoDB...")
    items = fetch_documents(
        movies_collection,
        {
            "$or": [
                {"imdb_type": {"$regex": "^tv", "$options": "i"}},
                {"imdb_type": {"$not": {"$regex": "^movie$", "$options": "i"}}},
            ]
        }
    )
    r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(items))
    return jsonify(items)


@app.route("/movies-series/recommendations", methods=["GET"])
def get_movies_series_recommendations():
    raw_categories = request.args.get("categories")
    if raw_categories:
        requested_categories = []
        for entry in raw_categories.split(","):
            normalized = normalize_category(entry, DEFAULT_RECOMMENDATION_CATEGORIES)
            if normalized and normalized not in requested_categories:
                requested_categories.append(normalized)
        if not requested_categories:
            requested_categories = DEFAULT_RECOMMENDATION_CATEGORIES
    else:
        requested_categories = DEFAULT_RECOMMENDATION_CATEGORIES

    raw_type = request.args.get("type")
    if raw_type:
        requested_type = str(raw_type).strip().lower()
    else:
        requested_type = "all"
    if requested_type not in {"movie", "series", "all"}:
        requested_type = "all"

    limit = parse_limit_param(
        request.args.get("limit"),
        DEFAULT_RECOMMENDATION_LIMIT,
        MAX_RECOMMENDATION_LIMIT,
    )
    target_year_raw = request.args.get("year")
    target_year = (
        safe_int(target_year_raw, DEFAULT_RECOMMENDATION_YEAR)
        if target_year_raw
        else DEFAULT_RECOMMENDATION_YEAR
    )
    if target_year <= 0:
        target_year = DEFAULT_RECOMMENDATION_YEAR

    favorite_ids = parse_identifier_list(request.args.get("favorite_ids"))
    extra_excludes = parse_identifier_list(request.args.get("exclude"))
    declared_actors = parse_identifier_list(request.args.get("actors"))

    documents = fetch_documents(movies_collection)

    exclude_ids = build_exclude_set(favorite_ids, extra_excludes)
    favorite_docs = gather_favorite_docs(documents, favorite_ids)
    favorite_movie_docs = [doc for doc in favorite_docs if is_movie_doc(doc)]
    favorite_series_docs = [doc for doc in favorite_docs if is_series_doc(doc)]

    actor_weights_movies = compute_actor_weights(favorite_movie_docs)
    actor_weights_series = compute_actor_weights(favorite_series_docs)

    if declared_actors:
        for name in declared_actors:
            if not name:
                continue
            actor_weights_movies[name] = actor_weights_movies.get(name, 0) + 3
            actor_weights_series[name] = actor_weights_series.get(name, 0) + 3
    actor_weights_all = merge_weight_maps(actor_weights_movies, actor_weights_series)

    context = {
        "limit": limit,
        "exclude": exclude_ids,
        "year": target_year,
        "actor_weights": {
            "movie": actor_weights_movies,
            "series": actor_weights_series,
            "all": actor_weights_all,
        },
    }

    recommendations = {
        category: resolve_category_items(category, documents, context, requested_type)
        for category in requested_categories
    }

    return jsonify(recommendations)


@app.route("/movies-series/<movie_id>/related", methods=["GET"])
def get_related_movies_series(movie_id):
    base_document = fetch_single(
        movies_collection, r, MOVIE_DETAIL_CACHE_PREFIX, CACHE_TTL_SECONDS, movie_id
    )
    if not base_document:
        return jsonify({"error": "Movie not found"}), 404

    try:
        min_shared = safe_int(request.args.get("min_shared"), 2)
    except (TypeError, ValueError):
        min_shared = 2
    min_shared = max(min_shared, 1)

    limit = parse_limit_param(
        request.args.get("limit"),
        DEFAULT_RECOMMENDATION_LIMIT,
        MAX_RECOMMENDATION_LIMIT,
    )
    requested_type = request.args.get("type")
    if requested_type:
        requested_type = requested_type.lower()
        if requested_type not in {"movie", "series"}:
            requested_type = None

    favorite_ids = parse_identifier_list(request.args.get("favorite_ids"))
    extra_excludes = parse_identifier_list(request.args.get("exclude"))
    exclude_ids = build_exclude_set(favorite_ids, extra_excludes)

    documents = fetch_documents(movies_collection)
    related = build_related_items(
        base_document, documents, min_shared, limit, exclude_ids, requested_type
    )

    return jsonify(related)


@app.route("/movies-series", methods=["POST"])
def add_movies_series():
    payload = build_payload(request.get_json(silent=True))
    if not payload:
        return jsonify({"error": "please provide at least a title"}), 400

    result = movies_collection.insert_one(payload)
    document = movies_collection.find_one({"_id": result.inserted_id})
    r.delete(*CACHE_KEYS.values())
    invalidate_detail_cache(r, MOVIE_DETAIL_CACHE_PREFIX)
    return jsonify(serialize_document(document)), 201


@app.route("/movies", methods=["POST"])
def add_movies():
    payload = build_payload(request.get_json(silent=True), forced_type="Movie")
    if not payload:
        return jsonify({"error": "please provide at least a title"}), 400

    result = movies_collection.insert_one(payload)
    document = movies_collection.find_one({"_id": result.inserted_id})
    r.delete(*CACHE_KEYS.values())
    invalidate_detail_cache(r, MOVIE_DETAIL_CACHE_PREFIX)
    return jsonify(serialize_document(document)), 201


@app.route("/series", methods=["POST"])
def add_series():
    payload = build_payload(request.get_json(silent=True), forced_type="TVSeries")
    if not payload:
        return jsonify({"error": "please provide at least a title"}), 400

    result = movies_collection.insert_one(payload)
    document = movies_collection.find_one({"_id": result.inserted_id})
    r.delete(*CACHE_KEYS.values())
    invalidate_detail_cache(r, MOVIE_DETAIL_CACHE_PREFIX)
    return jsonify(serialize_document(document)), 201


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
