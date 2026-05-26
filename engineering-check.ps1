param(
  [switch]$Strict
)

harness check --cwd (Get-Location).Path $(if ($Strict) { "--strict" })
