.PHONY: help build up down restart logs shell install dev test test-watch lint format check prepare typecheck publish-prep watch watch-bg unwatch
.DEFAULT_GOAL := help

CONTAINER := attaform-dev

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
	docker compose exec attaform sh

# --- pnpm scripts (run inside the container) ---

install:  ## Install dependencies
	docker compose exec attaform pnpm install

prepare:  ## Prepare the module for development (build stub + prepare playground)
	docker compose exec attaform pnpm dev:prepare

dev:  ## Run the playground dev server (visit http://localhost:3001)
	docker compose exec attaform pnpm dev

test:  ## Run the test suite once
	docker compose exec attaform pnpm test

test-watch:  ## Run tests in watch mode
	docker compose exec attaform pnpm test:watch

lint:  ## Lint
	docker compose exec attaform pnpm lint

format:  ## Format
	docker compose exec attaform pnpm format

check:  ## Lint + format check + typecheck
	docker compose exec attaform pnpm check

typecheck:  ## TypeScript check
	docker compose exec attaform pnpm typecheck

publish-prep:  ## Build the module for publishing
	docker compose exec attaform pnpm prepack

watch:  ## Rebuild dist on every src change (for consumer-side iteration via pnpm link)
	docker compose exec -e CI=true -e SHELL=/bin/sh attaform pnpm prepack:watch

watch-bg:  ## Detached watcher (PID tracked in /tmp/attaform-watch.pid) — used by attaform' make link-attaform
	@# Idempotent: if a live watcher's already tracked in the pidfile, no-op.
	@# Same /proc/$PID/cmdline check as `unwatch` — guards against a stale
	@# pidfile pointing at a recycled PID.
	@docker compose exec -e CI=true -e SHELL=/bin/sh -d attaform sh -c 'if [ -f /tmp/attaform-watch.pid ]; then PID=$$(cat /tmp/attaform-watch.pid); if [ -f /proc/$$PID/cmdline ] && tr "\0" " " < /proc/$$PID/cmdline | grep -q "prepack:watch"; then exit 0; fi; fi; pnpm prepack:watch > /tmp/attaform-watch.log 2>&1 & echo $$! > /tmp/attaform-watch.pid'

unwatch:  ## Stop the background watcher started by watch-bg
	@# Validate the stored PID via /proc/$PID/cmdline before killing — guards
	@# against PID reuse if the watcher already exited. `pkill -P PID` kills
	@# the children (chokidar) by parent-PID, so it doesn't take a regex and
	@# can't self-match. `kill PID` then takes out the pnpm parent.
	@docker compose exec attaform sh -c 'if [ -f /tmp/attaform-watch.pid ]; then PID=$$(cat /tmp/attaform-watch.pid); if [ -f /proc/$$PID/cmdline ] && tr "\0" " " < /proc/$$PID/cmdline | grep -q "prepack:watch"; then pkill -P $$PID 2>/dev/null || true; kill $$PID 2>/dev/null || true; fi; rm -f /tmp/attaform-watch.pid /tmp/attaform-watch.log; fi; true'
