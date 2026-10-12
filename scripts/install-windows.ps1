# shopr installer for Windows.
#
# Paste this into Command Prompt (or PowerShell) and press Enter:
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/nse06/shopr/refs/heads/claude/youthful-darwin-mcsbnd/scripts/install-windows.ps1 | iex"
#
# It installs the tools shopr needs (Git, Node.js, uv), downloads shopr into
# your user folder, sets it up and puts a "Start shopr" icon on your desktop.
# Run the same line again any time to update shopr.
#
# Written for Windows PowerShell 5.1, which every Windows 10/11 PC has.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = 'https://github.com/nse06/shopr.git'
if ($env:SHOPR_REPO) { $Repo = $env:SHOPR_REPO }
$Branch = 'claude/youthful-darwin-mcsbnd'
if ($env:SHOPR_BRANCH) { $Branch = $env:SHOPR_BRANCH }
# A dedicated folder name, so it never collides with an existing "shopr" folder.
$InstallDir = Join-Path $HOME 'shopr-app'
if ($env:SHOPR_DIR) { $InstallDir = $env:SHOPR_DIR }

$OnWindows = [System.Environment]::OSVersion.Platform -eq 'Win32NT'
$Arch = $env:PROCESSOR_ARCHITEW6432
if (-not $Arch) { $Arch = $env:PROCESSOR_ARCHITECTURE }
# Two of shopr's libraries have no ARM builds for Windows yet, so on ARM laptops
# use the x64 Python, which Windows runs through its built-in emulation.
$PythonOverride = $null
if ($OnWindows -and $Arch -eq 'ARM64') {
    $PythonOverride = 'cpython-3.13-windows-x86_64-none'
    $env:UV_PYTHON = $PythonOverride
}

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Stop-Install([string]$Message) {
    Write-Host ''
    Write-Host "Setup stopped: $Message" -ForegroundColor Red
    Write-Host 'Copy the messages above and send them to Claude to get it fixed.' -ForegroundColor Red
    # When started with the one-line command (powershell -c ...), just end that PowerShell.
    # When pasted into an open PowerShell window, throw instead so the window stays open.
    $oneLiner = [System.Environment]::GetCommandLineArgs() | Where-Object { $_ -match '^[-/](c|command|e|ec|encodedcommand|f|file)$' }
    if ($oneLiner) { exit 1 }
    throw $Message
}

