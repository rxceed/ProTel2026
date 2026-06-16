#!/bin/bash
cd ./Model
source venv/Scripts/activate 2>/dev/null || echo "Info: Virtual environment tidak ditemukan atau tidak digunakan."
uvicorn app.main:app --reload --port 8002
