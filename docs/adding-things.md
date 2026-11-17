# Adding things

Every routine ends the same way: **push, then look at the Actions tab**. Green means published. Red means
nothing was published; open the run and read the list of problems.

Files can be written by hand or with the helper: `powershell -ExecutionPolicy Bypass -File .\tools\add.ps1`.
Always do things in this order: **series, then items, then banner** (a banner needs its items; an item needs its
series).

## A new banner

1. Make sure every featured item (5-star and 4-star) has an item folder. If not, add them first (next section).
2. Create `banners/<id>.json`. The id is up to you; the file name must be the id plus `.json`.

```json
{
  "id": "hk4e-character-2026-11-04",
  "game": "hk4e",
  "pool": "character",
  "name": "Myriad Patterns Unfold",
  "start": "2026-11-03 15:00:00",
  "end": "2026-11-24 17:59:59",
  "featured_5": ["10000136"],
  "featured_4": [],
  "gacha_ids": []
}
```

- `pool` is the pity this banner shares. All banners of one pool share pity: `character` or `weapon`
  (Star Rail also has `collab` and `collab_weapon`).
- `start` and `end` are the game's server clock. The end is the last second the banner is open.
- `featured_5` and `featured_4` are item ids (not names), written in quotes.
- `gacha_ids` is only used by Star Rail and Zenless. Use `[]` otherwise.
- If a banner has the same id as one the app already knows, yours replaces it. Use a new id to add one.

## A new character or weapon

1. If it uses a farming series that is not in `materials/schedule.json` yet, add the series first (next section).
2. Create the folder `items/<game>/<name>/`, lowercase with dashes, for example `items/hk4e/mitya/`.
3. Put `item.json` in it:

```json
{
  "game": "hk4e",
  "id": "10000136",
  "name": "Mitya",
  "aliases": [],
  "rarity": 5,
  "kind": "character",
  "element": "electro",
  "series": "teachings_of_charity"
}
```

| Game and kind | Extra lines it needs |
| --- | --- |
| `hk4e` character | `"element"` (anemo, cryo, dendro, electro, geo, hydro, pyro) and `"series"` (a talent book series) |
| `hk4e` weapon (`"kind": "weapon"`) | `"weapon_type"` (sword, claymore, polearm, bow, catalyst) and `"series"` (a weapon material series) |
| `hkrpg` character | `"element"` (physical, fire, ice, lightning, wind, quantum, imaginary) and `"path"` |
| `hkrpg` light cone (`"kind": "light_cone"`) | nothing |
| `nap` character | `"element"` (physical, ice, fire, electric, ether, wind, lumen) and `"specialty"` |
| `nap` weapon or bangboo | nothing |

`id` is the game's item number in quotes (digits only). `aliases` are other names the item is known by.

4. Put the pictures next to it, with exactly these names: `icon.png` for every item, and `wish.png` (the wish
   art) for characters. `.webp` works too. Icons must be at most 512 KB, wish art at most 3 MB.
5. Push. Players get it the next time their app checks (about once a day, or when they press Check for updates).
   Pictures for items you add are downloaded from your site, not from other sites.

To change an item, edit its files and push. An item with the same game and id as one the app already knows
replaces it.

## A new farming series

1. Add an entry to `books` (talent books) or `weapons` (weapon materials) in `materials/schedule.json`:

```json
{
  "books": [
    {"id": "teachings_of_charity", "name": "Charity", "title": "Teachings of Charity", "days": [1, 4]}
  ],
  "weapons": []
}
```

- `id` is lowercase letters, digits and underscores. Items point at it with their `"series"` line.
- `days` are the weekdays it can be farmed, Monday = 1 to Saturday = 6. Sunday is never written because every
  domain is open on Sundays.
- The list of items that use a series is built from each item's `"series"` line. You never write it here.

2. Add its picture as `materials/pictures/<id>.png` (for example `materials/pictures/teachings_of_charity.png`).
3. Push.
