# Movie Maniac Platform

Movie Maniac delivers the Social Watchlist & Reviews Platform assignment. It lets users track watched titles, manage a watchlist, follow friends, rate titles, post comments, build and share custom lists for movies, series, or cast and crew, receive recommendations, and browse detailed information for every title or person on a REACT app.

## Table of Content
- [Repository structure](#repository-structure)
- [Data entities](#data-entities)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [User connection](#user-connection)
- [docker-compose workflow](#docker-compose-workflow)
- [API CRUD usage](#api-crud-usage)
- [App features](#app-features)
- [Data flow](#data-flow)
- [Webscrapping workflow](#webscrapping-workflow)
- [Useful commands](#useful-commands)
- [Task Repartition](#task-repartition)
- [AI usage](#ai-usage)
- [References](#references)
- [Authors](#authors)

## Repository structure

```text
nosql_group_project/
|-- api/                     # Flask APIs for catalog, users, people
|   |-- api_movies_series/
|   |   |-- Dockerfile
|   |   |-- requirements.txt
|   |   |-- movies_series.py           # Flask routes and entrypoint
|   |   |-- movies_series_functions.py # CRUD helpers and cache logic
|   |-- api_people/
|   |   |-- Dockerfile
|   |   |-- requirements.txt
|   |   |-- people.py                  # Flask routes and entrypoint
|   |   |-- people_functions.py        # Query helpers for cast and crew
|   |-- api_users/
|   |   |-- Dockerfile
|   |   |-- requirements.txt
|   |   |-- users.py                   # Flask routes and entry
|   |   |-- users_functions.py         # CRUD helpers for auth, lists, friends
|-- data/
|   |-- movies_data.json     # Seed dataset for movies and series
|   |-- people_data.json     # Seed dataset for cast and crew
|   |-- users_data.json      # Seed dataset for user accounts, lists, friends
|-- myapp/
|   |-- Dockerfile.dev       # Development image definition for React app
|   |-- package.json         # React dependencies and scripts
|   |-- public/              # Static assets served by React
|   |-- src/
|   |   |-- components/
|   |   |   |-- Login/
|   |   |   |   |-- index.js          # Login and signup UI with form states
|   |   |   |   |-- Login.css         # Styles for authentication views
|   |   |   |   |-- auth.js           # Client helpers for auth state
|   |   |   |-- Navbar.js             # Main navigation bar
|   |   |   |-- Home.js               # Home feed layout and filters
|   |   |   |-- MovieRail.js          # Horizontal carousel for titles
|   |   |   |-- RecommendationRail.js # Recommendation cards and pagination
|   |   |   |-- MovieDetail.js        # Detailed movie presentation
|   |   |   |-- PeopleDetail.js       # Detailed cast and crew view
|   |   |   |-- WatchList.js          # Watchlist display and filtering
|   |   |   |-- MyList.js             # CRUD interface for personal lists
|   |   |   |-- Friends.js            # Social interactions and requests
|   |   |   |-- Profile.js            # Profile editing and statistics
|   |   |   |-- FavoritePeopleRail.js # Favorite people carousel
|   |   |-- pages/
|   |   |   |-- HomePage.js           # Landing page shell
|   |   |   |-- MoviesPage.js         # Movies listing route wrapper
|   |   |   |-- SeriesPage.js         # Series listing route wrapper
|   |   |   |-- MovieDetailPage.js    # Movie detail route
|   |   |   |-- PeopleDetailPage.js   # Person detail route
|   |   |   |-- PeopleSearchPage.js   # People search route
|   |   |   |-- RecommendationsPage.js# Recommendation hub route
|   |   |   |-- MyListPage.js         # Personal lists route
|   |   |   |-- WatchListPage.js      # Watchlist route
|   |   |   |-- ProfilePage.js        # Profile route shell
|   |   |   |-- Friends.js            # Friends management route
|   |   |-- App.js           # Root component wiring routes and layout
|   |   |-- App.css          # Global styles
|   |   |-- config.js        # API endpoint configuration
|   |   |-- setupProxy.js    # Development proxy to Flask services
|-- scripts/
|   |-- seed_movies_series.js # Imports movies_data.json into MongoDB
|   |-- seed_people.js        # Imports people_data.json into MongoDB
|   |-- seed_users.js         # Imports users_data.json into MongoDB
|-- webscrapping/                  # Scripts and data for collection
|   |-- db/                        # Stores people title cache
|   |   |-- people_titles_cache.json  # Saves people title pairs
|   |-- imdb_db/                   # Holds local IMDb extracts
|   |   |-- database.csv           # List of titles ready for scraping
|   |   |-- title.basics.tsv       # Base IMDb export (To be added)
|   |-- class_movies_series.py     # Scrapes data for movies and series
|   |-- class_people.py            # Builds people dataset from titles
|   |-- exctracting_movies_series_tt.py  # Filters IMDb export for recent titles
|   |-- movies_series_functions.py # Shared helpers for movie scraping
|   |-- people_functions.py        # Shared helpers for people scraping
|   |-- requirements.txt           # Lists Python packages in use
|-- docker-compose.yml       # Compose configuration for all services
|-- .dockerignore            # Docker build exclusions
|-- .gitignore               # Git exclusions
|-- presentation.pdf         # Project presentation
|-- project.pdf              # Project brief and specifications
```

## Data entities
- `data/movies_data.json` (array of movie or series records):
  - `_id`: internal identifier used across APIs, for example `"ms000000000004"` for Titanic.
  - `title`: display title such as `"Titanic"`.
  - `imdb_id`: reference id (`"tt0120338"`) pointing to the IMDb page (`imdb_link`).
  - `imdb_type`: `"Movie"` or `"Series"` to control detail layout.
  - `year`, `release_date`, `release_day`, `release_month`: release metadata, for example `1997-12-19`.
  - `duration`: runtime in minutes (e.g.,`194`) rendered as hours/minutes in UI.
  - `genres`: primary buckets (`["Drama","Romance"]`).
  - `genre_interests`: extended tags used by recommendation rails (e.g., `"Disaster"`, `"Tragic Romance"`).
  - `description`: synopsis for detail pages.
  - `main_actors`: cast lists starting with `["Leonardo DiCaprio"`, `"Kate Winslet", ...]`.
  - `directors`, `writers`, `creator`: creative leads (Titanic lists `"James Cameron"` in both directors and writers).
  - `country`: production country (e.g.,`"United States"`) 
  - `languages`: audio languages array (`["English", "Swedish", "Italian", "French"]`).
  - `companies`: production companies. Titanic lists `"Twentieth Century Fox"`, `"Paramount Pictures"`, `"Lightstorm Entertainment"`.
  - `content_rating`: content warnings (`PG-13`).
  - `popularity`, `rating`, `rating_count`, `reviews_count`: stats powering recommendation ranking (Titanic rating `7.9` from `1,360,013` votes).
  - `added_by_users_to_watchlist`: number of users starring it (`706,000`).
  - `keywords`: top tags such as `"iceberg"`, `"drowning"`.
  - `poster_url`, `trailer_url`: assets for cards and modals.
  - `oscars_won`, `awards_wins`, `awards_nominations`: award summary (Titanic `11` Oscars, `126` wins, `84` nominations).
  - `series_total_seasons`, `series_total_episodes`: only populated for series (null for films, e.g., `5` seasons and `62` episodes for Breaking Bad).
- `data/people_data.json` (object with a `people` array):
  - `_id`: internal identifier such as `"p000000000078"` for J.R.R. Tolkien.
  - `name`: display name (`"J.R.R. Tolkien"`).
  - `imdb_name_id`: external identifier (`"nm0866058"`) paired with `url` for the IMDb profile.
  - `photo_url`: image displayed in people cards (Tolkien portrait link).
  - `biography`: long text used on detail pages; Tolkienâ€™s entry covers his career, lectures, and publication history.
  - `role`: list of professions (`["Writer"]` for Tolkien).
  - `movie`: array of associated titles, each with `_id` and `title` (Tolkien maps to `"ms000000000010"` The Two Towers and `"ms000000000009"` Fellowship of the Ring in this database).
- `data/users_data.json` (object with a `users` array):
  - `_id`, `username`, `password`: authentication data (e.g., `u000000000001` / `mehdi_e` / `mehdi123`).
  - `full_name`, `member_since`, `birthdate`, `location_city`, `location_country`: profile attributes.
  - `about_me`: biography displayed on `/profile`.
  - `favorites_movies`: list of title ids (`["ms000000000003", ...]`) to hydrate favorite rails.
  - `favorites_people`: list of people ids for favorite cast rails.
  - `reviews`: per-title review objects containing `_id`, `review_text`, `helpful_votes`, `date_posted`.
  - `friends`: array of connections with friend `_id` and `common_favorites` for social insights.
  - `list`: custom list definitions; each object holds a `movies_series` array referencing titles (e.g., `[{'_id': 'ms000000000010'}, {'_id': 'ms000000000012'}]`).
  - `watch_statuses`: reserved dictionary for watch history toggles; seeded empty but updated by the API at runtime.

## Prerequisites
- Docker Desktop
- Docker Compose V2
- Node.js 18 
- Python 3.10+ 
- PowerShell, Visual Studio Code terminal, or any shell with `curl`

## Getting started

### Clone

```powershell
git clone https://github.com/crepinini/nosql_group_project.git
cd nosql_group_project
```

### Run everything with Docker

```powershell
docker-compose up --build
```
> **Note:** Before running, ensure Docker Desktop is running and port 27017 (MongoDB) is free.

Docker builds the images, starts the network, mounts the source folders, and exposes the ports listed below.

Open (once `docker-compose up --build` finishes and all containers report healthy, typically 1-2 minutes on a laptop):
- http://localhost:3000 for the React client (use the top navigation to visit Home, Movies, Series, WatchList, MyLists, Profile, Friends, and Recommendations).
- http://localhost:5000/movies-series for the movies and series API (try `http://localhost:5000/movies` for movies only or `/movies-series/recommendations?categories=popular&limit=6` for sample rails).
- http://localhost:5001/users for the users API (e.g. `http://localhost:5001/users/u000000000001` for a single profile).
- http://localhost:5002/people for the people API (supports `http://localhost:5002/people?q=tolkien&role=writer&page=1&page_size=5` to filter by name and role).
- http://localhost:5540 for RedisInsight (optional UI to inspect cached keys).

Navigation tips and cache inspection:
- Hit an API endpoint twice and run `docker-compose logs -f api_movies_series` or `api_people` to observe the first `cache miss` and subsequent `cache hit`, showing Redis caching in action.
  - Use the React Home or Movies search bar with terms like "Titanic" or "The Lord of the Rings" to watch the rails refresh and populate the watchlist.
  - On the People page, search "Tolkien" to open the J.R.R. Tolkien profile (served from `http://localhost:5002/people?q=tolkien`); check Redis logs to confirm the cache entry.

### Stop the App


```powershell
docker-compose down
```

Add `-v` to reset MongoDB and Redis volumes.

## User connection

You can sign in with each profile. The password uses the first name in lowercase followed by `123`; for `nirina_c`, the password is `nirina123`. The Flask API does not output passwords, so use the JSON file when you need to confirm them. You can also create profile entries and sign in with them to try the functions from the platform (see `data/users_data.json` for password).

## docker-compose workflow
### Workflow
1. `api_movies_series`, `api_users`, and `api_people` build from their Dockerfiles and install the Python dependencies listed in each `requirements.txt`.
2. `myapp` builds from `myapp/Dockerfile.dev`, runs `npm install` and `npm start`, watches mounted files, and exposes port 3000 (MovieManiac App).
3. `mongodb` uses the `mongo:7` image, mounts `scripts/seed_*.js`, and imports (seeds MongoDB) every JSON file from `data/` during the first start.
4. `redis` uses the `redis:7` image, stores data under `redis_data/`, and enables append-only persistence with a health check.
5. `redisinsight` waits for the Redis health check and exposes a UI on port 5540.
6. Environment variables in `docker-compose.yml` provide Mongo URIs, Redis URLs, cache TTL, and JSON file paths to the Flask services. The Redis cache TTL is set to 600 seconds by default (`CACHE_TTL_SECONDS=600`).
7. Volume mounts keep code changes in sync. When you edit Python or React files, containers reload without a rebuild. Run `docker-compose up --build` again after dependency or Dockerfile changes.

### Services
- **React client (`myapp`)**: Port 3000. Reads API targets from `config.js` or environment variables.
- **Movies and series API (`api_movies_series`)**: Port 5000. Serves catalog lists, filters, watchlist updates, recommendation feeds.
- **Users API (`api_users`)**: Port 5001. Handles authentication, profiles, lists, friendships.
- **People API (`api_people`)**: Port 5002. Exposes cast and crew data.
- **MongoDB (`group_movies_series_mongo`)**: Port 27017 for Compass or `mongosh`.
- **Redis (`group_movies_series_redis`)**: Port 6379 for cache and session values.
- **RedisInsight (`group_movies_series_redisinsight`)**: Port 5540 for cache monitoring.

## API CRUD usage
- `api/api_movies_series/movies_series.py`
  - `GET /movies-series`, `/movies`, and `/series` use to read catalogs.
  - `GET /movies-series/<id>` uses to return a full title entry.
  - `GET /movies-series/<id>/related` and `/movies-series/recommendations` use for discovery and recommendations.
  - `POST /movies-series`, `/movies`, and `/series` call to insert new titles into MongoDB.
- `api/api_people/people.py`
  - `GET /people` uses to list cast and crew.
  - `GET /people/<id>` uses to read one profile.
- `api/api_users/users.py`
  - `POST /auth/login` and `/auth/register` use to handle authentication and registration.
  - `GET /users`, and `/users/<id>` use to read user and network information.
  - `PUT /auth/login/<id>` and `/myprofile/<id>` use to update login credentials or profile details.
  - `POST /users/<id>/watch-status`, `/users/<id>/ratings`, `/users/<id>/comments`, `/users/<id>/favorites`, and `/users/<id>/favorites-people` use to update watch state, reviews, and favorites.
  - `DELETE /auth/delete/<id>` and `/users/<id>/friends/<friend_id>` use to remove accounts or friendships.
  - `GET /users/<id>/lists`, `POST /users/<id>/lists`, `PATCH /users/<id>/lists/<list_id>`, `DELETE /users/<id>/lists/<list_id>`, `POST /users/<id>/lists/<list_id>/items`, and `DELETE /users/<id>/lists/<list_id>/items/<movie_id>` use to manage personal lists.
  - `POST /friend-request`, `GET /friend-requests/<user_id>`, `POST /friend-request/<request_id>/accept`, `POST /friend-request/<request_id>/refuse`, and `POST /friend-request/<from_user>/<to_user>/cancel` use to manage friend requests.

## App features
localhost:3000 directories:
- `/home` - browse the main feed with combined movies and series, including search, filters, and pagination.
- `/movies` - view only movies with the same sorting, search, and filter tools.
- `/series` - view only series with sorting, search, and filter tools.
- `/movies-series/:movieId` - inspect a title with watch status, favorites, comments, and friend activity.
- `/recommendations` - explore recommendation rails grouped by genre and similarity.
- `/people`, `/crew`, `/actors` - search cast and crew, view filmographies, and open related titles.
- `/people/:personId` or `/actors/:actorId` - read profile data for a person, including roles and linked titles.
- `/my-lists` - manage custom lists with add, update, move, delete actions, and share them.
- `/watchlist` - maintain a login-protected watchlist with filtering, sorting, and sharing options.
- `/profile` - edit profile data, update watch statistics, and maintain favorites.
- `/friends` - handle friend requests, pending states, and monitor activity feeds.
- `/login` - authenticate to unlock personal features.

## Data flow
- JSON exports in `data/` act as the base dataset for movies, people, and users. Allowing to seed/populate the MongoDB dataset The JSON database was created thanks to `webscrapping/` to scrape imdb website.
- Seed scripts in `scripts/` insert or refresh MongoDB collections on container boot.
- Flask services read MongoDB through PyMongo, cache responses in Redis, and expose REST endpoints.
- The React client calls the APIs through `setupProxy.js` during development or through container networking when deployed.

## Webscrapping workflow
The `webscrapping/` directory stores the scraping utilities that generate the seed JSON datasets from IMDb.

1. Install dependencies once with `pip install -r webscrapping/requirements.txt`.
2. Download the official TSV exports from [datasets.imdbws.com](https://datasets.imdbws.com/) (at minimum `title.basics.tsv.gz`), extract them, and place the resulting `.tsv` files under `webscrapping/imdb_db/`.
3. Run `python webscrapping/exctracting_movies_series_tt.py` to filter recent movie and series identifiers into `webscrapping/imdb_db/imdb_movies_2009_2020.csv`. The script strips the `tt` prefix and limits the range of years it keeps.
4. Run `python webscrapping/class_movies_series.py` to visit each IMDb title page, throttle requests, and write the aggregated payload to `data/movies_data.json`. Helper routines in `webscrapping/movies_series_functions.py` handle parsing and rate-limit backoff.
5. Run `python webscrapping/class_people.py` to expand cast and crew data. It reads the newly generated movies JSON, caches intermediate responses in `webscrapping/db/people_titles_cache.json`, and outputs `data/people_data.json`.

The refreshed JSON files can then be loaded into MongoDB through the seeding scripts. Expect the scrapers to take time and respect IMDb’s usage guidelines, they pause automatically when rate limits are detected.

## Useful commands

```powershell
# Restart myapp
docker compose restart myapp

# Follow logs from a service
docker-compose logs -f myapp

# Run a shell in the React container
docker exec -it myapp sh

# Open Mongo shell
docker exec -it group_movies_series_mongo mongosh

# Open Redis CLI
docker exec -it group_movies_series_redis redis-cli

# Rebuild one service
docker-compose build api_users
```

## Task Repartition
- **Nirina Crépin (crepinini)**
  - Built Recommendations, Cast & Crew, Movie Detail, People Detail, MyList, and Sign In/Sign Up page.
  - Set up the repository structure, seeded MongoDB, created `movies_data.json`, `people_data.json`, and initial CRUD in `api_movies_series` and `api_people`. Also created and updated some user CRUD methods in `api_user`.
- **Salwa Hammou (SalwaHm)**
  - Built Home, Movies, Series, and WatchList pages with search, filters, pagination, and watchlist login enforcement on those pages.
  - Created user CRUD methods in `api_user` and Connection to MongoDb & Redis 
- **El Maadoudi Mehdi (melmagenwise)**
  - Built Profile and MyFriends pages, including friend request workflow, profile editing, statistics, and favorite people rails.
  - Created user CRUD methods in `api_user`.

## AI usage
### Nirina Crépin
ChatGPT-5:
- Used to troubleshoot Python and Flask route issues, accelerating bug isolation.
- Asked for initial React layout suggestions to bootstrap directory structure and page scaffolding.
- Queried ChatGPT-5 when searching for where specific UI logic lived across files.
- Noticed misleading guidance on page margins and fixed the layout by updating `App.js` and related CSS files manually.
- Used ChatGPT-5 to improve comments, docstrings, and README explanations for grammar and syntax.
- Learned to :
  * Increase bug solving speed and issue tracing clarity (used it to resolve a teammate database problem).
  * Check AI suggestions and verify changes manually to keep styling and layout accurate.
  * Coordinate fixes across React, Flask, MongoDB, and Redis without losing momentum.

### Salwa Hammou
ChatGPT-5
- Use to understand error messages
- use to search for errors in the code and understand them
- Use to improve the visuals of the pages: Home.css and WatchList.css 
- Use to understand how to implement a filter

### El Maadoudi Mehdi
ChatGPT-5
- Used for troubleshooting on routes.
- Asked it to help me understand the "OPTIONS" method and why it needed the use of flask-CORS when working on friend requests.
- Used it for frontend development as I had no knowledge of React prior to this project.
- Learned to :
  * debug and understand issues that were lying in my code
  * understand the principle of CORS and when it becomes necessary
  * keep the frontend coherent between pages

## References
- https://github.com/iamshaunjp/Complete-React-Tutorial/tree/lesson-32/dojo-blog
- https://github.com/daccotta-org/daccotta
- https://github.com/iamshaunjp/docker-crash-course/tree/lesson-12
- https://dev.to/vguleaev/dockerize-a-react-app-with-node-js-backend-connected-to-mongodb-10ai
- https://www.geeksforgeeks.org/reactjs/movie-trailer-app-using-reactjs/
- https://www.geeksforgeeks.org/reactjs/movie-web-application-with-reactjs/
- https://www.geeksforgeeks.org/devops/how-to-dockerize-a-reactjs-app/
- https://www.youtube.com/watch?v=3Nb4DrpnUks
- https://react.dev/learn/creating-a-react-app
- https://github.com/CodeBlessYou/movie-maniac
- https://www.themoviedb.org/
- https://www.imdb.com/
- https://www.mongodb.com/resources/products/compatibilities/setting-up-flask-with-mongodb
- https://stackoverflow.com/questions/51350198/which-ports-do-i-use-to-send-get-requests-for-a-full-stack-vue-flask-mongodb-pro
- https://medium.com/analytics-vidhya/creating-dockerized-flask-mongodb-application-20ccde391a
- https://ishmeet1995.medium.com/how-to-create-restful-crud-api-with-python-flask-mongodb-and-docker-8f6ccb73c5bc
- https://www.geeksforgeeks.org/reactjs/how-to-do-crud-operations-in-reactjs/
- https://medium.com/@bhairabpatra.iitd/crud-create-read-update-delete-application-in-react-566bf229aaee
- https://uibakery.io/crud-operations/react
- https://github.com/moosakazim12/React-Crud
- https://www.geeksforgeeks.org/mern/how-to-build-a-basic-crud-app-with-node-js-and-reactjs/
- https://www.freecodecamp.org/news/how-to-build-a-fullstack-authentication-system-with-react-express-mongodb-heroku-and-netlify/
- https://kouohhashi.medium.com/simple-authentication-with-react-and-mongodb-dd2828cc4f16
- https://www.youtube.com/watch?v=3-Qqn01Z2aU
- https://www.mongodb.com/community/forums/t/how-to-automatically-login-users-after-email-password-authentication/100335
- https://stackoverflow.com/questions/74298610/how-can-i-implement-the-logout-functionality-using-node-js-and-mongodb
- https://www.geeksforgeeks.org/node-js/login-form-using-node-js-and-mongodb/
- https://github.com/parthasarathy27/Reactpage-login
- https://tutorialrays.in/building-a-complete-authentication-system-with-react-redux-node-js-and-mongodb/
- https://www.youtube.com/watch?v=S9eCBX-Re8A
- https://stackoverflow.com/questions/51006397/cant-remove-margins-on-react-web-app
- https://forum.freecodecamp.org/t/how-to-use-margin-with-react/501642
- https://www.reddit.com/r/react/comments/10tyok2/just_started_using_react_padding_and_margins_dont/
- https://gist.github.com/SebastianUdden/b07cd20874ab14648c3e98e708241276
- https://developer.mozilla.org/en-US/docs/Web/CSS/clamp
- https://www.designsystemscollective.com/fluid-typographic-scales-revolutionize-your-responsive-design-0d10ed7f740e
- https://www.geeksforgeeks.org/reactjs/how-to-implement-search-filter-functionality-in-reactjs/
- https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Frameworks_libraries/React_interactivity_filtering_conditional_rendering
- https://medium.com/@reidwilliamson2/react-and-filter-6dc8ea48d69b
- https://dev.to/laurentyson85/constructing-search-filter-functionality-in-react-dnd
- https://www.geeksforgeeks.org/reactjs/how-to-implement-multiple-filters-in-react/
- https://www.geeksforgeeks.org/reactjs/react-architecture-pattern-and-best-practices/
- https://react.dev/learn/build-a-react-app-from-scratch
- https://react.dev/learn/thinking-in-react
- https://builtin.com/articles/react-search-bar
- https://www.geeksforgeeks.org/reactjs/how-to-create-dynamic-search-box-in-reactjs/
- https://clerk.com/blog/generating-and-using-uuids-in-react
- https://react.dev/reference/react/useId
- https://www.geeksforgeeks.org/reactjs/how-to-create-an-unique-id-in-reactjs/
- https://medium.com/@sanchitvarshney/useid-vs-useref-vs-uuid-in-react-ea72ed5094f8
- https://dev.to/elyasshamal/generating-unique-ids-with-cryptorandomuuid-in-react-2d1e
- https://dev.to/rodik/mastering-crud-with-nextjs-30if
- https://stackoverflow.com/questions/56368824/how-can-i-sort-listobject-crud-repository
- https://codewithmukesh.com/blog/aspnet-core-webapi-crud-with-entity-framework-core-full-course/
- https://www.datawars.io/data-science-project/c02a7900-practice-data-filtering-sorting-with-hollywood-movie-data
- https://medium.com/@theshikanavod/part-7-pagination-sorting-and-filtering-from-zero-to-hero-building-a-full-stack-crud-050a7cf4d8ac
- https://www.youtube.com/watch?v=acWjyg5yVUQ
- https://medium.com/scrum-and-coke/rapid-prototype-asp-net-core-rest-api-using-onionapi-template-b10eea295655
- https://learn.microsoft.com/en-us/aspnet/mvc/overview/getting-started/getting-started-with-ef-using-mvc/sorting-filtering-and-paging-with-the-entity-framework-in-an-asp-net-mvc-application
- https://github.com/benavlabs/fastcrud
- https://stackoverflow.com/questions/20926827/what-is-a-good-crud-sympathetic-algorithm-for-ordering-list-items
- https://medium.com/@vinafasya/from-concept-to-code-building-a-simple-crud-store-management-system-with-python-0106141f8f1a
- https://www.reddit.com/r/Python/comments/1abwqni/fastcrud_powerful_crud_methods_and_automatic/
- https://python.plainenglish.io/mastering-fastapi-crud-operations-path-query-parameters-e97d187b534f
- https://dev.to/bearer/sort-filter-and-remap-api-data-in-python-5i
- https://www.moesif.com/blog/technical/api-design/REST-API-Design-Filtering-Sorting-and-Pagination/
- https://www.youtube.com/watch?v=X8zRvXbirMU&t=197
- https://dbschema.com/blog/mongodb/mongodb-crud-operations/#:~:text=Aggregation%20Pipeline%20Explained-,Introduction%20to%20CRUD%20Operations%20in%20MongoDB,documents%20that%20match%20the%20filter.
- https://docs.wavemaker.com/learn/how-tos/using-filter-criteria-database-crud-variable/
- https://www.geeksforgeeks.org/mongodb/mongodb-crud-operations-insert-and-find-documents/
- https://www.mongodb.com/resources/products/fundamentals/crud
- https://hevodata.com/learn/nosql-crud-operations/
- https://github.com/nia3zzz/Mysql-CRUD-Operations-With-Nodejs-And-Reactjs
- https://www.linkedin.com/posts/sahil-vaghela-0702862b6_creating-a-crud-api-in-reactjs-with-searching-activity-7250018473228038144-tKt9/
- https://www.mongodb.com/community/forums/t/simple-crud-operations-in-reactjs-for-local-database/8272
- https://www.youtube.com/watch?v=sWVgMcz8Q44
- https://medium.com/@andwebdev/design-and-develop-a-functional-search-bar-in-react-44321ed3c244
- https://www.youtube.com/watch?v=x7niho285qs
- https://github.com/muhammedsaidkaya/react-nosql-database
- https://github.com/Vincent440/react-books-search
- https://datasets.imdbws.com/

## Authors
* Nirina Crépin
* Mehdi El Maadoudi
* Salwa Hammou







