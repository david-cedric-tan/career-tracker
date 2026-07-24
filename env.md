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
