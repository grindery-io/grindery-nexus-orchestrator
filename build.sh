#!/usr/bin/env bash

set -eu

INSTANCE=${INSTANCE:-$npm_package_name}

# Linting and type-checking
eslint --ext js,ts src/

# Build
[ -d dist ] && rm -rf dist
tsc -p tsconfig.json