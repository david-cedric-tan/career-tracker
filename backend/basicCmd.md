## Database (Docker Postgres)

```
docker compose up -d          # Postgres 17 -> localhost:5433
docker compose ps
docker compose logs db --tail 30
docker compose down           # add -v to also drop the volume
```

Connection settings come from `backend/.env`:

```
USE_POSTGRES=true             # false -> local db.sqlite3 instead
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5433
POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD
```

## Migrations

```
python manage.py makemigrations applications network todos
python manage.py migrate
```

## Running

```
python manage.py runserver            # http://127.0.0.1:8000
python manage.py createsuperuser      # then /admin/
python manage.py seed_demo            # demo / demo-pass-1234
python manage.py test                 # full API suite
```

## Uploads

Profile pictures and contact photos land in `backend/media/` (git-ignored) and
are served by Django only while `DEBUG` is on.

```
rm -rf media/            # clear every uploaded image
```

## Handy

```
python manage.py shell_plus           # django-extensions
python manage.py show_urls            # every route, incl. the DRF router
```
