FROM node:22-alpine

# Corepack reads `packageManager` from package.json and pins pnpm to
# that version automatically — keeps the dev container in lockstep
# with whatever CI / release tooling is exercising.
RUN corepack enable

# Disable husky inside the container. The image is git-less (alpine
# slim) and commits happen on the host anyway, so husky's `prepare`
# hook would emit `git command not found` on every `pnpm install` for
# no benefit. Husky honours this env var by short-circuiting its CLI
# to a no-op.
ENV HUSKY=0

WORKDIR /app

# Copy lockfile + every package.json that contributes to workspace
# resolution before any source. With these in place pnpm install's
# frozen-lockfile mode can resolve the entire workspace graph without
# seeing any source, so source-only changes don't bust this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/site/package.json ./apps/site/

# --frozen-lockfile fails loudly if package.json drifted from the
# lockfile; that's a feature — surfaces lockfile-out-of-sync issues at
# build time rather than at first dev session.
RUN pnpm install --frozen-lockfile

COPY . .

# Long-running idle container; `make up` runs the dev server via
# `docker compose exec`. Source is bind-mounted at runtime, the
# node_modules paths are anonymous volumes seeded from this image's
# install above.
CMD ["sh", "-c", "tail -f /dev/null"]
