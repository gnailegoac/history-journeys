@echo off
chcp 65001 >nul
rem 双击启动：在这台电脑上起服务，电脑和家里同一个网络里的平板、手机都能打开。
rem 用的时候不要关这个窗口；关掉窗口或按 Ctrl+C 就停止。
rem 这个文件是 UTF-8 编码（不带 BOM），靠上面的 chcp 65001 让中文在窗口里正常显示，不要删那一行。
rem 端口 5400 是 vite.config.ts 里定的，那边改了这里也要改。
title 沿着他走过的路
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Node.js。请先到 https://nodejs.org 安装，再双击这个文件。
  pause
  exit /b 1
)

if not exist node_modules (
  echo 第一次启动，正在安装依赖，要等几分钟……
  call npm install
  if errorlevel 1 (
    echo 安装依赖没有成功。请检查网络后再试一次。
    pause
    exit /b 1
  )
)

echo.
echo 正在启动。下面出现 ready 字样以后，在浏览器里打开：
echo.
echo   这台电脑：
echo       http://localhost:5400/
echo   家里的平板、手机（要和这台电脑连同一个网络）：
node -e "const list=Object.values(require('os').networkInterfaces()).flat().filter(a=>a.family==='IPv4'&&!a.internal&&!a.address.startsWith('169.254.'));for(const a of list)console.log('      http://'+a.address+':5400/');process.exit(list.length?0:1)"
if errorlevel 1 echo       没有找到局域网地址，请确认这台电脑已经连上家里的网络。
echo.
echo 如果列出好几个地址，一般是 192.168 开头的那个。
echo 第一次启动时，Windows 可能会问是否允许访问网络，请选“允许”。
echo 用的时候不要关这个窗口；关掉窗口或按 Ctrl+C 就停止。
echo.
call npm start -- --host 0.0.0.0
if errorlevel 1 pause
