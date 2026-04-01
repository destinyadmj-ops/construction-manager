@echo off
pushd "%~dp0\.."
npm run dev -- -H 0.0.0.0 -p 3000
