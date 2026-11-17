# Asks a few questions and creates the files for a new item, banner or farming series in the
# right basket, so nobody has to write JSON by hand. A convenience only: the check that runs on
# every push is the real judge, and files written by hand work just as well.
#
# Windows PowerShell 5 is enough. Run it from the repository folder:
#   powershell -ExecutionPolicy Bypass -File .\tools\add.ps1
#
# (This file is plain ASCII on purpose, so PowerShell 5 reads it correctly.)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# ---- small helpers ---------------------------------------------------------------------------

function Ask([string]$Question, [string]$Default = '') {
    if ($Default -ne '') { $answer = Read-Host "$Question [$Default]" } else { $answer = Read-Host $Question }
    $answer = "$answer".Trim()
    if ($answer -eq '') { return $Default }
    return $answer
}

function AskChoice([string]$Question, [string[]]$Choices, [string]$Default = '') {
    while ($true) {
        $answer = (Ask "$Question ($($Choices -join ', '))" $Default).ToLowerInvariant()
        if ($Choices -contains $answer) { return $answer }
        Write-Host "  Please type one of: $($Choices -join ', ')" -ForegroundColor Yellow
    }
}

function AskRequired([string]$Question, [string]$Default = '') {
    while ($true) {
        $answer = Ask $Question $Default
        if ($answer -ne '') { return $answer }
        Write-Host '  This one cannot be empty.' -ForegroundColor Yellow
    }
}

function AskPattern([string]$Question, [string]$Pattern, [string]$Hint, [string]$Default = '') {
    # For answers that become part of a file name: ask again until the answer is one the check allows.
    while ($true) {
        $answer = AskRequired $Question $Default
        if ($answer -cmatch $Pattern) { return $answer }
        Write-Host "  $Hint" -ForegroundColor Yellow
    }
}

function AskList([string]$Question) {
    $answer = Ask "$Question (separate with commas, or press Enter for none)"
    $list = @()
    foreach ($part in $answer.Split(',')) {
        if ($part.Trim() -ne '') { $list += $part.Trim() }
    }
    return , $list
}

