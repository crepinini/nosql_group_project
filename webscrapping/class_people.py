from __future__ import annotations

# people_extractor.py
import json
import random
import re
import time
import argparse

from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from people_functions import *

CONTENT_PATH = r"data"
INPUT_MOVIES_FILENAME = "movies_data.json"
OUTPUT_PEOPLE_FILENAME = "people_data.json"
TITLE_CACHE_FILENAME = "webscrapping/db/people_titles_cache.json"

class PersonExtractor:
    """High-level orchestrator that builds the enriched people dataset."""

    def __init__(self, input_json_path: str = str(Path(CONTENT_PATH) / INPUT_MOVIES_FILENAME), output_json_path: str = str(Path(CONTENT_PATH) / OUTPUT_PEOPLE_FILENAME), max_workers: int = 8, default_start_movie_id: str | None = None, default_end_movie_id: str | None = None, default_start_movie_index: int | None = None, default_end_movie_index: int | None = None):
        self.input_json_path = input_json_path
        self.output_json_path = output_json_path
        self.max_workers = max_workers
        self.default_start_movie_id = default_start_movie_id
        self.default_end_movie_id = default_end_movie_id
        self.default_start_movie_index = default_start_movie_index
        self.default_end_movie_index = default_end_movie_index

    def extract_people_from_movies_json(self, input_json_path: str | None = None, output_json_path: str | None = None, max_workers: int | None = None, start_movie_index: int | None = None, end_movie_index: int | None = None, start_movie_id: str | None = None, end_movie_id: str | None = None):
        """
        Build a consolidated people JSON file from the movies dataset.

        Args:
            input_json_path: Optional override for the movies data JSON containing IMDb title ids.
            output_json_path: Optional override for the generated people JSON destination.
            max_workers: Optional override for the number of threads used for HTTP requests.
            start_movie_index: Optional 1-based index of the first movie to process from the input dataset.
            end_movie_index: Optional 1-based inclusive index of the last movie to process from the input dataset.
            start_movie_id: Optional movie `_id` (e.g. `ms000000000123`) identifying the first movie to include.
            end_movie_id: Optional movie `_id` identifying the last movie to include.

        Returns:
            Path to the written JSON file.
        """
        input_json_path = input_json_path or self.input_json_path
        output_json_path = output_json_path or self.output_json_path
        max_workers = max_workers or self.max_workers
        if start_movie_index is None:
            start_movie_index = self.default_start_movie_index
        if end_movie_index is None:
            end_movie_index = self.default_end_movie_index
        if start_movie_id is None:
            start_movie_id = self.default_start_movie_id
        if end_movie_id is None:
            end_movie_id = self.default_end_movie_id

        # Fill optional parameters from defaults
        overall_start = time.perf_counter()
        input_path = Path(input_json_path)
        output_path = Path(output_json_path)

        # Ensure JSON inputs are closed
        ensure_json_array_closed(input_path)
        ensure_people_json_closed(output_path)

        people_map = {}
        processed_movies = set()
        next_person_id = 1

        for existing_path in (output_path,):
            if not existing_path.exists() or existing_path.stat().st_size == 0:
                continue
            existing_people, existing_ids, candidate_next = load_existing_people(existing_path)
            for nm, incoming in existing_people.items():
                if nm not in people_map:
                    people_map[nm] = incoming
                else:
                    merge_person_entry(people_map[nm], incoming)
            processed_movies.update(existing_ids)
            next_person_id = max(next_person_id, candidate_next)

        write_people_snapshot(people_map, output_path, str(input_path))

        # Load movie entries from source file
        try:
            raw = input_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            raw = "[]"

        items = json.loads(raw or "[]")
        if not isinstance(items, list):
            raise ValueError("Input movies JSON must contain a list of movie entries.")

        # Build movie queue to process
        rows_to_process = build_rows_to_process(items, processed_movies, start_movie_index, end_movie_index, start_movie_id, end_movie_id)

        title_cache_path = TITLE_CACHE_FILENAME
        worker_count = max(1, int(max_workers))
        
        # Fetch title people data
        titles_payload, title_errors = collect_title_payloads(rows_to_process, title_cache_path, worker_count)

        nm_current_movie = {}
        all_nm = set()
        for title in titles_payload:
            people_group = title.get("people") or {}
            for key in ("main_actors", "creators", "writers", "directors"):
                for person in people_group.get(key) or []:
                    nm = person.get("imdb_name_id")
                    if not nm:
                        continue
                    entry = people_map.get(nm)
                    movie_id = title.get("_id")
                    nm_current_movie[nm] = movie_id
                    if entry and movie_id is not None:
                        existing_movies = entry.get("movie") or []
                        if any(existing.get("_id") == movie_id for existing in existing_movies if isinstance(existing, dict)):
                            continue
                    if not entry or not entry.get("photo_url") or not entry.get("biography"):
                        all_nm.add(nm)

        nm_details = {}
        nm_fetch_metrics = {}

        total_names = len(all_nm)
        processed_names = 0
        if total_names:
            with ThreadPoolExecutor(max_workers=worker_count) as executor:
                start_time = time.perf_counter()
                # Fetch person level details in parallel
                future_map = {executor.submit(fetch_person_with_metrics, nm): nm for nm in sorted(all_nm)}
                for future in as_completed(future_map):
                    nm_id, details, elapsed, snippet, status = future.result()
                    nm_details[nm_id] = details
                    nm_fetch_metrics[nm_id] = (elapsed, snippet, status)
                    processed_names += 1
                    cumulative_elapsed = time.perf_counter() - start_time
                    movies_display = nm_current_movie.get(nm_id) or "n/a"
                    print(
                        f"Completed process imdb_name_id {nm_id} ({processed_names}/{total_names}), "
                        f"URL https://www.imdb.com/name/{nm_id}/ "
                        f"{snippet} ({elapsed:.2f} sec., total {cumulative_elapsed:.1f} sec., movie {movies_display})"
                    )
                    if status not in {"ok", "empty"}:
                        print(f"[!] imdb_name_id {nm_id} fetch status: {status}")
                    time.sleep(random.uniform(*PEOPLE_PROGRESS_DELAY_RANGE))

        roles_dict = {
            "main_actors": "Actor",
            "creators": "Creator",
            "writers": "Writer",
            "directors": "Director",
        }

        total_new_people = 0
        pending_flush_names = []

        for title in titles_payload:
            movie_id = title.get("_id")
            movie_title = title.get("title")
            people_group = title.get("people") or {}
            for role_key, role_name in roles_dict.items():
                for person in people_group.get(role_key) or []:
                    nm = person.get("imdb_name_id")
                    if not nm:
                        continue
                    # Ensure person entry exists
                    entry = people_map.get(nm)
                    created_new_person = False
                    entry_changed = False
                    if not entry:
                        details = nm_details.get(nm) or {}
                        entry = {
                            "_id": f"p{next_person_id:012d}",
                            "name": person.get("name") or details.get("name"),
                            "imdb_name_id": nm,
                            "url": person.get("url") or details.get("url"),
                            "photo_url": person.get("photo_url") or details.get("photo_url"),
                            "biography": person.get("biography") or details.get("biography"),
                            "role": [],
                            "movie": [],
                        }
                        people_map[nm] = entry
                        next_person_id += 1
                        created_new_person = True
                        entry_changed = True
                        total_new_people += 1
                    else:
                        details = nm_details.get(nm) or {}
                        if not entry.get("name"):
                            entry["name"] = person.get("name") or details.get("name")
                            entry_changed = True
                        if not entry.get("url"):
                            entry["url"] = person.get("url") or details.get("url")
                            entry_changed = True
                        if not entry.get("photo_url") and (
                            person.get("photo_url") or details.get("photo_url")
                        ):
                            entry["photo_url"] = person.get("photo_url") or details.get("photo_url")
                            entry_changed = True
                        if not entry.get("biography") and (
                            person.get("biography") or details.get("biography")
                        ):
                            entry["biography"] = person.get("biography") or details.get("biography")
                            entry_changed = True

                    if role_name not in entry["role"]:
                        entry["role"].append(role_name)
                        entry_changed = True

                    if movie_id is not None and movie_title is not None:
                        movies_list = entry.setdefault("movie", [])
                        if all(existing.get("_id") != movie_id for existing in movies_list):
                            movies_list.append({"_id": movie_id, "title": movie_title})
                            entry_changed = True

                    if created_new_person:
                        if nm not in nm_fetch_metrics:
                            snippet_msg = (
                                (entry.get("biography") or entry.get("name") or "---").strip() or "---"
                            )[:3]
                            print(
                                f"Completed process imdb_name_id {nm} (cached, movie {movie_id or 'n/a'}), "
                                f"URL https://www.imdb.com/name/{nm}/ "
                                f"{snippet_msg} (0.00 sec.)"
                            )

                    if entry_changed:
                        display_name = entry.get("name") or person.get("name") or nm
                        pending_flush_names = queue_person_for_flush(pending_flush_names, display_name, people_map, output_path, input_path)

        # Normalize stored role and movie lists
        for entry in people_map.values():
            entry["role"] = sorted(set(entry.get("role") or []))
            entry["movie"] = sorted(
                entry.get("movie") or [],
                key=lambda m: (m.get("title") or "", m.get("_id") or ""),
            )

        # Persist pending updates
        pending_flush_names = flush_pending_people(pending_flush_names, people_map, output_path, input_path)

        if title_errors:
            print(f"[!] Encountered {len(title_errors)} title fetch issues.")

        print(
            f"People extraction completed. Titles processed: {len(titles_payload)}, "
            f"unique people tracked: {len(people_map)}. "
            f"Duration: {time.perf_counter() - overall_start:.1f} seconds."
        )

        return output_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract enriched people data based on movies dataset.")
    parser.add_argument("--start", type=int, default=None, help="1-based index of the first movie to process.")
    parser.add_argument("--end", type=int, default=None, help="1-based index (inclusive) of the last movie to process.")
    parser.add_argument("--input", type=str, default=None, help="Override input movies JSON path.")
    parser.add_argument("--output", type=str, default=None, help="Override output people JSON path.")
    parser.add_argument("--workers", type=int, default=None, help="Override max worker threads.")
    parser.add_argument("--start-id", type=str, default=None, help="Movie _id (e.g. ms000000000123) to start from.")
    parser.add_argument("--end-id", type=str, default=None, help="Movie _id to end on (inclusive).")
    args = parser.parse_args()

    extractor = PersonExtractor()
    print("People JSON ->", extractor.extract_people_from_movies_json(input_json_path=args.input, output_json_path=args.output, max_workers=args.workers, start_movie_index=args.start, end_movie_index=args.end, start_movie_id=args.start_id, end_movie_id=args.end_id))
