#!/usr/bin/env python3
"""Rebuild data/songs.json, the home page listing, from the song folders.

    scripts/build-index.py            every folder under data/songs

Run it after writing a song by hand or removing one; the importers run it
themselves. Existing rows keep their order, new songs are appended. It also
writes songs/<id>.html for every song (from song.html) and, when data/site.json
names the site's url, sitemap.xml and robots.txt. Songs under private/songs/
(a folder git ignores) get their own private/songs.json and nothing else.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from songlib import build_index  # noqa: E402

root = Path(__file__).resolve().parent.parent / "data" / "songs"
rows = build_index(root)
print(f"{len(rows)} song(s) in {root.parent / 'songs.json'}, pages in {root.parent.parent / 'songs'}")
private = root.parent.parent / "private" / "songs"
if private.is_dir():
    print(f"{len(build_index(private))} private song(s) in {private.parent / 'songs.json'} (never committed)")
if (root.parent.parent / "sitemap.xml").exists():
    print(f"sitemap.xml and robots.txt written for {json.loads((root.parent / 'site.json').read_text()).get('url')}")
