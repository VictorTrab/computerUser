# Registra el Native Messaging Host para Chrome, Brave y Edge apuntando al binario local e independiente
$manifestPath = "C:\Users\User\projects\computerUser\runtime\extension-host\com.openai.codexextension.json"

if (-not (Test-Path $manifestPath)) {
    Write-Error "No se encontro el archivo de manifiesto en: $manifestPath"
    exit 1
}

$targets = @(
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.openai.codexextension",
    "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.openai.codexextension",
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.openai.codexextension"
)

foreach ($regPath in $targets) {
    $parent = Split-Path $regPath
    if (-not (Test-Path $parent)) {
        New-Item -Path $parent -ItemType Directory -Force | Out-Null
    }
    New-Item -Path $regPath -Force | Out-Null
    Set-ItemProperty -Path $regPath -Name "(default)" -Value $manifestPath
    Write-Host "[OK] Registrado $regPath -> $manifestPath"
}
