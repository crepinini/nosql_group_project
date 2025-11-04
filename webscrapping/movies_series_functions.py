import re
from datetime import datetime
from threading import Lock
from bs4 import BeautifulSoup
import time
import random
from pathlib import Path
import json

DATE_FMTS = [
    "%Y-%m-%d",      # 1993-12-15
    "%B %d, %Y",     # December 15, 1993
    "%d %B %Y",      # 15 December 1993
    "%b %d, %Y",     # Dec 15, 1993
    "%d %b %Y",      # 15 Dec 1993
    "%Y-%m",         # 1993-12
    "%Y",            # 1993
]


REQUEST_DELAY_RANGE = (1.5, 3.0)
REQUEST_COOLDOWN_EVERY = 40
REQUEST_COOLDOWN_RANGE = (8.0, 15.0)
SAVE_BATCH_SIZE = 5

request_lock = Lock()
persist_lock = Lock()
last_request_ts = 0.0
request_counter = 0
first_persisted_item = True


def parse_date_any(date_str: str):
    """
    Parse a date string from IMDb or JSON-LD formats into a standardized structure.

    Args:
        date_str (str): Raw date string, e.g., "December 15, 1993" or "1993-12-15".

    Returns:
        tuple: (ISO-format string, day, month). Returns (None, None, None) when parsing fails.
    """
    if not date_str:
        return (None, None, None)
    date_str = date_str.strip().split("T")[0]

    for fmt in DATE_FMTS:
        try:
            dt = datetime.strptime(date_str, fmt)
            iso = dt.strftime("%Y-%m-%d") if "%d" in fmt else (
                   dt.strftime("%Y-%m") if "%m" in fmt else dt.strftime("%Y"))
            day = dt.day if "%d" in fmt else None
            month = dt.month if "%m" in fmt else None
            return (iso, day, month)
        except Exception:
            continue

    match = re.search(
        r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})",
        date_str, re.I
    )
    if match:
        month = datetime.strptime(match.group(1), "%B").month
        return (f"{match.group(2)}-{month:02d}", None, month)

    return (None, None, None)


def parse_count(text: str):
    """
    Convert IMDb-style numerical strings such as '1.5M', '2.3K', or '1,234' into integer values.

    Args:
        text (str): Text fragment containing a number and optional multiplier (K, M).

    Returns:
        int: Parsed integer value, or None if parsing fails.
    """
    if not text:
        return None

    text = text.strip().replace(",", "").upper()
    match = re.match(r"^(\d+(?:\.\d+)?)([KM]?)$", text)
    if not match:
        match = re.search(r"(\d+(?:\.\d+)?)([KM]?)", text)
        if not match:
            return None

    value = float(match.group(1))
    suffix = match.group(2)
    if suffix == "M":
        value *= 1_000_000
    elif suffix == "K":
        value *= 1_000
    return int(value)


def uniq(seq: list):
    """
    Remove duplicates from a sequence while preserving order.

    Args:
        seq (list): Sequence of elements (e.g., names or tags).

    Returns:
        list: Sequence with unique elements, preserving original order.
    """
    seen, unique = set(), []
    for x in seq:
        if x and x not in seen:
            seen.add(x)
            unique.append(x)
    return unique

def from_text(text: str):
    """
    Extract awards information (Oscars, wins, nominations) from text.

    Args:
        text (str): Text block containing award mentions.

    Returns:
        tuple: (oscars_won, total_wins, total_nominations). Returns (None, None, None) if not found.
    """
    oscars_won = wins = nominations = None

    m = re.search(r"Won\s+(\d+)\s+Oscars?", text, re.I)
    if m:
        oscars_won = int(m.group(1))

    m = re.search(r"(\d{1,4})\s+wins\b", text, re.I)
    if m:
        wins = int(m.group(1).replace(",", ""))

    m = re.search(r"(\d{1,4})\s+nominations", text, re.I)
    if m:
        nominations = int(m.group(1).replace(",", ""))

    return oscars_won, wins, nominations


