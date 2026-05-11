## Docker Compose — full stack (required delta)

yaml
# docker-compose.yml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: accounts_db
    ports:
      - '5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build: .
    ports:
      - '3000:3000'
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
    command: >
      sh -c "npm run migration:run && npm run start:prod"

volumes:
  pgdata:

The healthcheck + `condition: service_healthy` on `depends_on` prevents the API from starting before Postgres is ready.

