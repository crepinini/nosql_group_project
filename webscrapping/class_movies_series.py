import random
import requests
import pandas as pd
from bs4 import BeautifulSoup
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json, re
from movies_series_functions import parse_date_any, parse_count, uniq, from_text, score_near_metacritic_link, count_from_text, polite_request_pause, initialize_output, ensure_json_array_closed, parse_imdb_numeric, finalize_output, persist_movies

CONTENT_PATH = "data"
WEB_DATA_FILENAME = "movies_data.json"
SOURCE_TITLES_PATH = r"webscrapping\imdb_db\database.csv"

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/117.0",

    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36",

]

class MovieImdb():
    """Class for scraping information with an IMDb ID."""

    def __init__(self, movieId: int, imdb_id: int):
        """
        Initialize the IMDb scraper for a given movie entry.

        Args:
            movieId: Internal identifier from the dataset.
            imdb_id: IMDb numeric identifier without the ``tt`` prefix.
        """
        self.movieId = movieId
        self.imdb_id = imdb_id
        self.url = f"https://www.imdb.com/title/tt{imdb_id:07d}/"

        try:
            self.page_content = self.get_content()
            self.jsonld = self.parse_json_ld()
            self.title = self.get_title() or self.jsonld.get("title")
            self.description = self.get_description() or self.jsonld.get("description")
            self.main_actors = self.get_main_actors() or self.jsonld.get("main_actors") 
            self.country = self.get_country()
            self.infos = self.get_movie_info()
            self.popularity = self.get_popularity()
            self.poster_url = self.get_poster_url() or self.jsonld.get("poster_url")
            self.parental_guide = self.get_parental_guide()
            self.duration = self.get_duration()
            self.trailer_url = self.get_trailer_url()
            self.genres = self.get_genres()
            self.rating = self.get_rating()
            self.directors = self.get_directors()
            self.writers = self.get_writers()
            self.year = self.get_year()
            self.imdb_type = self.get_imdb_type()
            self.release_date, self.release_day, self.release_month = self.get_release_date()
            self.imdb_link = self.url
            self.languages = self.get_languages()
            self.creator = self.get_creator()
            self.content_rating = self.get_content_rating()
            self.rating_count = self.get_rating_count()
            self.user_reviews_count, self.critic_reviews_count, self.reviews_count = self.get_reviews_counts()
            self.keywords = self.get_keywords()
            self.filming_locations = self.get_filming_locations()
            self.imdb_tt_id = f"tt{self.imdb_id:07d}"
            self.added_by_users_to_watchlist = self.get_added_by_users_to_watchlist()
            self.genre_interests = self.get_genre_interests()
            self.metascore, self.metascore_reviews_count = self.get_metascore_and_count()
            self.top_rated_rank = self.get_top_rated_rank()
            self.oscars_won, self.awards_wins, self.awards_nominations = self.get_awards_info()
            self.total_series_seasons, self.total_series_episodes = self.compute_series_totals()

            self.attributes = self.get_attributes_in_dict()
            print(f"Completed process movieId {self.movieId}, URL {self.url} {str(self.description)[0:3]} ({time.perf_counter()-timer:.2f} sec.)")

        except Exception as e:
            # print(f"Error processing movieId {self.movieId}, URL {self.url}: {e}")
            self.attributes = {
                "title": None,
                "description": None,
                "main_actors": [],
                "country": None,
                "duration": None,
                "popularity": None,
            "poster_url": None
        }

    def check_page(self):
        """
        Verify whether the IMDb title page responds successfully.

        Returns:
            bool: True when the HTTP response is OK, otherwise False.
        """
        get_headers = {'User-Agent': random.choice(USER_AGENTS)}
        try:
            response_page = requests.get(self.url, headers=get_headers)
            return response_page.ok
        except Exception as e:
            # print(f"Error checking page for movieId {self.movieId}, URL {self.url}: {e}")
            return False

    def get_headers(self):
        """
        Build the HTTP headers used for IMDb requests.

        Returns:
            dict: Header values mimicking a standard browser.
        """
        return {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Connection": "keep-alive",
        "DNT": "1",
        "Upgrade-Insecure-Requests": "1",
        "Referer": "https://www.imdb.com/"
        }
    
    def get_content(self):
        """
        Fetch and parse the IMDb title page HTML with throttling and retry handling.

        Returns:
            BeautifulSoup: Parsed HTML document for the title.
        """
        get_headers = {
            "User-Agent": random.choice(USER_AGENTS),
            "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Connection": "keep-alive",
            "DNT": "1",
            "Upgrade-Insecure-Requests": "1",
            "Referer": "https://www.imdb.com/",
        }

        for attempt in range(5):
            polite_request_pause()
            response_page = requests.get(self.url, headers=get_headers, timeout=20)
            html = response_page.text

            if response_page.status_code in (429, 503) or "captcha" in html.lower():
                backoff = random.uniform(15, 30) * (attempt + 1)
                print(f"[!] IMDb rate limit encountered for {self.url}. Backing off for {backoff:.1f} seconds.")
                time.sleep(backoff)
                continue

            if response_page.status_code == 403 or "Request blocked" in html:
                backoff = random.uniform(120, 180)
                print(f"[!] IMDb blocked access for {self.url}. Cooling down for {backoff:.1f} seconds.")
                time.sleep(backoff)
                continue

            if response_page.ok and len(html.strip()) > 500:
                return BeautifulSoup(html, "html.parser")

            print(f"[!] Empty or invalid content for {self.url} (status {response_page.status_code}). Retrying...")
            time.sleep(random.uniform(8, 16))

        raise RuntimeError(f"Failed to fetch valid content from IMDb for {self.url}")
    
    def parse_iso8601_minutes(self, s):
        """
        Convert an ISO 8601 duration string to minutes.

        Args:
            s: Duration string such as ``PT1H30M``.

        Returns:
            int: Duration in minutes, or None when parsing fails.
        """
        if not s:
            return None
        m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?", s)
        if not m:
            return None
        h = int(m.group(1) or 0)
        mn = int(m.group(2) or 0)
        return h * 60 + mn

    def parse_json_ld(self):
        """
        Parse the JSON-LD script block for core metadata.

        Returns:
            dict: Normalized metadata extracted from JSON-LD.
        """
        try:
            blocks = self.page_content.find_all("script", {"type": "application/ld+json"})
            data = None
            for b in blocks:
                if not b.string:
                    continue
                candidate = json.loads(b.string)
                if isinstance(candidate, list):
                    for c in candidate:
                        if isinstance(c, dict) and c.get("@type") in {"Movie", "TVSeries", "VideoObject", "TVEpisode", "VideoGame"}:
                            data = c
                            break
                elif isinstance(candidate, dict) and candidate.get("@type") in {"Movie", "TVSeries", "VideoObject", "TVEpisode", "VideoGame"}:
                    data = candidate
                if data:
                    break
            if not data:
                return {}

            trailer_url = None
            trailer = data.get("trailer")
            if isinstance(trailer, dict):
                trailer_url = trailer.get("embedUrl") or trailer.get("url")
            elif isinstance(trailer, list) and trailer:
                t = trailer[0]
                if isinstance(t, dict):
                    trailer_url = t.get("embedUrl") or t.get("url")

            genres = data.get("genre")
            if isinstance(genres, str):
                genres = [genres]
            if genres is None:
                genres = []

            rating = None
            agg = data.get("aggregateRating")
            if isinstance(agg, dict):
                rv = agg.get("ratingValue")
                try:
                    rating = float(rv) if rv is not None else None
                except:
                    rating = None

            directors = []
            d = data.get("director")
            if isinstance(d, dict):
                nm = d.get("name")
                if nm:
                    directors.append(nm)
            elif isinstance(d, list):
                for it in d:
                    if isinstance(it, dict) and it.get("name"):
                        directors.append(it["name"])

            writers = []
            for key in ("writer", "author", "creator"):
                v = data.get(key)
                if isinstance(v, dict):
                    if v.get("@type") == "Person" and v.get("name"):
                        writers.append(v["name"])
                elif isinstance(v, list):
                    for it in v:
                        if isinstance(it, dict) and it.get("@type") == "Person" and it.get("name"):
                            writers.append(it["name"])
            writers = uniq(writers)

            year = None
            for key in ("datePublished", "startDate", "dateCreated"):
                val = data.get(key)
                if isinstance(val, str):
                    m = re.search(r"\d{4}", val)
                    if m:
                        year = int(m.group(0))
                        break

            languages = data.get("inLanguage")
            if isinstance(languages, str):
                languages = [languages]
            if languages is None:
                languages = []

            kw = data.get("keywords")
            if isinstance(kw, str):
                keywords = [k.strip() for k in kw.split(",") if k.strip()]
            elif isinstance(kw, list):
                keywords = [str(k).strip() for k in kw if str(k).strip()]
            else:
                keywords = []

            companies = []
            pc = data.get("productionCompany") or data.get("productionCompanies")
            if isinstance(pc, dict) and pc.get("name"):
                companies.append(pc["name"])
            elif isinstance(pc, list):
                for it in pc:
                    if isinstance(it, dict) and it.get("name"):
                        companies.append(it["name"])

            creators = []
            cr = data.get("creator")
            if isinstance(cr, dict) and cr.get("@type") == "Person" and cr.get("name"):
                creators.append(cr["name"])
            elif isinstance(cr, list):
                for it in cr:
                    if isinstance(it, dict) and it.get("@type") == "Person" and it.get("name"):
                        creators.append(it["name"])

            rating_count = None
            agg = data.get("aggregateRating")
            if isinstance(agg, dict):
                rc = agg.get("ratingCount")
                try:
                    rating_count = int(rc) if rc is not None else None
                except:
                    rating_count = None

            out = {
                "title": data.get("name"),
                "description": data.get("description"),
                "content_rating": data.get("contentRating"),
                "duration": self.parse_iso8601_minutes(data.get("duration")),
                "poster_url": data.get("image"),
                "main_actors": [a.get("name") for a in (data.get("actor") or []) if isinstance(a, dict)],
                "trailer_url": trailer_url,
                "genres": genres,
                "rating": rating,
                "rating_count": rating_count,
                "directors": directors,
                "writers": writers,
                "creators": creators,
                "year": year,
                "imdb_type": data.get("@type"),
                "languages": languages,
                "keywords": keywords,
            }

            return out
        except Exception:
            return {}


    def get_title(self):
        """
        Extract the title from the IMDb page.

        Returns:
            str: Title text or None when absent.
        """
        try:
            title_element = self.page_content.find("span", class_="hero__primary-text", attrs={"data-testid": "hero__primary-text"})
            title = title_element.text.strip() if title_element else None
            return title
        except Exception as e:
            # print(f"An error occurred while extracting the title for movieId {self.movieId}: {e}")
            return None
        
    def get_description(self):
        """
        Extract the synopsis from the IMDb page.

        Returns:
            str: Description text or None when missing.
        """
        try:
            description_tag = self.page_content.find("span", {"data-testid": "plot-l"})
            if not description_tag:
                description_tag = self.page_content.find("span", {"data-testid": "plot-xs_to_m"})
            if description_tag:
                return description_tag.text.strip()
            else:
                return None
        except Exception as e:
            # print(f"An error occurred while extracting the description for movieId {self.movieId}: {e}")
            return None
        
    def get_main_actors(self):
        """
        Extract the main actors listed on the title page.

        Returns:
            list: Actor names in the order displayed.
        """
        try:
            actors_tags = self.page_content.find_all("a", {"data-testid": "title-cast-item__actor"})
            main_actors = [actor.text.strip() for actor in actors_tags]
            return main_actors
        except Exception as e:
            # print(f"An error occurred while extracting the main actors for movieId {self.movieId}: {e}")
            return []
    
    def get_content_rating(self):
        """
        Retrieve the content rating for the title.

        Returns:
            str: Rating label (e.g. ``PG-13``) or previously parsed parental guide.
        """
        if self.jsonld.get("content_rating"):
            return self.jsonld["content_rating"]
        try:
            li = (self.page_content.find("li", {"data-testid": "title-details-certificate"}) or
                self.page_content.find("li", {"data-testid": "storyline-certificate-item"}) or 
                self.page_content.find("a", {"data-testid": "storyline-certificate"}))
            if not li:
                return self.parental_guide
            return li.get_text(strip=True)
        except:
            return self.parental_guide
        
    def get_parental_guide(self):
        """
        Retrieve the parental guide label from the parsed DOM.

        Returns:
            str: Label text when available.
        """
        if self.jsonld.get("parental_guide"):
            return self.jsonld["parental_guide"]
        try:
            guide = (self.page_content.find("a", {"data-testid": "storyline-certificate"}) or
                    self.page_content.find("li", {"data-testid": "storyline-certificate-item"}) or
                    self.page_content.find("li", {"data-testid": "title-details-certificate"}))
            return guide.get_text(strip=True) if guide else None
        except Exception:
            return None

    def get_duration(self):
        """
        Retrieve the runtime in minutes using JSON-LD or DOM fallback.

        Returns:
            int: Runtime in minutes when detected.
        """
        if self.jsonld.get("duration") is not None:
            return self.jsonld["duration"]
        try:
            li = self.page_content.find("li", {"data-testid": "title-techspec_runtime"}) \
                or self.page_content.find("li", {"data-testid": "title-details-techspec_runtime"})
            if not li:
                return None
            text = li.get_text(strip=True)
            h = 0; m = 0
            mh = re.search(r"(\d+)\s*h", text)
            mm = re.search(r"(\d+)\s*m", text)
            if mh: h = int(mh.group(1))
            if mm: m = int(mm.group(1))
            return h * 60 + m if (h or m) else None
        except Exception:
            return None

    def get_country(self):
        """
        Retrieve the country of origin from the DOM.

        Returns:
            str: Country name when available.
        """
        try:
            bloc = self.page_content.find("li", {"data-testid": "title-details-origin"})
            if bloc:
                a = bloc.find("a")
                if a and a.get_text(strip=True):
                    return a.get_text(strip=True)
            a = self.page_content.find("a", href=lambda x: x and "country_of_origin" in x)
            return a.get_text(strip=True) if a else None
        except Exception:
            return None

    def get_genres(self):
        """
        Retrieve the genre list from JSON-LD or the DOM.

        Returns:
            list: Genre labels in display order.
        """
        if self.jsonld.get("genres"):
            return self.jsonld["genres"]
        try:
            block = (self.page_content.find("div", {"data-testid": "genres"}) or
                    self.page_content.find("li", {"data-testid": "storyline-genres"}))
            if not block:
                return []
            links = block.find_all("a")
            genres = [a.get_text(strip=True) for a in links if a.get_text(strip=True)]
            genres = [g for g in genres if g.lower() not in {"genres"}]
            return genres
        except Exception:
            return []

    def get_rating(self):
        """
        Retrieve the average user rating.

        Returns:
            float: Rating value when available.
        """
        if self.jsonld.get("rating") is not None:
            return self.jsonld["rating"]
        try:
            node = self.page_content.find("div", {"data-testid": "hero-rating-bar__aggregate-rating__score"})
            if not node:
                return None
            m = re.search(r"(\d+(?:\.\d+)?)", node.get_text(strip=True))
            return float(m.group(1)) if m else None
        except Exception:
            return None

    def get_directors(self):
        """
        Retrieve the list of credited directors.

        Returns:
            list: Director names without duplicates.
        """
        if self.jsonld.get("directors"):
            return self.jsonld["directors"]
        try:
            dirs = []
            for li in self.page_content.find_all("li", {"data-testid": "title-pc-principal-credit"}):
                label = li.find("span")
                if label and re.search(r"Director(s)?", label.get_text(strip=True), re.I):
                    for a in li.find_all("a"):
                        nm = a.get_text(strip=True)
                        if nm:
                            dirs.append(nm)
            return list(dict.fromkeys(dirs))
        except Exception:
            return []

    def get_writers(self):
        """
        Retrieve the list of credited writers.

        Returns:
            list: Writer names without duplicates.
        """
        if self.jsonld.get("writers"):
            return self.jsonld["writers"]
        try:
            wr = []
            for li in self.page_content.find_all("li", {"data-testid": "title-pc-principal-credit"}):
                if not re.search(r"\bWriter(s)?\b", li.get_text(" ", strip=True), re.I):
                    continue
                for a in li.find_all("a", href=True):
                    if "/name/" in a["href"]:
                        nm = a.get_text(strip=True)
                        if nm and nm.lower() not in {"wga", "wga screenwriters"}:
                            wr.append(nm)
            return list(dict.fromkeys(wr))
        except Exception:
            return []

    def get_year(self):
        """
        Retrieve the primary release year.

        Returns:
            int: Four-digit release year when detected.
        """
        if self.jsonld.get("year") is not None:
            return self.jsonld["year"]
        try:
            y = None
            if isinstance(self.infos, dict):
                y = self.infos.get("release_year")
            if y:
                m = re.search(r"\d{4}", str(y))
                if m:
                    return int(m.group(0))
            meta = self.page_content.find("ul", {"data-testid": "hero-title-block__metadata"})
            if meta:
                for li in meta.find_all("li"):
                    t = li.get_text(strip=True)
                    if re.fullmatch(r"\d{4}", t):
                        return int(t)
            a = self.page_content.find("a", href=lambda x: x and "releaseinfo" in x)
            if a:
                m = re.search(r"\d{4}", a.get_text(strip=True))
                if m:
                    return int(m.group(0))
            return None
        except Exception:
            return None

    def get_release_date(self):
        """
        Retrieve the release date using JSON-LD or DOM fallback.

        Returns:
            tuple: ISO date, day, month.
        """
        try:
            blocks = self.page_content.find_all("script", {"type": "application/ld+json"})
            for b in blocks:
                if not b.string:
                    continue
                data = json.loads(b.string)
                if isinstance(data, list):
                    data = next((d for d in data if isinstance(d, dict) and d.get("@type") in {"Movie","TVSeries","TVEpisode"}), None)
                if isinstance(data, dict) and data.get("@type") in {"Movie","TVSeries","TVEpisode"}:
                    for key in ("datePublished", "startDate", "dateCreated"):
                        iso, day, month = parse_date_any(data.get(key))
                        if iso or day or month:
                            return iso, day, month
        except Exception:
            pass
        try:
            li = self.page_content.find("li", {"data-testid": "title-details-releasedate"})
            if li:
                a = li.find("a")
                txt = (a.get_text(strip=True) if a else li.get_text(strip=True)).split("(")[0].strip()
                iso, day, month = parse_date_any(txt)
                return iso, day, month
        except Exception:
            pass
        return None, None, None

    def get_imdb_type(self):
        """
        Retrieve the IMDb content type label.

        Returns:
            str: Type text such as ``TV Series`` or ``Movie``.
        """
        if self.jsonld.get("imdb_type"):
            return self.jsonld["imdb_type"]
        try:
            li = self.page_content.find("li", {"data-testid": "title-details-title-type"})
            if li:
                txt = li.get_text(strip=True)
                return txt
            meta = self.page_content.find("li", {"data-testid": "hero-title-block__series-link"})
            if meta:
                return meta.get_text(strip=True)
            return None
        except Exception:
            return None


    def get_movie_info(self):
        """
        Collect basic information from the hero section.

        Returns:
            dict: Includes title, original_title, release_year, parental_guide, duration_min.
        """
        try:
            movie_info_section = self.page_content.find("div", class_="sc-b7c53eda-0 dUpRPQ")
            title = None
            original_title = None
            release_year = None
            parental_guide = None
            duration = None

            title_tag = movie_info_section.find("span", class_="hero__primary-text")
            if title_tag:
                title = title_tag.text.strip()

            original_title_tag = movie_info_section.find("div", class_="sc-d8941411-1 fTeJrK")
            if original_title_tag:
                original_title = original_title_tag.text.strip().split("Original title: ")[-1]

            release_year_tag = movie_info_section.find("a", href=lambda x: x and "releaseinfo" in x)
            if release_year_tag:
                release_year = release_year_tag.text.strip()

            parental_guide_tag = movie_info_section.find("a", href=lambda x: x and "parentalguide" in x)
            if parental_guide_tag:
                parental_guide = parental_guide_tag.text.strip()

            duration_tag = movie_info_section.find_all("li", class_="ipc-inline-list__item")
            if len(duration_tag) >= 3:
                duration = duration_tag[-1].text.strip()
                
                try:
                    hours, minutes = duration.split('h')
                    hours = int(hours.replace(" ", "")) * 60
                    minutes = minutes.replace("m", "")
                    minutes = int(minutes.replace(" ", ""))
                    duration = hours + minutes
                except:
                    try: 
                        hours = duration.replace("h", "")
                        minutes = int(hours.replace(" ", "")) *60
                        duration = minutes
                    except:
                        minutes = duration.replace("m", "")
                        minutes = int(minutes.replace(" ", ""))
                        duration = minutes

            return {
                "title": title,
                "original_title": original_title,
                "release_year": release_year,
                "parental_guide": parental_guide,
                "duration_min": duration
            }
        except Exception as e:
            # print(f"An error occurred while extracting movie info for movieId {self.movieId}: {e}")
            return {
                "title": None,
                "original_title": None,
                "release_year": None,
                "parental_guide": None,
                "duration_min": None
            }
    
    def get_popularity(self):
        """
        Retrieve the popularity rank exposed on the title page.

        Returns:
            int: Popularity value when present.
        """
        try:
            node = (self.page_content.find("div", {"data-testid": "hero-rating-bar__popularity__score"}) or
                    self.page_content.find("a", {"data-testid": "hero-rating-bar__popularity__score"}))
            if not node:
                return None
            
            digits = re.sub(r"[^\d]", "", node.get_text(strip=True))
            return int(digits) if digits else None
        except Exception:
            return None


    def get_poster_url(self):
        """
        Retrieve the poster image URL.

        Returns:
            str: Poster URL when available.
        """
        try:
            poster_div = self.page_content.find("div", {"data-testid": "hero-media__poster"})
            poster_img = poster_div.find("img") if poster_div else None
            poster_url = poster_img["src"] if poster_img else None
            return poster_url
        except Exception as e:
            #print(f"An error occurred while extracting the poster URL for movieId {self.movieId}: {e}")
            return None

    def get_trailer_url(self):
        """
        Retrieve the trailer URL from JSON-LD or DOM anchors.

        Returns:
            str: Trailer URL when detected.
        """
        if self.jsonld.get("trailer_url"):
            return self.jsonld["trailer_url"]
        try:
            slate = self.page_content.find("div", {"data-testid": "hero-media__slate"})
            if slate:
                a = slate.find("a")
                if a and a.get("href"):
                    href = a["href"]
                    return ("https://www.imdb.com" + href) if href.startswith("/") else href

            a = self.page_content.find("a", href=lambda x: x and x.startswith("/video/"))
            if a and a.get("href"):
                href = a["href"]
                return ("https://www.imdb.com" + href) if href.startswith("/") else href

            return None
        except Exception:
            return None

    def get_languages(self):
        """
        Retrieve the list of spoken languages from JSON-LD or DOM.

        Returns:
            list: Language names in the order displayed.
        """
        if self.jsonld.get("languages"):
            return self.jsonld["languages"]
        try:
            li = self.page_content.find("li", {"data-testid": "title-details-languages"})
            if not li:
                li = self.page_content.find("a", href=lambda x: x and "languages" in x)
                if not li:
                    return []
                return [li.get_text(strip=True)]
            return [a.get_text(strip=True) for a in li.find_all("a") if a.get_text(strip=True)]
        except Exception:
            return []

    def get_creator(self):
        """
        Retrieve credited creators distinct from writers.

        Returns:
            list: Creator names without duplicates.
        """
        if self.jsonld.get("creators"):
            return self.jsonld["creators"]
        try:
            creators = []
            for li in self.page_content.find_all("li", {"data-testid": "title-pc-principal-credit"}):
                label = li.find("span")
                if label and re.search(r"Creator(s)?", label.get_text(strip=True), re.I):
                    for a in li.find_all("a"):
                        nm = a.get_text(strip=True)
                        if nm:
                            creators.append(nm)
            return list(dict.fromkeys(creators))
        except Exception:
            return []

    def get_rating_count(self):
        """
        Retrieve the total number of user ratings.

        Returns:
            int: Ratings count when available.
        """
        if self.jsonld.get("rating_count") is not None:
            return self.jsonld["rating_count"]
        try:
            node = self.page_content.find("div", {"data-testid": "hero-rating-bar__aggregate-rating__score"})
            if node:
                cont = node.parent
                if cont:
                    cnt = cont.find("div", {"data-testid": "hero-rating-bar__aggregate-rating__count"})
                    if cnt:
                        return parse_count(cnt.get_text(strip=True))
            anytext = self.page_content.get_text(" ", strip=True)
            m = re.search(r"(\d[\d,.]*\s*[KM]?)\s+ratings", anytext, re.I)
            if m:
                return parse_count(m.group(1))
            return None
        except Exception:
            return None

    def get_reviews_counts(self):
        """
        Retrieve user and critic review counts plus total.

        Returns:
            tuple: User, critic, total counts.
        """
        try:
            txt = self.page_content.get_text(" ", strip=True)
            u = None
            c = None
            mu = re.search(r"(\d[\d,.]*\s*[KM]?)\s+User reviews", txt, re.I)
            if mu:
                u = parse_count(mu.group(1))
            mc = re.search(r"(\d[\d,.]*\s*[KM]?)\s+Critic reviews", txt, re.I)
            if mc:
                c = parse_count(mc.group(1))
            total = (u or 0) + (c or 0) if (u is not None or c is not None) else None
            return u, c, total
        except Exception:
            return None, None, None

    def get_keywords(self):
        """
        Retrieve keywords from JSON-LD or the storyline section.

        Returns:
            list: Keyword labels with duplicates removed.
        """
        if self.jsonld.get("keywords"):
            return self.jsonld["keywords"]
        try:
            blk = (self.page_content.find("div", {"data-testid": "storyline-plot-keywords"}) or
                   self.page_content.find("li", {"data-testid": "storyline-plot-keywords"}))
            kws = []
            if blk:
                for a in blk.find_all("a", href=True):
                    if "/keyword/" in a["href"] or "keywords=" in a["href"]:
                        t = a.get_text(strip=True)
                        if t:
                            kws.append(t)
            if not kws:
                for a in self.page_content.find_all("a", href=True):
                    if "/keyword/" in a["href"] and a.get_text(strip=True):
                        kws.append(a.get_text(strip=True))
                    if len(kws) >= 10:
                        break
            return list(dict.fromkeys(kws))
        except Exception:
            return []

    def get_filming_locations(self):
        """
        Retrieve filming locations from the title details.

        Returns:
            list: Location names when available.
        """
        try:
            li = self.page_content.find("li", {"data-testid": "title-details-filminglocations"})
            if li:
                return [a.get_text(strip=True) for a in li.find_all("a") if a.get_text(strip=True)]
            a = self.page_content.find("a", href=lambda x: x and "locations" in x)
            return [a.get_text(strip=True)] if a else []
        except Exception:
            return []
    
    def get_added_by_users_to_watchlist(self):
        """
        Retrieve the watchlist additions count parsed from localized text.

        Returns:
            int: Number of users or None when unavailable.
        """
        try:
            txt = self.page_content.get_text(" ", strip=True)
            m = re.search(r"Added by\s+([\d.,KM]+)\s+users", txt, re.I)
            if not m:
                m = re.search(r"Ajout[ée] par\s+([\d.,KM]+)\s*M?\s*d'?utilisateurs", txt, re.I)
            if m:
                return parse_count(m.group(1))
            return None
        except Exception:
            return None

    def get_genre_interests(self):
        """
        Retrieve tagged genre interests displayed near the header.

        Returns:
            list: Unique interest tags without UI labels.
        """
        try:
            tags = []
            for div in self.page_content.find_all("div", {"data-testid": re.compile(r"genres", re.I)}):
                for a in div.find_all("a"):
                    t = a.get_text(strip=True)
                    if t:
                        tags.append(t)
            if not tags:
                for node in self.page_content.find_all(class_=lambda c: c and "ipc-chip__text" in c):
                    t = node.get_text(strip=True)
                    if t:
                        tags.append(t)
            blacklist = {"Add to Watchlist", "Mark as watched", "Rate", "VIDEOS", "PHOTOS"}
            tags = [t for t in tags if t not in blacklist and len(t) <= 40]
            return list(dict.fromkeys(tags))
        except Exception:
            return []


    def get_metascore_and_count(self):
        """
        Retrieve Metascore and the number of critic reviews.

        Returns:
            tuple: Metascore value and critic review count.
        """

        score = score_near_metacritic_link(self.page_content)
        if score is None:
            txt = self.page_content.get_text(" ", strip=True)
            m = re.search(r"(\d{1,3})\s+Metascore", txt, re.I)
            if not m:
                m = re.search(r"Metascore\s+(\d{1,3})", txt, re.I)
            if m:
                score = int(m.group(1))
        count = count_from_text(self.page_content)

        if score is not None and count is not None:
            return score, count

        try:
            headers = {
                "User-Agent": random.choice(USER_AGENTS),
                "Accept-Language": "en-US,en;q=0.9", 
                "Referer": self.url,
            }
            r = requests.get(self.url.rstrip("/") + "/criticreviews/", headers=headers, timeout=15)
            soup = BeautifulSoup(r.text, "html.parser")

            sc = score_near_metacritic_link(soup)
            if sc is None:
                t = soup.get_text(" ", strip=True)
                m = re.search(r"(\d{1,3})\s+Metascore", t, re.I)
                if not m:
                    m = re.search(r"Metascore\s+(\d{1,3})", t, re.I)
                sc = int(m.group(1)) if m else None

            ct = count_from_text(soup)
            return sc, ct
        except Exception:
            return score, count  

    def get_top_rated_rank(self):
        """
        Retrieve the top rated rank when exposed on the title page.

        Returns:
            int: Rank number or None when absent.
        """
        try:
            txt = self.page_content.get_text(" ", strip=True)
            m = re.search(r"Top rated movie\s*#\s*(\d+)", txt, re.I)
            if m:
                return int(m.group(1))
            for a in self.page_content.find_all("a"):
                t = a.get_text(strip=True)
                if t and "Top rated movie" in t:
                    mm = re.search(r"#\s*(\d+)", t)
                    if mm:
                        return int(mm.group(1))
            return None
        except Exception:
            return None


    def get_awards_info(self):
        """
        Retrieve Oscar and awards counts from the title page or awards page.

        Returns:
            tuple: Oscars won, wins, nominations.
        """
        try:
            txt = self.page_content.get_text(" ", strip=True)
            oscars_won, wins, nominations = from_text(txt)
            if oscars_won is not None and wins is not None and nominations is not None:
                return oscars_won, wins, nominations

            headers = {
                "User-Agent": random.choice(USER_AGENTS),
                "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
                "Referer": self.url,
            }
            r = requests.get(self.url.rstrip("/") + "/awards/", headers=headers, timeout=15)
            soup = BeautifulSoup(r.text, "html.parser")
            oscars_won, wins, nominations = from_text(soup.get_text(" ", strip=True))
            return oscars_won, wins, nominations

        except Exception:
            return None, None, None
        
    def get_series_structure(self):
        """
        Build a per-season episode map for series titles.

        Returns:
            dict: Structure with total seasons/episodes and per-season details.
        """
        struct = {"total_seasons": None, "seasons": {}}

        total = self.get_total_seasons()
        if isinstance(total, int) and total > 0:
            for s in range(1, total + 1):
                eps = self.get_episodes_for_season(s)
                struct["seasons"][str(s)] = {
                    "episodes_count": len(eps),
                    "episodes": { str(ep["episode_number"]): ep for ep in eps }
                }
                time.sleep(0.3)
            struct["total_seasons"] = total
            struct["total_episodes"] = sum(v["episodes_count"] for v in struct["seasons"].values())
            return struct

        max_try = 30
        last_with_eps = 0
        consecutive_empty = 0

        for s in range(1, max_try + 1):
            eps = self.get_episodes_for_season(s)
            if eps:
                struct["seasons"][str(s)] = {
                    "episodes_count": len(eps),
                    "episodes": { str(ep["episode_number"]): ep for ep in eps }
                }
                last_with_eps = s
                consecutive_empty = 0
            else:
                consecutive_empty += 1
                if consecutive_empty >= 2:
                    break
            time.sleep(0.3)

        struct["total_seasons"] = last_with_eps if last_with_eps > 0 else None
        struct["total_episodes"] = sum(v["episodes_count"] for v in struct["seasons"].values())
        return struct

    def get_episodes_page_soup(self, season: int = None):
        """
        Fetch the episodes page soup for a given season.

        Args:
            season: Season number or None for the default page.

        Returns:
            BeautifulSoup: Parsed episodes page.
        """
        base = self.url.rstrip("/") + "/episodes"
        url = f"{base}?season={season}" if season else base
        r = requests.get(url, headers=self.get_headers(), timeout=20)
        r.raise_for_status()
        return BeautifulSoup(r.text, "html.parser")

    def jsonld_number_of_seasons(self):
        """
        Read numberOfSeasons from JSON-LD when available.

        Returns:
            int: Number of seasons or None when missing.
        """
        try:
            blocks = self.page_content.find_all("script", {"type": "application/ld+json"})
            for b in blocks:
                if not b.string:
                    continue
                cand = json.loads(b.string)
                cands = cand if isinstance(cand, list) else [cand]
                for obj in cands:
                    if isinstance(obj, dict) and obj.get("@type") in {"TVSeries", "TVSeason"}:
                        n = obj.get("numberOfSeasons")
                        if n is None:
                            continue
                        if isinstance(n, (int, float)) and int(n) > 0:
                            return int(n)
                        m = re.search(r"\d+", str(n))
                        if m:
                            return int(m.group(0))
            return None
        except Exception:
            return None

    def get_total_seasons(self):
        """
        Determine the total number of seasons for series titles.

        Returns:
            int: Number of seasons or None when not a series.
        """
        try:
            if not re.search(r"TV\s*(Series|Mini)", str(self.get_imdb_type() or ""), re.I):
                return None

            n = self.jsonld_number_of_seasons()
            if isinstance(n, int) and n > 0:
                return n

            soup = self.get_episodes_page_soup()
            seasons = set()
            sel = (soup.find("select", id="bySeason")
                   or soup.find("select", {"name": "season"})
                   or soup.find("select", {"data-testid": re.compile("season", re.I)}))
            if sel:
                for opt in sel.find_all("option"):
                    txt = (opt.get("value") or opt.get_text() or "").strip()
                    m = re.search(r"\d+", txt)
                    if m:
                        seasons.add(int(m.group(0)))
            if not seasons:
                for a in soup.find_all("a", href=True):
                    m = re.search(r"/episodes\?season=(\d+)", a["href"])
                    if m:
                        seasons.add(int(m.group(1)))
            if seasons:
                return max(seasons)

            last_with_eps = 0
            consecutive_empty = 0
            for s in range(1, 30):
                if self.count_episodes_in_season(s) > 0:
                    last_with_eps = s
                    consecutive_empty = 0
                else:
                    consecutive_empty += 1
                    if consecutive_empty >= 2:
                        break
                time.sleep(0.2)
            return last_with_eps or None
        except Exception:
            return None

    def count_episodes_in_season(self, season: int):
        """
        Count distinct episode identifiers for a given season.

        Args:
            season: Season number to inspect.

        Returns:
            int: Number of episodes found for the season.
        """
        try:
            soup = self.get_episodes_page_soup(season)
            containers = soup.select('[data-testid="episodes-episode-container"], [data-testid="episode"]')
            if not containers:
                eplist = soup.find("div", class_=re.compile(r"\blist\s+detail\s+eplist\b"))
                if eplist:
                    containers = eplist.find_all("div", class_=re.compile(r"\blist_item\b"))
            seen = set()
            for node in containers:
                a = node.find("a", href=re.compile(r"/title/tt\d+"))
                if not a or not a.get("href"):
                    continue
                m = re.search(r"/title/(tt\d+)", a["href"])
                if m:
                    seen.add(m.group(1))
            return len(seen)
        except Exception:
            return 0

    def title_counts_totals(self):
        """
        Infer total seasons and episodes by scanning the title page.

        Returns:
            tuple: Seasons and episodes derived from text.
        """
        total_seasons = self.jsonld_number_of_seasons()

        text = self.page_content.get_text(" ", strip=True)

        m_ep = re.search(r"Episode guide\s*(\d{1,4})", text, re.I)
        if not m_ep:
            m_ep = re.search(r"\bEpisodes?\s+(\d{1,4})\b", text, re.I)
        total_episodes = int(m_ep.group(1)) if m_ep else None

        if not total_seasons:
            m_sea = re.search(r"\b(\d{1,3})\s+seasons?\b", text, re.I)  
            total_seasons = int(m_sea.group(1)) if m_sea else None

        return total_seasons, total_episodes

    def compute_series_totals(self):
        """
        Compute overall season and episode counts for series titles.

        Returns:
            tuple: Total seasons and episodes.
        """
        if not re.search(r"TV\s*(Series|Mini)", str(self.imdb_type or ""), re.I):
            return None, None

        ts, te = self.title_counts_totals()

        if ts and te:
            return ts, te

        if not ts:
            ts = self.get_total_seasons()

        if ts and not te:
            total = 0
            for s in range(1, ts + 1):
                total += self.count_episodes_in_season(s)
                time.sleep(0.2)
            te = total

        return (ts or None), (te or None)



    def get_attributes_in_dict(self):
        """
        Build the attribute dictionary consumed by downstream pipelines.

        Returns:
            dict: Movie fields assembled from scraped data.
        """
        return {
            # "movieId": self.movieId,
            "imdb_id": self.imdb_tt_id,             
            "title": self.title,
            "description": self.description,
            "main_actors": self.main_actors,
            "country": self.country,
            "content_rating": self.content_rating, 
            "duration": self.duration,
            "popularity": self.popularity,
            "poster_url": self.poster_url,
            "trailer_url": self.trailer_url,
            "genres": self.genres,
            "genre_interests": self.genre_interests, 
            "added_by_users_to_watchlist": self.added_by_users_to_watchlist,
            "rating": self.rating,
            "rating_count": self.rating_count,      
            "directors": self.directors,
            "writers": self.writers,
            "creator": self.creator,                
            "languages": self.languages,           
            "keywords": self.keywords,              
            "year": self.year,
            "release_date": self.release_date,
            "release_day": self.release_day,
            "release_month": self.release_month,
            "imdb_type": self.imdb_type,
            "imdb_link": self.imdb_link,
            "reviews_count_user": self.user_reviews_count,   
            "reviews_count_critic": self.critic_reviews_count,
            "reviews_count": self.reviews_count,             
            "metascore": self.metascore,                         
            "metascore_reviews_count": self.metascore_reviews_count, 
            "top_rated_rank": self.top_rated_rank,           
            "oscars_won": self.oscars_won,                   
            "awards_wins": self.awards_wins,                
            "awards_nominations": self.awards_nominations,
            "series_total_seasons": self.total_series_seasons,
            "series_total_episodes": self.total_series_episodes,  
        }

