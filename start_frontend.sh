#!/bin/bash

# Ensure Node 22 for pnpm/SvelteKit
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22

# Start the frontend
cd "$(dirname "$0")/ui"
pnpm install
pnpm dev
