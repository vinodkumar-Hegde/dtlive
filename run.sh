#!/usr/bin/env bash
set -euo pipefail
docker compose up -d --build
echo
echo "DocTutorials Live Chat is starting:"
echo "Frontend: http://localhost:5192"
echo "API docs: http://localhost:8092/docs"
