ROLE_FILTERS = {
    "cast": [
        r"^actor$",
    ],
    "crew": [
        r"^(director|writer|creator)$",
    ],
    "director": [
        r"^director$",
    ],
    "writer": [
        r"^writer$",
    ],
    "creator": [
        r"^creator$",
    ],
}


def serialize_document(document):
    serialized = {}
    for key, value in document.items():
        if key == "_id":
            serialized[key] = str(value)
        else:
            serialized[key] = value
    return serialized


def build_cache_key(prefix, *parts):
    normalized_parts = [part or "all" for part in parts]
    return ":".join([prefix, *normalized_parts])


def build_role_conditions(role):
    if not role or role == "all":
        return None

    patterns = ROLE_FILTERS.get(role, [])
    if not patterns:
        return None

    conditions = []
    text_fields = [
        "role",
    ]

    array_object_fields = [
        ("movie", ["role", "category"]),
        ("movies", ["role", "category"]),
        ("series", ["role", "category"]),
        ("credits", ["role", "category"]),
    ]

    for pattern in patterns:
        regex = {"$regex": pattern, "$options": "i"}

        for field in text_fields:
            conditions.append({field: regex})

        for field, subfields in array_object_fields:
            for subfield in subfields:
                conditions.append({field: {"$elemMatch": {subfield: regex}}})

    return {"$or": conditions} if conditions else None


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def build_people_pipeline(search, role, sort_option, skip, page_size):
    pipeline = [{
        "$addFields": {
            "series": {
                "$cond": [
                    {
                        "$gt": [
                            {"$size": {"$ifNull": ["$series", []]}},
                            0,
                        ]
                    },
                    "$series",
                    {"$ifNull": ["$tvSeries", []]},
                ]
            }
        }
    }]
    if search:
        pipeline.append({"$match": {"name": {"$regex": search, "$options": "i"}}})

    role_conditions = build_role_conditions(role)
    if role_conditions:
        pipeline.append({"$match": role_conditions})

    pipeline.append(
        {
            "$addFields": {
                "credits_count": {
                    "$add": [
                        {"$size": {"$ifNull": ["$movie", []]}},
                        {"$size": {"$ifNull": ["$movies", []]}},
                        {"$size": {"$ifNull": ["$series", []]}},
                        {"$size": {"$ifNull": ["$credits", []]}},
                    ]
                }
            }
        }
    )

    if sort_option == "name-desc":
        sort_stage = {"name": -1}
    elif sort_option == "credits-asc":
        sort_stage = {"credits_count": 1, "name": 1}
    elif sort_option == "credits-desc":
        sort_stage = {"credits_count": -1, "name": 1}
    else:
        sort_stage = {"name": 1}

    pipeline.append({"$sort": sort_stage})

    pipeline.append(
        {
            "$facet": {
                "results": [
                    {"$skip": skip},
                    {"$limit": page_size},
                ],
                "metadata": [{"$count": "total"}],
            }
        }
    )

    return pipeline


def build_people_payload(documents, page, page_size, sort_option, role, search):
    if documents:
        first_entry = documents[0]
        raw_results = first_entry.get("results", [])
        metadata = first_entry.get("metadata", [])
        total = metadata[0]["total"] if metadata else 0
    else:
        raw_results = []
        total = 0

    serialized_results = [serialize_document(item) for item in raw_results]
    total_pages = (total + page_size - 1) // page_size if total else 0

    return {
        "results": serialized_results,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": total_pages,
        "sort": sort_option,
        "role": role,
        "search": search or "",
    }
