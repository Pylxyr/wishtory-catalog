# wishtory-catalog

The data and pictures for the [Wishtory](https://github.com/Pylxyr/Wishtory) app: characters, weapons,
banners and the weekly farming schedule. You put plain files in folders and push. A GitHub Action checks them,
signs them and publishes them as static files on GitHub Pages. There is no server and nothing to run by hand.

Published at `https://pylxyr.github.io/wishtory-catalog/v1/` (the signed data is `own.envelope.json` there).
The Wishtory app does not read this data yet. This is a static site: nothing is ever sent to it, so no wish or
account data can end up here.

## The three baskets

| Folder | What goes in it |
| --- | --- |
| `items/<game>/<name>/` | One folder per character or weapon: `item.json`, `icon.png`, and for characters `wish.png` |
| `banners/` | One file per banner, named after its id: `<id>.json` |
| `materials/` | `schedule.json` (talent book and weapon material series with their days) and `pictures/<series-id>.png` |

`<game>` is `hk4e` (Genshin Impact), `hkrpg` (Honkai: Star Rail) or `nap` (Zenless Zone Zero).
The folder `examples/` holds one finished example of each basket (Mitya, Starsealed Edict). It is checked on
every push but never published. Formats and the routines are in [docs/adding-things.md](docs/adding-things.md).

## What the check refuses

Before anything is published, every push is checked, and one problem stops the publish. The run lists each
problem in plain words with the file it is in. The check refuses:

- JSON that is not valid, unknown or misspelled fields, and values that are not allowed;
- pictures that are not a real PNG or WebP (the contents are read, not the file name), cut-off or damaged
  pictures, icons over 512 KB, wish art over 3 MB, or sides under 16 or over 4096 pixels;
- an item without its required pictures, two items with the same id, a banner that features an item that does
  not exist, an item that names a farming series that does not exist, and a series without its picture.

## One-time setup

1. Create the public repository `Pylxyr/wishtory-catalog` and push these files to `main`.
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. In the repository: **Settings → Secrets and variables → Actions → New repository secret**, name
   `CATALOG_SIGNING_KEY`, value the full text of the signing key (the same one the Wishtory repository uses,
   including the `-----BEGIN` and `-----END` lines). See [docs/signing-key.md](docs/signing-key.md).
4. Push anything. The first run publishes version 1 (empty baskets are fine).

## Limits worth knowing

GitHub Pages sites may be at most 1 GB, have a soft limit of 100 GB of traffic a month, and a deployment that
takes over 10 minutes times out. A custom Actions workflow like this one is not subject to the soft limit of 10
builds per hour. The build stops at 900 MB. Pages is not meant as free hosting for an online business or shop.

The pictures are game artwork. They belong to their owners; this repository only hosts what you add. Check the
official fan-content rules of the game's publisher before you publish artwork, and keep the credits in the
Wishtory app up to date.

## More

- [docs/adding-things.md](docs/adding-things.md): add a banner, a character or a farming series
- [docs/rollback.md](docs/rollback.md): undo a bad publish
- [docs/signing-key.md](docs/signing-key.md): back up and replace the signing key
- [docs/moving-host.md](docs/moving-host.md): move to another host later
- `tools/add.ps1`: a Windows PowerShell helper that asks questions and writes the files for you
