# Bill Stones

Bill Stones is a full-stack storage platform with:

- **Frontend**: Angular app in `storage`
- **Backend**: NestJS API in `storage-api`

## Project Structure

- `storage/` — Angular frontend
- `storage-api/` — NestJS backend
- `Makefile` — shortcut commands for install, dev, build, test, and lint

## Prerequisites

- Node.js (LTS recommended)
- npm

## Quick Start

From the repository root:

```bash
make install
make dev
```

- Frontend runs on port `4200`
- Backend runs on port `3000`

## Common Commands

```bash
make install   # install dependencies for frontend + backend
make fe        # run frontend dev server
make be        # run backend dev server
make dev       # run frontend + backend together
make build     # build frontend + backend
make test      # run tests for frontend + backend
make lint      # run lint for frontend + backend
make clean     # remove node_modules and build output
```