function Invoke-Native([string]$What, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { Stop-Install "$What failed (exit code $LASTEXITCODE)." }
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Update-PathFromSystem {
    # Pick up tools that were installed after this window opened.
    if (-not $OnWindows) { return }
    $parts = @(
        [System.Environment]::GetEnvironmentVariable('Path', 'Machine'),
        [System.Environment]::GetEnvironmentVariable('Path', 'User'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'),
        (Join-Path $HOME '.local\bin'),
        (Join-Path $env:ProgramFiles 'nodejs'),
        (Join-Path $env:ProgramFiles 'Git\cmd')
    )
    $env:Path = ($parts | Where-Object { $_ }) -join ';'
}

function Get-NodeMajor {
    if (-not (Test-Command 'node')) { return 0 }
    $version = (& node --version) -replace '^v(\d+).*$', '$1'
    try { return [int]$version } catch { return 0 }
}

function Test-VCRedist {
    try {
        $key = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64' -ErrorAction Stop
        return $key.Installed -eq 1
    } catch {
        return $false
    }
}

function Install-Tool([string]$Id, [string]$Name) {
    if (-not (Test-Command 'winget')) {
        Stop-Install "$Name is missing and winget isn't available. Install 'App Installer' from the Microsoft Store, then run this again."
    }
    Write-Step "Installing $Name. If Windows asks for permission, click Yes."
    # winget returns an error code for some harmless cases (like 'already installed'),
    # so check for the tool afterwards instead of trusting the exit code.
    & winget install -e --id $Id --source winget --accept-package-agreements --accept-source-agreements --silent
    Update-PathFromSystem
}

function Test-PortInUse([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $attempt = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $attempt.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($attempt)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

Write-Host ''
Write-Host 'Setting up shopr. The first time takes 10-20 minutes, depending on your internet.' -ForegroundColor Green

if (Test-PortInUse 8000) {
    Stop-Install "shopr (or another program) is already running on port 8000. Close the shopr window, then run this again."
}

# --- 1. Tools -----------------------------------------------------------------

Write-Step 'Checking for Git, Node.js and uv'
Update-PathFromSystem
if ($OnWindows -and -not $env:SHOPR_SKIP_TOOLS) {
    if (-not (Test-Command 'git')) { Install-Tool 'Git.Git' 'Git' }
    if ((Get-NodeMajor) -lt 20) { Install-Tool 'OpenJS.NodeJS.LTS' 'Node.js' }
    if (-not (Test-Command 'uv')) {
        Install-Tool 'astral-sh.uv' 'uv'
        if (-not (Test-Command 'uv')) {
            Write-Step 'Installing uv with its official installer'
            Invoke-RestMethod 'https://astral.sh/uv/install.ps1' | Invoke-Expression
            Update-PathFromSystem
        }
    }
    if (-not (Test-VCRedist)) { Install-Tool 'Microsoft.VCRedist.2015+.x64' 'Microsoft Visual C++ runtime' }
}
if (-not (Test-Command 'git')) { Stop-Install 'Git still is not available. Install it from https://git-scm.com and run this again.' }
if ((Get-NodeMajor) -lt 20) { Stop-Install 'Node.js 20 or newer is not available. Install the LTS version from https://nodejs.org and run this again.' }
if (-not (Test-Command 'uv')) { Stop-Install 'uv still is not available. See https://docs.astral.sh/uv/getting-started/installation/' }
$UvPath = (Get-Command 'uv' | Select-Object -First 1).Source

# --- 2. Code ------------------------------------------------------------------

if (Test-Path (Join-Path $InstallDir '.git')) {
    Write-Step "Updating shopr in $InstallDir"
    Invoke-Native 'Downloading the update' { git -C $InstallDir fetch --depth 1 origin $Branch }
    # Only tracked files are reset; your data and settings (.env) are never touched.
    Invoke-Native 'Applying the update' { git -C $InstallDir reset --hard FETCH_HEAD }
} elseif (Test-Path $InstallDir) {
    Stop-Install "The folder $InstallDir already exists but wasn't made by this installer. Rename or delete it, then run this again."
} else {
    Write-Step "Downloading shopr into $InstallDir"
    Invoke-Native 'Downloading shopr' { git clone --depth 1 -b $Branch $Repo $InstallDir }
}

$Backend = Join-Path $InstallDir 'backend'
$App = Join-Path $InstallDir 'app'

# --- 3. Python side (server + image model) ------------------------------------

Write-Step 'Installing the server (Python and the image-matching libraries, about 2 GB)'
Push-Location $Backend
try {
    Invoke-Native 'Installing the server' { & $UvPath sync --extra ml }
    $envFile = Join-Path $Backend '.env'
    if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $Backend '.env.example') $envFile }
} finally {
    Pop-Location
}

# --- 4. Website ---------------------------------------------------------------

Write-Step 'Building the website'
$Npm = 'npm'
$Npx = 'npx'
if ($OnWindows) {
    # The .cmd versions work even when PowerShell blocks scripts.
    $Npm = 'npm.cmd'
    $Npx = 'npx.cmd'
}
Push-Location $App
try {
    Invoke-Native 'Installing the website parts' { & $Npm ci --no-audit --no-fund }
    Invoke-Native 'Building the website' { & $Npx expo export --platform web }
} finally {
    Pop-Location
}

# --- 5. Image model -----------------------------------------------------------

Write-Step 'Downloading the image model (about 800 MB, only the first time)'
Push-Location $Backend
try {
    Invoke-Native 'Downloading the image model' {
        & $UvPath run python -c "from shopr.embedder import SiglipEmbedder; SiglipEmbedder(); print('Image model ready.')"
    }
} finally {
    Pop-Location
}

# --- 6. Launcher and desktop icon ---------------------------------------------

Write-Step 'Creating the "Start shopr" icon'
$Launcher = Join-Path $InstallDir 'Start shopr.cmd'
# No absolute paths in the launcher: cmd expands these variables itself, which also
# keeps it working for user names with spaces or accents.
$lines = @(
    '@echo off',
    'title shopr',
    'cd /d "%~dp0backend"',
    'set "UV=uv"',
    'where uv >nul 2>nul || (',
    '  if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\uv.exe" set "UV=%LOCALAPPDATA%\Microsoft\WinGet\Links\uv.exe"',
    '  if exist "%USERPROFILE%\.local\bin\uv.exe" set "UV=%USERPROFILE%\.local\bin\uv.exe"',
    ')'
)
if ($PythonOverride) { $lines += "set UV_PYTHON=$PythonOverride" }
$lines += @(
    '"%UV%" run shopr --open',
    'rem Exit code 3: shopr was already running and has been opened in the browser.',
    'if %errorlevel%==3 (',
    '  timeout /t 6 >nul',
    '  exit /b 0',
    ')',
    'echo.',
    'echo shopr has stopped. Press any key to close this window.',
    'pause >nul'
)
Set-Content -Path $Launcher -Value $lines -Encoding ASCII

$Icon = Join-Path $InstallDir 'shopr.ico'
Push-Location $Backend
try {
    $png = Join-Path $App 'assets\icon.png'
    & $UvPath run python -c "import sys; from PIL import Image; Image.open(sys.argv[1]).save(sys.argv[2], sizes=[(256, 256), (48, 48), (32, 32), (16, 16)])" $png $Icon
} catch {
    Write-Host 'Could not make the icon picture; the shortcut will use a default icon.'
} finally {
    Pop-Location
}

if ($OnWindows) {
    $desktop = [System.Environment]::GetFolderPath('Desktop')
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $desktop 'Start shopr.lnk'))
    $shortcut.TargetPath = $Launcher
    $shortcut.WorkingDirectory = $InstallDir
    if (Test-Path $Icon) { $shortcut.IconLocation = $Icon }
    $shortcut.Description = 'Start the shopr server'
    $shortcut.Save()

    # The phone can only connect when Windows treats the Wi-Fi as a private network.
    try {
        $public = Get-NetConnectionProfile -ErrorAction Stop | Where-Object { $_.NetworkCategory -eq 'Public' }
        if ($public) {
            Write-Host ''
            Write-Host "Heads up: Windows treats your network '$($public[0].Name)' as Public, which blocks your phone." -ForegroundColor Yellow
            Write-Host 'If that is your home Wi-Fi, change it to Private: Settings > Network & internet > Wi-Fi > (your network) > Private network.' -ForegroundColor Yellow
        }
    } catch {
        # Not available on every Windows edition; skip the check.
    }
}

# --- Done ---------------------------------------------------------------------

Write-Host ''
Write-Host 'All set!' -ForegroundColor Green
Write-Host 'To use shopr, double-click "Start shopr" on your desktop. A window opens: keep it open while'
Write-Host 'you use shopr, and your browser opens shopr by itself. The window also shows the address'
Write-Host 'to type into the phone app.'
Write-Host 'To update shopr later, run the same install line again.'

if ($OnWindows -and -not $env:SHOPR_NO_START) {
    Write-Host ''
    Write-Host 'Starting shopr now...'
    Start-Process -FilePath $Launcher -WorkingDirectory $InstallDir
}
