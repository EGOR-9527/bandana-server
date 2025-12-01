#!/bin/bash

# Имя базы данных, пользователя и пароль
DB_NAME="bandana"
DB_USER="bandana_user"
DB_PASS="timonandpoombo"

# Проверяем, установлен ли psql
if ! command -v psql > /dev/null; then
    echo "PostgreSQL не найден. Устанавливаем..."
    
    # Обновляем репозитории и устанавливаем PostgreSQL
    sudo apt update
    sudo apt install -y postgresql postgresql-contrib

    echo "PostgreSQL установлен."
else
    echo "PostgreSQL уже установлен."
fi

# Проверяем, запущен ли сервис
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Создаём пользователя, если не существует
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1
if [ $? -ne 0 ]; then
    echo "Создаём пользователя $DB_USER..."
    sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
else
    echo "Пользователь $DB_USER уже существует."
fi

# Создаём базу данных, если не существует
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1
if [ $? -ne 0 ]; then
    echo "Создаём базу данных $DB_NAME..."
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
else
    echo "База данных $DB_NAME уже существует."
fi

echo "Настройка PostgreSQL завершена."
