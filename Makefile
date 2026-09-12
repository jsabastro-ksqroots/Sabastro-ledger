# Plain-English shortcuts. Run `make` to see them.
.PHONY: help setup dev test test-core lint typecheck db-up db-down db-migrate db-seed studio

help:
	@echo "make setup      - install everything, start the database, apply migrations, seed users and chart"
	@echo "make dev        - start the app at http://localhost:3000"
	@echo "make test       - run all unit tests (starts an embedded database if DATABASE_URL is unset)"
	@echo "make test-core  - run only the accounting invariant tests"
	@echo "make lint       - lint + typecheck"
	@echo "make db-up      - start Postgres in Docker"
	@echo "make db-down    - stop Postgres"
	@echo "make db-migrate - apply migrations"
	@echo "make db-seed    - (re)seed users, entities, chart of accounts, classes (safe to repeat)"
	@echo "make studio     - open Prisma Studio to look at the database"

setup:
	pnpm run setup

dev:
	pnpm dev

test:
	pnpm test

test-core:
	pnpm test:core

lint:
	pnpm lint && pnpm typecheck

db-up:
	pnpm db:up

db-down:
	pnpm db:down

db-migrate:
	pnpm db:migrate

db-seed:
	pnpm db:seed

studio:
	pnpm db:studio
