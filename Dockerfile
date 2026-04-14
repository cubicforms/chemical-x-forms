FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Install deps first for layer caching
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

COPY . .

# Long-running container so dev sessions can attach a shell.
# Source is volume-mounted at runtime; this is just to keep the container up.
CMD ["sh", "-c", "tail -f /dev/null"]
