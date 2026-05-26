#!/usr/bin/env sh
set -eu

harness check --cwd "$(pwd)" "$@"
