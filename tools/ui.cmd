@echo off
rem Opens the Wishtory catalog editor in your browser. Needs Node.js (see package.json "engines").
cd /d "%~dp0.."
node tools\ui.mjs
pause
