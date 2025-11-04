from pathlib import Path
import csv

# Input IMDb dataset (TSV file downloaded from datasets.imdbws.com)
TT_PATH = "webscrapping/imdb_db/title.basics.tsv"

# Output CSV path
START_YEAR = 2009
END_YEAR = 2020
OUTPUT_CSV = f"webscrapping/imdb_db/imdb_movies_{START_YEAR}_{END_YEAR}.csv"

def recent_titles(path: str = TT_PATH, keep_types: set = {"movie", "tvSeries"}, min_year: int = START_YEAR, max_year: int = END_YEAR):

    with open(path, encoding="utf-8") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            title_type = row.get("titleType", "")
            start_year = row.get("startYear", "")

            if title_type not in keep_types:
                continue
            if not start_year.isdigit():
                continue

            year = int(start_year)
            if not (min_year < year <= max_year):
                continue

            imdb_id = row["tconst"]
            if imdb_id.startswith("tt"):
                # Remove 'tt' prefix
                imdb_id = imdb_id[2:]  

            yield {
                "imdbId": imdb_id,
                "titleType": title_type,
                "Year": start_year,
            }


if __name__ == "__main__":
    # Collect titles
    titles = list(recent_titles())

    # Write to CSV
    output_path = Path(OUTPUT_CSV)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["imdbId", "titleType", "Year"])
        writer.writeheader()
        writer.writerows(titles)

    print(f"Saved {len(titles)} titles released between {START_YEAR} and {END_YEAR} -> {output_path}")
