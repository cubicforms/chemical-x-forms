.PHONY: help build up down restart logs shell install dev test test-watch lint format check prepare typecheck publish-prep
.DEFAULT_GOAL := help

CONTAINER := cx-dev

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# --- Container lifecycle ---

build:  ## Build the dev image
	docker compose build

up:  ## Start the dev container (idle, ready for shell/exec)
	docker compose up -d

down:  ## Stop and remove the dev container
	docker compose down

restart:  ## Rebuild and restart
	docker compose down
	docker compose build
	docker compose up -d

logs:  ## Tail container logs
	docker compose logs -f

shell:  ## Drop into an interactive shell inside the container
	docker compose exec cx sh

# --- pnpm scripts (run inside the container) ---

install:  ## Install dependencies
	docker compose exec cx pnpm install

prepare:  ## Prepare the module for development (build stub + prepare playground)
	docker compose exec cx pnpm dev:prepare

dev:  ## Run the playground dev server (visit http://localhost:3001)
	docker compose exec cx pnpm dev

test:  ## Run the test suite once
	docker compose exec cx pnpm test

test-watch:  ## Run tests in watch mode
	docker compose exec cx pnpm test:watch

lint:  ## Lint
	docker compose exec cx pnpm lint

format:  ## Format
	docker compose exec cx pnpm format

check:  ## Lint + format check + typecheck
	docker compose exec cx pnpm check

typecheck:  ## TypeScript check
	docker compose exec cx pnpm typecheck

publish-prep:  ## Build the module for publishing
	docker compose exec cx pnpm prepack
