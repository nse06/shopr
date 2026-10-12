.PHONY: setup web server test

# One-time install: Python deps (incl. the image model's libraries) and the app.
setup:
	cd backend && uv sync --extra ml --extra dev
	cd app && npm ci

# Build the website; the server serves it at http://localhost:8000
web:
	cd app && npx expo export --platform web

server:
	cd backend && uv run shopr

test:
	cd backend && uv run pytest -q
	cd app && npx tsc --noEmit && npx expo lint
