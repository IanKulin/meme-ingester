# meme-ingester

Web app for storing URLs for later retrieval by `meme-fetcher`

## to build & run for testing
- Native `node server.js`
or
- `docker build -t ghcr.io/iankulin/meme-ingester .`
- `docker compose up`
- http://127.0.0.1:3000

## to build and push for production

- `docker build --platform linux/amd64 -t ghcr.io/iankulin/meme-ingester .`
- `docker push ghcr.io/iankulin/meme-ingester`