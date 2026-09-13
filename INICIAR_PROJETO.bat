@echo off
title INP Protocol - Sistema de Demonstracao
color 0A
cd /d "c:\inp_protocol"
cls
echo ===================================================================
echo    INICIANDO GATEWAY E MICROSSERVICOS DO INP PROTOCOL
echo ===================================================================
echo.
echo 1. Iniciando Gateway INP na porta 3000...
start "INP Gateway :3000" cmd /k "cd /d c:\inp_protocol && node dist/index.js"
timeout /t 3 /nobreak >nul

echo 2. Iniciando 4 Microsservicos de E-Commerce (3001, 3002, 3003, 3004)...
start "Microsservicos de E-Commerce" cmd /k "cd /d c:\inp_protocol && npx ts-node examples/ecommerce-ecosystem/start-ecosystem.ts"
timeout /t 4 /nobreak >nul

echo 3. Abrindo Laboratorio de Testes no seu navegador...
start http://localhost:3000/demo

echo.
echo ===================================================================
echo    SISTEMA ATIVO COM SUCESSO!
echo    - Painel Interativo: http://localhost:3000/demo
echo    - Portal Oficial:    http://localhost:3000/
echo    Mantenha as janelas abertas enquanto estiver utilizando.
echo ===================================================================
pause
