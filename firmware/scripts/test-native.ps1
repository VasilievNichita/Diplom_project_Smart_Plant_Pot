param([string]$Compiler = 'g++')
$ErrorActionPreference = 'Stop'
$firmwareRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputRoot = Join-Path $firmwareRoot '.pio\host-tests'
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$exePath = Join-Path $outputRoot 'core-tests.exe'
& $Compiler -std=c++17 -static -Wall -Wextra -Werror -I (Join-Path $firmwareRoot 'include') (Join-Path $firmwareRoot 'test\native.cpp') -o $exePath
if ($LASTEXITCODE -ne 0) { throw 'Host compilation failed' }
& $exePath
if ($LASTEXITCODE -ne 0) { throw 'Firmware core test failed' }
$heaterExe = Join-Path $outputRoot 'heater-tests.exe'
& $Compiler -std=c++17 -static -Wall -Wextra -Werror -I (Join-Path $firmwareRoot 'include') (Join-Path $firmwareRoot 'test\heater.cpp') -o $heaterExe
if ($LASTEXITCODE -ne 0) { throw 'Heater compilation failed' }
& $heaterExe
if ($LASTEXITCODE -ne 0) { throw 'Heater policy test failed' }
