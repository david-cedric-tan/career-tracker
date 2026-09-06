## Key Commands

'''
python3 -m venv .venv
source .venv/bin/activate
'''

## Installation

'''
mkdir apptracker && cd apptracker
python3 -m venv .venv
source .venv/bin/activate

pip install django python-dotenv
pip freeze > requirements.txt

django-admin startproject config .
python manage.py startapp applications

python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
'''

## Docker Debugging

'''
docker compose down -v # -v removes the volume, not just the container
docker rmi -f postgres:17
docker pull postgres:17
docker compose up -d
docker compose logs db --tail 30

docker compose ps

docker run hello-world
'''

## Migration -> DB

'''
python3 manage.py migrate
'''