def scrape_movie_data(task: tuple[int, int]):
    """
    Orchestrate scraping for a single movie row.

    Args:
        task: Tuple of (synthetic movie identifier, IMDb numeric id).

    Returns:
        tuple: Attributes dict, IMDb URL, and movieId.
    """
    movieId, imdbId = task
    time.sleep(random.uniform(1.3, 3.1))
    movie = MovieImdb(movieId, imdbId)
    return movie.attributes, movie.url, movieId


# Load data
titles_df = pd.read_csv(SOURCE_TITLES_PATH)
print(titles_df.head())

records = titles_df.to_dict(orient="records")
output_path = Path(CONTENT_PATH) / WEB_DATA_FILENAME

ensure_json_array_closed(output_path)

existing_records = []
existing_ids = set()
existing_numeric_ids = []

if output_path.exists() and output_path.stat().st_size > 0:
    try:
        existing_records = json.loads(output_path.read_text(encoding="utf-8"))
        existing_ids = {
            row.get("imdb_id")
            for row in existing_records
            if isinstance(row, dict) and row.get("imdb_id")
        }
        for row in existing_records:
            raw_id = row.get("_id")
            if isinstance(raw_id, str) and raw_id.startswith("ms"):
                tail = raw_id[2:]
                if tail.isdigit():
                    existing_numeric_ids.append(int(tail))
        print(f"Loaded {len(existing_ids)} existing movies from {output_path}.")
    except Exception as exc:
        print(f"[!] Could not read existing data ({exc}). Starting with an empty store.")
        existing_records = []
        existing_ids = set()
        existing_numeric_ids = []