function JsonText([string]$Text) {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($ch in $Text.ToCharArray()) {
        $code = [int]$ch
        if ($ch -eq '"') { [void]$sb.Append('\"') }
        elseif ($ch -eq '\') { [void]$sb.Append('\\') }
        elseif ($code -lt 32) { [void]$sb.Append(('\u{0:x4}' -f $code)) }
        else { [void]$sb.Append($ch) }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}

function JsonStringList([string[]]$Values) {
    $quoted = @()
    foreach ($v in $Values) { $quoted += (JsonText $v) }
    return '[' + ($quoted -join ', ') + ']'
}

function WriteFileUtf8([string]$Path, [string]$Content) {
    # UTF-8 without the invisible byte-order mark that Windows PowerShell 5 adds otherwise.
    # The folder is made first: a fresh clone has no banners/ folder until the first banner exists.
    [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($Path))
    [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

function Slug([string]$Text) {
    $slug = $Text.ToLowerInvariant() -replace '[^a-z0-9]+', '-'
    return $slug.Trim('-')
}

function CopyPicture([string]$Source, [string]$TargetFolder, [string]$BaseName) {
    $Source = $Source.Trim('"').Trim()
    if ($Source -eq '') { return }
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        Write-Host "  Could not find $Source - add the picture by hand later as $BaseName.png" -ForegroundColor Yellow
        return
    }
    $extension = [System.IO.Path]::GetExtension($Source).ToLower()
    if ($extension -ne '.png' -and $extension -ne '.webp') {
        Write-Host "  $Source is not a .png or .webp file - add the picture by hand later as $BaseName.png" -ForegroundColor Yellow
        return
    }
    [void][System.IO.Directory]::CreateDirectory($TargetFolder) # materials/pictures/ does not exist until the first series picture
    Copy-Item -LiteralPath $Source -Destination (Join-Path $TargetFolder ($BaseName + $extension)) -Force
}

# ---- what to create --------------------------------------------------------------------------

$Elements = @{
    hk4e  = @('anemo', 'cryo', 'dendro', 'electro', 'geo', 'hydro', 'pyro')
    hkrpg = @('physical', 'fire', 'ice', 'lightning', 'wind', 'quantum', 'imaginary')
    nap   = @('physical', 'ice', 'fire', 'electric', 'ether', 'wind', 'lumen')
}
$Kinds = @{
    hk4e  = @('character', 'weapon')
    hkrpg = @('character', 'light_cone')
    nap   = @('character', 'weapon', 'bangboo')
}
$Pools = @{
    hk4e  = @('character', 'weapon')
    hkrpg = @('character', 'weapon', 'collab', 'collab_weapon')
    nap   = @('character', 'weapon')
}

function NewItem {
    $game = AskChoice 'Which game?' @('hk4e', 'hkrpg', 'nap') 'hk4e'
    $kind = AskChoice 'What kind of item?' $Kinds[$game] 'character'
    $name = AskRequired 'English name (for example Mitya)'
    $slug = Slug $name
    if ($slug -eq '') { throw "A folder name cannot be made from '$name'. Run this again and write the English name with the letters a to z or digits." }
    $folder = Join-Path $Root "items/$game/$slug"
    if (Test-Path $folder) { throw "$folder already exists. Edit it instead of adding it again." }
    $id = AskRequired "The game's item number, digits only (for example 10000136)"
    $rarity = AskChoice 'Rarity in stars?' @('1', '2', '3', '4', '5') '5'
    $aliases = AskList 'Other names the item is known by'

    $lines = @()
    $lines += '  "game": ' + (JsonText $game)
    $lines += '  "id": ' + (JsonText $id)
    $lines += '  "name": ' + (JsonText $name)
    $lines += '  "aliases": ' + (JsonStringList $aliases)
    $lines += '  "rarity": ' + $rarity
    $lines += '  "kind": ' + (JsonText $kind)

    if ($kind -eq 'character') {
        $lines += '  "element": ' + (JsonText (AskChoice 'Element?' $Elements[$game]))
        if ($game -eq 'hkrpg') {
            $lines += '  "path": ' + (JsonText (AskChoice 'Path?' @('destruction', 'hunt', 'erudition', 'harmony', 'nihility', 'preservation', 'abundance', 'remembrance', 'elation')))
        }
        if ($game -eq 'nap') {
            $lines += '  "specialty": ' + (JsonText (AskChoice 'Specialty?' @('attack', 'stun', 'support', 'anomaly', 'defense', 'rupture', 'armorer')))
        }
    }
    if ($game -eq 'hk4e' -and $kind -eq 'weapon') {
        $lines += '  "weapon_type": ' + (JsonText (AskChoice 'Weapon type?' @('sword', 'claymore', 'polearm', 'bow', 'catalyst')))
    }
    if ($game -eq 'hk4e') {
        $what = 'talent book'
        if ($kind -eq 'weapon') { $what = 'weapon material' }
        $lines += '  "series": ' + (JsonText (AskRequired "Farming series id of its $what (for example teachings_of_charity)"))
    }

    New-Item -ItemType Directory -Path $folder | Out-Null
    WriteFileUtf8 (Join-Path $folder 'item.json') ("{`n" + ($lines -join ",`n") + "`n}`n")

    Write-Host ''
    Write-Host 'Pictures: type or paste the path of each file, or press Enter to add it by hand later.'
    CopyPicture (Ask 'Icon picture (.png or .webp)') $folder 'icon'
    if ($kind -eq 'character') { CopyPicture (Ask 'Wish art picture (.png or .webp)') $folder 'wish' }
    Write-Host "Created $folder" -ForegroundColor Green
}

function NewBanner {
    $game = AskChoice 'Which game?' @('hk4e', 'hkrpg', 'nap') 'hk4e'
    $pool = AskChoice 'Which pity pool does it share?' $Pools[$game] 'character'
    $name = AskRequired 'Banner title'
    $start = AskRequired 'Starts (server clock, like 2026-11-03 15:00:00)'
    $end = AskRequired 'Ends (like 2026-11-24 17:59:59)'
    $suggested = "$game-$pool-" + $start.Substring(0, [Math]::Min(10, $start.Length))
    $id = AskPattern 'Banner id (also the file name)' '^[a-z0-9][a-z0-9._-]{0,79}$' 'Use lowercase letters, digits, dots, dashes and underscores only (up to 80, no spaces or slashes).' $suggested
    $five = AskList 'Featured 5-star item ids'
    $four = AskList 'Featured 4-star item ids'
    $gacha = AskList 'Game gacha ids (Star Rail and Zenless only)'

    $path = Join-Path $Root "banners/$id.json"
    if (Test-Path $path) { throw "$path already exists. Edit it instead." }
    $lines = @()
    $lines += '  "id": ' + (JsonText $id)
    $lines += '  "game": ' + (JsonText $game)
    $lines += '  "pool": ' + (JsonText $pool)
    $lines += '  "name": ' + (JsonText $name)
    $lines += '  "start": ' + (JsonText $start)
    $lines += '  "end": ' + (JsonText $end)
    $lines += '  "featured_5": ' + (JsonStringList $five)
    $lines += '  "featured_4": ' + (JsonStringList $four)
    $lines += '  "gacha_ids": ' + (JsonStringList $gacha)
    WriteFileUtf8 $path ("{`n" + ($lines -join ",`n") + "`n}`n")
    Write-Host "Created $path" -ForegroundColor Green
    Write-Host 'Every featured item needs its own folder under items/ before you push.'
}

function SeriesLines($Entries) {
    $blocks = @()
    foreach ($e in $Entries) {
        $blocks += "    {`"id`": " + (JsonText $e.id) + ', "name": ' + (JsonText $e.name) + ', "title": ' + (JsonText $e.title) + ', "days": [' + ($e.days -join ', ') + ']}'
    }
    return $blocks -join ",`n"
}

function NewSeries {
    $group = AskChoice 'Is it a talent book or a weapon material series?' @('book', 'weapon') 'book'
    $title = AskRequired 'Full name (for example Teachings of Charity)'
    $name = AskRequired 'Short name (for example Charity)'
    $id = AskPattern 'Series id' '^[a-z0-9_]+$' 'Use lowercase letters, digits and underscores only, for example teachings_of_charity.' ((Slug $title) -replace '-', '_')
    $dayText = AskRequired 'Weekdays it can be farmed, Monday=1 to Saturday=6 (for example 1,4)'
    $days = @()
    foreach ($d in $dayText.Split(',')) { $days += [int]($d.Trim()) }

    $path = Join-Path $Root 'materials/schedule.json'
    # Read as UTF-8 on purpose: Windows PowerShell 5 would read this file as ANSI and garble non-English letters.
    $current = [System.IO.File]::ReadAllText($path, (New-Object System.Text.UTF8Encoding($false))) | ConvertFrom-Json
    $books = @()
    $weapons = @()
    foreach ($b in @($current.books)) { if ($b) { $books += [pscustomobject]@{ id = $b.id; name = $b.name; title = $b.title; days = @($b.days) } } }
    foreach ($w in @($current.weapons)) { if ($w) { $weapons += [pscustomobject]@{ id = $w.id; name = $w.name; title = $w.title; days = @($w.days) } } }
    $entry = [pscustomobject]@{ id = $id; name = $name; title = $title; days = $days }
    if ($group -eq 'book') { $books += $entry } else { $weapons += $entry }

    $text = "{`n  `"books`": [`n" + (SeriesLines $books) + "`n  ],`n  `"weapons`": [`n" + (SeriesLines $weapons) + "`n  ]`n}`n"
    $text = $text.Replace("[`n`n  ]", '[]')
    WriteFileUtf8 $path $text
    Write-Host ''
    CopyPicture (Ask 'Picture of the series (.png or .webp)') (Join-Path $Root 'materials/pictures') $id
    Write-Host "Added $id to materials/schedule.json" -ForegroundColor Green
}

# ---- go --------------------------------------------------------------------------------------

Write-Host ''
Write-Host 'What do you want to add?'
Write-Host '  1  A character or weapon'
Write-Host '  2  A banner'
Write-Host '  3  A farming series (talent book or weapon material)'
$choice = AskChoice 'Type 1, 2 or 3' @('1', '2', '3')
if ($choice -eq '1') { NewItem }
if ($choice -eq '2') { NewBanner }
if ($choice -eq '3') { NewSeries }

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    Write-Host ''
    Write-Host 'Checking everything now...'
    # From the repository folder, so it is this repository that gets checked wherever the helper was started.
    Push-Location $Root
    try { & node 'scripts/validate.mjs' } finally { Pop-Location }
} else {
    Write-Host ''
    Write-Host 'Node.js is not installed here, so the check was skipped. It runs on GitHub when you push.'
}
