$ErrorActionPreference = "Stop"

function Get-ProductionDatabaseUrl {
    if (-not [string]::IsNullOrWhiteSpace($env:CAMPUSFIX_SUPABASE_DATABASE_URL)) {
        return $env:CAMPUSFIX_SUPABASE_DATABASE_URL
    }

    $secureUrl = Read-Host "Enter the Supabase production DATABASE_URL" -AsSecureString
    $urlPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($urlPointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($urlPointer)
    }
}

$previousDatabaseUrl = $env:DATABASE_URL
$productionDatabaseUrl = $null
$safeFailureReason = $null
$locationPushed = $false

try {
    $productionDatabaseUrl = Get-ProductionDatabaseUrl
    if ([string]::IsNullOrWhiteSpace($productionDatabaseUrl)) {
        $safeFailureReason = "A production database URL is required."
        throw "A production database URL is required."
    }

    $parsedUrl = $null
    if (-not [Uri]::TryCreate($productionDatabaseUrl, [UriKind]::Absolute, [ref]$parsedUrl)) {
        $safeFailureReason = "The database URL is invalid."
        throw "The database URL is not a valid absolute URL."
    }
    if ($parsedUrl.Scheme -notin @("postgres", "postgresql", "postgresql+psycopg")) {
        $safeFailureReason = "Only PostgreSQL database URLs are accepted."
        throw "Only PostgreSQL database URLs are accepted."
    }

    $hostName = $parsedUrl.Host.TrimEnd(".").ToLowerInvariant()
    if ($hostName -notmatch '^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$') {
        $safeFailureReason = "The host must be a Supabase Session Pooler hostname."
        throw "Refusing to run: the host must be a Supabase Session Pooler hostname."
    }
    if ($parsedUrl.Port -ne 5432) {
        $safeFailureReason = "The Supabase Session Pooler port must be 5432."
        throw "Refusing to run: the Supabase Session Pooler port must be 5432."
    }

    $credentials = $parsedUrl.UserInfo.Split(':', 2)
    if ($credentials.Count -ne 2 -or
        [string]::IsNullOrWhiteSpace([Uri]::UnescapeDataString($credentials[0])) -or
        [string]::IsNullOrWhiteSpace([Uri]::UnescapeDataString($credentials[1]))) {
        $safeFailureReason = "The connection URL must include a username and password."
        throw "The connection URL must include a username and password."
    }
    if ([string]::IsNullOrWhiteSpace($parsedUrl.AbsolutePath.Trim('/'))) {
        $safeFailureReason = "The connection URL must include a database name."
        throw "The connection URL must include a database name."
    }

    $sslModes = @(
        $parsedUrl.Query.TrimStart('?').Split('&') |
            Where-Object { $_ -match '^sslmode=' } |
            ForEach-Object { [Uri]::UnescapeDataString(($_ -split '=', 2)[1]).ToLowerInvariant() }
    )
    if ($sslModes.Count -ne 1 -or $sslModes[0] -notin @("require", "verify-ca", "verify-full")) {
        $safeFailureReason = "The connection URL must require TLS."
        throw "The connection URL must require TLS with sslmode=require, verify-ca, or verify-full."
    }

    $backendDirectory = Split-Path -Parent $PSScriptRoot
    if (-not (Test-Path (Join-Path $backendDirectory "app\migrate.py"))) {
        $safeFailureReason = "Could not locate backend/app/migrate.py."
        throw "Could not locate backend/app/migrate.py."
    }

    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        $safeFailureReason = "Python was not found. Activate the backend virtual environment and retry."
        throw "Python was not found. Activate the backend virtual environment and retry."
    }

    $env:DATABASE_URL = $productionDatabaseUrl
    Push-Location $backendDirectory
    $locationPushed = $true

    $null = & python -m app.migrate 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "The schema migration failed. Detailed output was suppressed to protect connection details."
    }

    Write-Host "CampusFix Supabase schema migration completed successfully."
}
catch {
    if ($safeFailureReason) {
        Write-Error ("CampusFix production migration stopped: " + $safeFailureReason)
    }
    else {
        Write-Error "CampusFix production migration failed; detailed output was suppressed."
    }
    exit 1
}
finally {
    if ($locationPushed) {
        Pop-Location
    }

    if ($null -eq $previousDatabaseUrl) {
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    }
    else {
        $env:DATABASE_URL = $previousDatabaseUrl
    }

    $productionDatabaseUrl = $null
    $safeFailureReason = $null
}
