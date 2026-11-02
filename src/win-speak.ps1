$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName System.Speech
$en = New-Object System.Speech.Synthesis.SpeechSynthesizer
$zh = New-Object System.Speech.Synthesis.SpeechSynthesizer
$enName = $null
$zhName = $null
foreach ($v in $en.GetInstalledVoices()) {
  if (-not $v.Enabled) { continue }
  $n = $v.VoiceInfo.Name
  $c = [string]$v.VoiceInfo.Culture.Name
  if ($c -like 'en*') { $enName = $n }
  if ($n -match 'Zira') { $enName = $n }
  if ($c -like 'zh*') { $zhName = $n }
  if ($n -match 'Huihui') { $zhName = $n }
}
if ($enName) { $en.SelectVoice($enName) }
if ($zhName) { $zh.SelectVoice($zhName) }
$en.Volume = 100
$zh.Volume = 100
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq 'EXIT') { break }
  try {
    $obj = $line | ConvertFrom-Json
    $synth = $en
    if ([string]$obj.lang -like 'zh*') { $synth = $zh }
    $synth.Rate = [int]$obj.rate
    $synth.SetOutputToWaveFile([string]$obj.out)
    $synth.Speak([string]$obj.text)
    $synth.SetOutputToNull()
    [Console]::Out.WriteLine('OK')
  } catch {
    try { $en.SetOutputToNull() } catch {}
    try { $zh.SetOutputToNull() } catch {}
    [Console]::Out.WriteLine('ERR ' + $_.Exception.Message)
  }
  [Console]::Out.Flush()
}