def score_near_metacritic_link(soup: BeautifulSoup):
    """
    Extract the Metascore value located near the '/criticreviews/' link on IMDb pages.

    Args:
        soup (BeautifulSoup): Parsed HTML document.

    Returns:
        int: Metascore value if detected, otherwise None.
    """
    a_tag = soup.find("a", href=lambda x: x and "criticreviews" in x)
    if not a_tag:
        return None

    node = a_tag.parent
    for _ in range(4):
        if not node:
            break
        badge = (node.find("span", class_=lambda c: c and "score-meta" in c)
                 or node.find(attrs={"data-testid": "metacritic-score"}))
        if badge:
            match = re.search(r"\d{1,3}", badge.get_text(strip=True))
            if match:
                return int(match.group(0))
        node = node.parent
    return None


def count_from_text(soup: BeautifulSoup):
    """
    Extract the number of critic reviews displayed near a Metascore label.

    Args:
        soup (BeautifulSoup): Parsed IMDb page.

    Returns:
        int: Number of reviews if available, otherwise None.
    """
    text = soup.get_text(" ", strip=True)
    m = re.search(r"Metascore.*?(\d[\d,]*)\s+reviews", text, re.I | re.S)
    if m:
        return int(m.group(1).replace(",", ""))
    m = re.search(r"(\d[\d,]*)\s+reviews.*?Metascore", text, re.I | re.S)
    if m:
        return int(m.group(1).replace(",", ""))
    return None


def polite_request_pause():
    """
    Serialize outbound requests and space them out to avoid server throttling.
    """
    global last_request_ts, request_counter

    with request_lock:
        min_delay = random.uniform(*REQUEST_DELAY_RANGE)
        now = time.perf_counter()
        wait_seconds = max(0.0, min_delay - (now - last_request_ts))

    if wait_seconds > 0:
        time.sleep(wait_seconds)

    cooldown = None
    with request_lock:
        last_request_ts = time.perf_counter()
        request_counter += 1
        if request_counter % REQUEST_COOLDOWN_EVERY == 0:
            cooldown = random.uniform(*REQUEST_COOLDOWN_RANGE)

    if cooldown:
        time.sleep(cooldown)


def initialize_output(path: Path):
    """
    Prepare the JSON output file for incremental writes.

    Args:
        path (Path): Path to the output JSON file.
    """
    global first_persisted_item
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("[\n", encoding="utf-8")
    first_persisted_item = True


def persist_movies(buffer: list, path: Path):
    """
    Append buffered movie dictionaries to the JSON array on disk.
    
    Args:
        buffer (list): List of movie dictionaries to persist.
        path (Path): Path to the output JSON file.
    
    Returns:
        int: Number of records persisted.
    """
    global first_persisted_item
    if not buffer:
        return 0

    batch_size = len(buffer)

    with persist_lock, path.open("a", encoding="utf-8") as fh:
        for record in buffer:
            serialized = json.dumps(record, ensure_ascii=False, indent=4)
            indented = "    " + serialized.replace("\n", "\n    ")
            if first_persisted_item:
                fh.write(indented)
                first_persisted_item = False
            else:
                fh.write(",\n" + indented)
    buffer.clear()
    return batch_size


def finalize_output(path: Path):
    """
    Close the JSON array structure in the output file.
    
    Args:
        path (Path): Path to the output JSON file.
    """
    with persist_lock, path.open("a", encoding="utf-8") as fh:
        fh.write("\n]\n")


def ensure_json_array_closed(path: Path):
    """
    Append a closing bracket to an array file if it was left open.
    
    Args:
        path (Path): Path to the JSON file.
    """
    if not path.exists():
        return
    content = path.read_text(encoding="utf-8")
    stripped = content.rstrip()
    if not stripped:
        return
    if stripped.endswith("]"):
        return
    path.write_text(stripped + "\n]\n", encoding="utf-8")


def parse_imdb_numeric(value: any):
    """
    Convert raw IMDb identifier to its integer component.
    
    Args:
        value (any): Raw IMDb identifier (e.g., 'tt1234567',  '1234567', 1234567).

    Returns:
        int: Integer IMDb ID, or None if parsing fails.    
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    raw = str(value).strip()
    if not raw or raw.lower() == "nan":
        return None
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return None
    return int(digits)
