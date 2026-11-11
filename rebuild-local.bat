@echo off
cd /d "%~dp0"
echo === %date% %time% === > docker-run.log
docker version >> docker-run.log 2>&1
docker compose down >> docker-run.log 2>&1
docker compose up --build -d >> docker-run.log 2>&1
echo === EXIT %errorlevel% === >> docker-run.log
docker compose ps >> docker-run.log 2>&1
timeout /t 20 /nobreak > nul
docker compose logs --tail 80 >> docker-run.log 2>&1
echo === DONE === >> docker-run.log
