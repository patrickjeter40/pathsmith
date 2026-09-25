param([Parameter(ValueFromRemainingArguments=$true)][string[]]$PnpmArguments)
$workspacePath = Split-Path -Parent $PSScriptRoot
$localNode = Join-Path $workspacePath '.tooling\node_modules\node\bin\node.exe'
$localPnpm = Join-Path $workspacePath '.tooling\node_modules\pnpm\bin\pnpm.cjs'
if (!(Test-Path -LiteralPath $localNode) -or !(Test-Path -LiteralPath $localPnpm)) {
  throw 'Local toolchain missing. Install Node 24 and pnpm 10.33.0, or run: npm install --prefix .tooling --no-save node@24.21.0 pnpm@10.33.0'
}
$previousPath = $env:PATH
try {
  $env:PATH = (Split-Path -Parent $localNode) + ';' + (Join-Path $workspacePath '.tooling\node_modules\.bin') + ';' + $env:PATH
  & $localNode $localPnpm @PnpmArguments
  $commandExit = $LASTEXITCODE
} finally {
  $env:PATH = $previousPath
}
exit $commandExit
