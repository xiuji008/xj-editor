@echo off
set ELECTRON=node_modules\electron\dist\electron.exe
echo === run electron smoke (file://dist) ===
%ELECTRON% tmp-electron-smoke.cjs > tmp-electron-out.log 2>&1
echo === cleanup ===
taskkill /F /IM electron.exe > nul 2>&1
echo done