initialize_output(output_path)
if existing_records:
    persist_movies(list(existing_records), output_path)
    existing_records = []

scheduled_ids = set()
movies_to_process = []

for idx, row in enumerate(records, start=1):
    imdb_numeric = parse_imdb_numeric(row.get("imdbId"))
    if imdb_numeric is None:
        continue
    tt_id = f"tt{imdb_numeric:07d}"
    if tt_id in existing_ids or tt_id in scheduled_ids:
        continue
    scheduled_ids.add(tt_id)
    movies_to_process.append((idx, imdb_numeric))

movies_buffer = []
timer = time.perf_counter()
total_tasks = len(movies_to_process)
processed_tasks = 0
new_movies_saved = 0
next_numeric_id = max(existing_numeric_ids) + 1 if existing_numeric_ids else 1

if total_tasks:
    print(f"Scheduling {total_tasks} new movies for scraping.")

try:
    if total_tasks:
        with ThreadPoolExecutor(max_workers=8) as executor:
            for movie_data, url, movie_id in executor.map(scrape_movie_data, movies_to_process):
                processed_tasks += 1

                if not movie_data:
                    continue

                tt_id = movie_data.get("imdb_id")
                if tt_id and tt_id in existing_ids:
                    continue

                if tt_id:
                    existing_ids.add(tt_id)

                movie_data["_id"] = f"ms{next_numeric_id:012d}"
                next_numeric_id += 1
                movies_buffer.append(movie_data)
                new_movies_saved += persist_movies(movies_buffer, output_path)

                if processed_tasks % 25 == 0 or processed_tasks == total_tasks:
                    progression = f"{processed_tasks}/{total_tasks}"
                    elapsed = time.perf_counter() - timer
                    print(f"Progress: {progression} ({elapsed:.1f}s elapsed)")
    else:
        print("No new movies detected to scrape.")
finally:
    new_movies_saved += persist_movies(movies_buffer, output_path)
    finalize_output(output_path)

print(
    f"Inserted {new_movies_saved} new movies (total {len(existing_ids)} entries) "
    f"to {output_path} in {time.perf_counter() - timer:.1f} seconds."
)

# Breaking Bad (tt0903747)
print(MovieImdb(0, 903747).get_creator())
