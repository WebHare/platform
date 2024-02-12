#!/bin/bash
mkdir -p "$HOME" # ensure the homedir exists. as it's a mounted volume we can't create it in the Dockerfile
exec "$@"
