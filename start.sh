#!/bin/bash
cd backend && python main.py &
cd frontend && npm run dev &
wait