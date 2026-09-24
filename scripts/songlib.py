"""Shared pieces of the song importers: what happens after a source has been
parsed into Nagori's track format (documented in docs/song-format.md).

An importer's job is to produce, in this format:

    tracks   [{ id, name, role, instrument, strings, tuning, kind, measures,
                capo?, tempo?, partId? }]           string-instrument parts
    vocal    { measures, lyrics, offset }            optional, for the generated sheet
    sheet    { source, sections }                    optional, a chord sheet from the source
    video    { provider, id, title, barTimes }       optional
    source   { name, url, ... }

and then call assemble_song() and write_song(). Everything a source does not
carry comes from the song folder's curation.json (see the README).
Only the Python standard library is used.
"""

import datetime
import json
import re
import sys
from fractions import Fraction
from html import escape as html_escape
from pathlib import Path
from urllib.parse import quote
from xml.sax.saxutils import escape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from chord_detect import detect_chord_timeline  # noqa: E402

# Per-part keys a curation file may set on a track, copied into song.json as they are.
TRACK_META_KEYS = ("name", "role", "sound", "level", "fingering", "chordLibrary", "instrument")
SOUND_NAMES = ("acoustic", "electric", "overdrive", "nylon", "muted")


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


# --- Tempo ------------------------------------------------------------------

def quarter_bpm(entry):
    """Tempo in quarter notes per minute, the unit playback and the video clock use."""
    value = entry["bpm"] * 4 / entry["unit"]
    return int(value) if float(value).is_integer() else round(value, 2)


def bar_times_from_tempo(measures, tempo, bpm=None, signature=(4, 4), offset=0.0):
    """Bar start times (seconds) at the written tempo, like js/tab-audio.js tabBarTimes.

    Time signatures carry forward from the last measure that sets `sig`; tempo
    entries take effect at the start of the bar they name. Returns (bar_times, end).
    """
    entries = sorted(tempo or [], key=lambda e: (e["bar"], e["pos"]))
    sig = list(signature)
    current = quarter_bpm(entries[0]) if entries else (bpm or 120)
    idx = 0
    times = []
    t = float(offset)
    for bar, measure in enumerate(measures):
        if measure.get("sig"):
            sig = list(measure["sig"])
        while idx < len(entries) and entries[idx]["bar"] <= bar:
            current = quarter_bpm(entries[idx])
            idx += 1
        times.append(round(t, 4))
        quarters = sig[0] * 4 / sig[1]
        t += quarters * 60 / current
    return times, round(t, 4)


# --- Naming -----------------------------------------------------------------

PITCH_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]
KNOWN_TUNINGS = {
    (64, 59, 55, 50, 45, 40): "Standard",
    (64, 59, 55, 50, 45, 38): "Drop D",
    (63, 58, 54, 49, 44, 39): "E♭ standard",
    (62, 57, 53, 48, 43, 38): "D standard",
    (43, 38, 33, 28): "Standard",
}


def tuning_name(tuning):
    notes = " ".join(PITCH_NAMES[m % 12] for m in reversed(tuning))
    known = KNOWN_TUNINGS.get(tuple(tuning))
    return f"{known} ({notes})" if known else notes


def dedupe_names(names, records):
    """Rename repeated section names in place: Chorus, Chorus 2, Chorus 3."""
    seen = {}
    for rec, name in zip(records, names):
        seen[name] = seen.get(name, 0) + 1
        if seen[name] > 1 and not re.search(r"\d", name):
            rec["name"] = f"{name} {seen[name]}"


# --- Chord timeline ---------------------------------------------------------

def bar_lengths(measures, signature=(4, 4)):
    """The whole-note length of every bar, from the signatures the measures carry forward."""
    sig = list(signature)
    out = []
    for measure in measures:
        if measure.get("sig"):
            sig = measure["sig"]
        out.append(Fraction(sig[0], sig[1]))
    return out


def chord_timeline(tracks, priority_ids, signature=(4, 4)):
    """Per-measure chord annotations, taking the first track (by priority) that annotates a bar.

    `pos` is a fraction of the bar (a label 2.5 quarters into a 5/4 bar is 0.5): what
    the page compares its playhead with, and what chord detection writes too.
    """
    ordered = sorted(tracks, key=lambda t: priority_ids.index(t["id"]) if t["id"] in priority_ids else 99)
    n = max(len(t["measures"]) for t in tracks)
    lengths = {id(t): bar_lengths(t["measures"], signature) for t in tracks}
    timeline = []
    for bar in range(n):
        for track in ordered:
            if bar >= len(track["measures"]):
                continue
            pos = Fraction(0)
            length = lengths[id(track)][bar]
            entries = []
            for beat in track["measures"][bar]["beats"]:
                if beat.get("chord"):
                    entries.append({"bar": bar, "pos": float(min(pos / length, Fraction(999, 1000))), "chord": beat["chord"]})
                pos += Fraction(beat["d"][0], beat["d"][1])
            if entries:
                timeline.extend(entries)
                break
    return timeline


# --- Sheets -----------------------------------------------------------------

def progression_sheet(timeline, sections, bars, per_line=4):
    """Chords-per-bar sheet for songs without lyrics: rows of bars per section."""
    by_bar = {}
    current = None
    entries = sorted(timeline, key=lambda e: (e["bar"], e["pos"]))
    idx = 0
    for bar in range(bars):
        chords = []
        while idx < len(entries) and entries[idx]["bar"] == bar:
            chords.append(entries[idx]["chord"])
            current = entries[idx]["chord"]
            idx += 1
        by_bar[bar] = chords or ([current] if current else [])
    out = []
    for i, section in enumerate(sections):
        start = section["bar"]
        end = sections[i + 1]["bar"] if i + 1 < len(sections) else bars
        lines = []
        for row in range(start, end, per_line):
            lines.append({"type": "bars", "bars": [{"bar": b, "chords": by_bar[b]} for b in range(row, min(row + per_line, end))]})
        out.append({"name": section["name"], "lines": lines})
    return out


def lyric_syllables(text):
    """Guitar Pro style lyrics: one syllable per sung beat, '-' joins syllables of a word, '_' is a held note.

    Returns a list of lines, each a list of (syllable_text, joins_next) where
    joins_next means no space follows (a hyphenated word part).
    """
    lines = []
    for raw_line in re.sub(r"\[[^\]]*\]", "", text).split("\n"):
        syllables = []
        for word in raw_line.split():
            if re.fullmatch(r"[_+]+", word):
                syllables.append(("", bool(syllables) and syllables[-1][1]))  # a held note inside a word keeps the word together
                continue
            parts = [part for part in word.split("-") if part]
            if not parts:
                syllables.append(("", False))
                continue
            for i, part in enumerate(parts):
                if re.fullmatch(r"[_+]+", part):
                    syllables.append(("", True))  # a held note inside a word: the rest of the word follows
                else:
                    syllables.append((part, i < len(parts) - 1 or word.endswith("-")))
        lines.append(syllables)
    return lines


def sung_slots(measures, offset=1):
    """(bar, position) of every sung beat of a vocal track in Nagori's format: sounding, not a tie."""
    slots = []
    for bar, measure in enumerate(measures):
        if bar < offset - 1:
            continue
        beats = measure.get("beats", [])
        total = sum(Fraction(b["d"][0], b["d"][1]) for b in beats) or Fraction(1)
        pos = Fraction(0)
        for beat in beats:
            start = pos / total
            pos += Fraction(beat["d"][0], beat["d"][1])
            notes = beat.get("notes") or []
            if beat.get("rest") or not notes or all(n.get("tie") for n in notes):
                continue
            slots.append((bar, float(start)))
    return slots


def lyric_sheet(vocal, timeline, sections, bars):
    """Chords over lyrics, from a vocal track ({ measures, lyrics, offset }) and the chord timeline."""
    lines = lyric_syllables(vocal["lyrics"])
    sections = sections or [{"name": None, "bar": 0}]
    total_syllables = sum(len(ln) for ln in lines)
    slots = sung_slots(vocal["measures"], vocal.get("offset") or 1)
    if total_syllables > len(slots):
        print(f"  lyrics: {total_syllables} syllables but {len(slots)} sung beats; the tail will be unplaced", file=sys.stderr)
    entries = sorted(timeline, key=lambda e: (e["bar"], e["pos"]))

    def chord_at(bar, pos):
        current = None
        for e in entries:
            if (e["bar"], e["pos"]) <= (bar, pos + 1e-6):
                current = e["chord"]
            else:
                break
        return current

    def section_of(bar):
        idx = -1
        for i, sec in enumerate(sections):
            if sec["bar"] <= bar:
                idx = i
        return idx

    slot = 0
    by_section = {}
    for syllables in lines:
        if not syllables:
            continue
        # Transcriptions without line breaks get one line per bar group instead of a wall of text.
        long_line = len(syllables) > 16
        placed = []
        for text, joins in syllables:
            bar, pos = slots[slot] if slot < len(slots) else (bars - 1, 0.0)
            slot += 1
            placed.append((bar, pos, text, joins))
        chunks = []
        for item in placed:
            new_line = not chunks or (long_line and item[0] != chunks[-1][-1][0] and not chunks[-1][-1][3] and len(chunks[-1]) >= 4)
            if new_line:
                chunks.append([item])
            else:
                chunks[-1].append(item)
        for chunk in chunks:
            segments = []
            shown = None
            for bar, pos, text, joins in chunk:
                chord = chord_at(bar, pos)
                piece = text + ("" if joins or not text else " ")  # a held note has no syllable and adds no space
                if chord and chord != shown:
                    segments.append({"chord": chord, "text": piece})
                    shown = chord
                elif segments:
                    segments[-1]["text"] += piece
                else:
                    segments.append({"chord": None, "text": piece})
            if segments:
                segments[-1]["text"] = segments[-1]["text"].rstrip()
            by_section.setdefault(section_of(chunk[0][0]), []).append({"type": "line", "segments": segments})
    out = []
    for i, section in enumerate(sections or [{"name": None, "bar": 0}]):
        lyric_lines = by_section.get(i)
        if lyric_lines:
            out.append({"name": section["name"], "lines": lyric_lines})
        else:
            start = section["bar"]
            end = sections[i + 1]["bar"] if i + 1 < len(sections) else bars
            out.append({"name": section["name"], "lines": progression_sheet(timeline, [{"name": section["name"], "bar": start}], end)[0]["lines"]})
    return out


# --- Assembly ---------------------------------------------------------------

def apply_track_meta(track, override):
    """Copy a curation file's per-part settings (name, role, sound, level, ...) onto a parsed track."""
    if not override:
        return track
    if override.get("id"):
        track["id"] = override["id"]
    for key in TRACK_META_KEYS:
        if key in override:
            track[key] = override[key]
    if "capo" in override:
        track["capo"] = override["capo"]
    return track


def track_entry(track):
    """The song.json row for a track."""
    entry = {k: track.get(k) for k in ("id", "name", "role", "instrument", "strings", "tuning", "kind")}
    if track.get("capo"):
        entry["capo"] = track["capo"]
    for key in ("sound", "level", "fingering", "chordLibrary"):
        if track.get(key) is not None:
            entry[key] = track[key]
    entry["file"] = f"tracks/{track['id']}.json"
    return entry


def video_from_curation(curation, measures, tempo, bpm, signature, bars):
    """A video block from curation.json: `video: { id, title?, barTimes? | offset? }`.

    Without bar times, they are computed from the tempo map, starting `offset`
    seconds into the video (the moment bar 1 starts).
    """
    spec = curation.get("video")
    if not spec or not spec.get("id"):
        return None
    bar_times = spec.get("barTimes")
    if not bar_times:
        bar_times, _ = bar_times_from_tempo(measures, tempo, bpm, signature, spec.get("offset", 0.0))
    return {"provider": spec.get("provider", "youtube"), "id": spec["id"], "title": spec.get("title"), "barTimes": list(bar_times)[:bars]}


def assemble_song(*, slug, title, artist, tracks, curation, source, timeline_only=(), vocal=None, sheet=None, video=None, default_track=None):
    """Everything from parsed tracks to the song.json dict: sections, tempo, chords, sheet, per-part settings."""
    if not tracks:
        raise SystemExit("no string-instrument tracks to import")
    sections = [dict(sec) for sec in (curation.get("sections") or [])]
    if not sections:
        for i, m in enumerate(tracks[0]["measures"]):
            if m.get("marker"):
                sections.append({"name": m["marker"], "bar": i})
    dedupe_names([sec["name"] for sec in sections], sections)  # curated or from markers, a repeated name gets a number
    bars = len(tracks[0]["measures"])
    guitar_capos = {t.get("capo", 0) for t in tracks if t["kind"] == "guitar"}
    capo = curation.get("capo")
    if capo is None:
        capo = guitar_capos.pop() if len(guitar_capos) == 1 else None
    signatures = []
    for m in tracks[0]["measures"]:
        if m.get("sig") and m["sig"] not in signatures:
            signatures.append(m["sig"])
    signature = signatures[0] if signatures else [4, 4]
    tempo = curation.get("tempo") or next((t["tempo"] for t in tracks if t.get("tempo")), [])
    bpm = curation.get("bpm") or (quarter_bpm(tempo[0]) if tempo else None)
    guitar = next((t for t in tracks if t["kind"] == "guitar"), tracks[0])
    tuning_label = curation.get("tuning") or tuning_name(guitar["tuning"])
    if video is None:
        video = video_from_curation(curation, tracks[0]["measures"], tempo, bpm, signature, bars)

    priority = list(curation.get("chordTimelinePriority", [])) + [t["id"] for t in timeline_only]
    timeline = chord_timeline(list(tracks) + list(timeline_only), priority, signature)
    if not timeline:
        vocabulary = set(curation.get("chordVocabulary", []))
        if sheet and not vocabulary:
            for section in sheet["sections"]:
                for line in section["lines"]:
                    for seg in line.get("segments", []):
                        if seg.get("chord"):
                            vocabulary.add(seg["chord"])
        harmony_ids = curation.get("harmonyTracks")
        harmony = [t for t in tracks if harmony_ids is None or t.get("partId") in harmony_ids or t["id"] in harmony_ids]
        bass = [t for t in tracks if t["kind"] == "bass" and t not in harmony]
        # Name chords as the shapes are fingered when every harmony guitar shares a capo.
        capos = {t.get("capo", 0) for t in harmony if t["kind"] == "guitar"}
        common = capos.pop() if len(capos) == 1 else 0
        for t in harmony + bass:
            t["pitchOffset"] = (t.get("capo", 0) if t["kind"] == "guitar" else 0) - common
        timeline = detect_chord_timeline(harmony + bass, bars, vocabulary=sorted(vocabulary) or None)
        print(f"  chords detected from notes: {len(timeline)} changes" + (f" (vocabulary of {len(vocabulary)})" if vocabulary else ""))
    if sheet is None and timeline:
        if vocal is not None and vocal.get("lyrics", "").strip():
            sheet = {"source": "generated", "generated": True, "sections": lyric_sheet(vocal, timeline, sections, bars)}
            print("  chord sheet: generated from the vocal track's lyrics and the chord timeline")
        else:
            sheet = {"source": "generated", "generated": True, "sections": progression_sheet(timeline, sections, bars)}
            print("  chord sheet: generated progression (no lyrics in the transcription)")

    if default_track is None or not any(t["id"] == default_track for t in tracks):
        default_track = tracks[0]["id"]
    return {
        "id": slug,
        "title": title,
        "artist": artist,
        "album": curation.get("album"),
        "year": curation.get("year"),
        "key": curation.get("key"),
        "bpm": bpm,
        "tempo": tempo,
        "timeSignature": signature,
        "tuning": tuning_label,
        "timeSignatures": signatures,
        "capo": capo,
        "bars": bars,
        "source": source,
        "video": video,
        "sections": sections,
        "chordTimeline": timeline,
        "chordSheet": sheet,
        "chordLibrary": curation.get("chordLibrary", {}),
        "fingeringOverrides": curation.get("fingeringOverrides", {}),
        "defaultTrack": curation.get("defaultTrack", default_track),
        "tracks": [track_entry(t) for t in tracks],
    }


def write_song(out_dir, song, tracks, curation):
    """Write song.json and the track files, then refresh the home page index."""
    out_dir = Path(out_dir)
    (out_dir / "tracks").mkdir(parents=True, exist_ok=True)
    (out_dir / "song.json").write_text(json.dumps(song, indent=1, ensure_ascii=False) + "\n")
    for t in tracks:
        (out_dir / "tracks" / f"{t['id']}.json").write_text(
            json.dumps({"id": t["id"], "strings": t["strings"], "tuning": t["tuning"], "measures": t["measures"]},
                       separators=(",", ":"), ensure_ascii=False) + "\n")
    update_index(out_dir, song, curation)


def index_row(song, duration=None, artist_sort=None, added=None):
    """One row of data/songs.json. `artist_sort` (curation `sortArtist`, "Bach, Johann Sebastian") orders the home page's artist sort; `added` is the day the song joined the index."""
    row = {
        "id": song["id"],
        "title": song["title"],
        "artist": song["artist"],
        "album": song.get("album"),
        "year": song.get("year"),
        "key": song.get("key"),
        "bpm": song.get("bpm"),
        "tuning": song.get("tuning"),
        "duration": duration or song.get("duration"),
        "tracks": len(song.get("tracks", [])),
        "video": bool(song.get("video")),
    }
    if artist_sort:
        row["artistSort"] = artist_sort
    if added:
        row["added"] = added
    return row


def song_length(folder, song):
    """The tab's length as m:ss from the tempo map (what tab playback runs to); None when the first track cannot be read."""
    try:
        measures = json.loads((Path(folder) / song["tracks"][0]["file"]).read_text())["measures"]
        _, end = bar_times_from_tempo(measures, song.get("tempo"), song.get("bpm"), song.get("timeSignature") or (4, 4))
    except (KeyError, IndexError, TypeError, OSError, ValueError):
        return None
    minutes, seconds = divmod(int(round(end)), 60)
    return f"{minutes}:{seconds:02d}"


def build_index(root, generate=None):
    """Rebuild data/songs.json (the home page listing) from every song folder under data/songs.

    Songs already listed keep their order; new folders are appended in name
    order; rows whose folder is gone are dropped. For the public root (data/songs,
    the one with site.json beside its index) it also writes songs/<id>.html for every
    song and, with a url in site.json, sitemap.xml and robots.txt; a private root
    (private/songs) gets its index only. Returns the rows.
    """
    root = Path(root)
    index_path = root.parent / "songs.json"
    existing = json.loads(index_path.read_text()) if index_path.exists() else []
    order = [row.get("id") for row in existing]
    previous = {row.get("id"): row for row in existing}
    today = datetime.date.today().isoformat()
    rows = {}
    for folder in sorted(p for p in root.iterdir() if p.is_dir() and (p / "song.json").exists()):
        song = json.loads((folder / "song.json").read_text())
        curation = load_curation(folder)
        added = curation.get("added") or previous.get(folder.name, {}).get("added") or today
        duration = curation.get("duration") or song.get("duration") or song_length(folder, song)
        rows[folder.name] = index_row(song, duration, curation.get("sortArtist"), added)
    ordered = [rows[i] for i in order if i in rows] + [rows[i] for i in sorted(rows) if i not in order]
    index_path.write_text(json.dumps(ordered, indent=1, ensure_ascii=False) + "\n")
    site = load_site(root)
    if generate is None:
        generate = bool(site)
    if generate:
        pages = write_song_pages(root, ordered, site)
        write_site_files(root, ordered, pages=bool(pages))
    return ordered


def sitemap_xml(base_url, song_ids, pages=True):
    """A sitemap for the site at base_url: the home page, the tools page and every song page (songs/<id>.html, or song.html?id= when no pages were written)."""
    base = base_url.rstrip("/")
    locs = [f"{base}/", f"{base}/tools.html"] + [f"{base}/songs/{quote(str(sid))}.html" if pages else f"{base}/song.html?id={quote(str(sid))}" for sid in song_ids]
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    lines += [f"  <url><loc>{escape(loc)}</loc></url>" for loc in locs]
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def robots_txt(base_url=None):
    text = "User-agent: *\nAllow: /\nDisallow: /private/\n"
    if base_url:
        text += f"Sitemap: {base_url.rstrip('/')}/sitemap.xml\n"
    return text


def load_site(root):
    """data/site.json as a dict ({} when there is none)."""
    path = Path(root).parent / "site.json"
    return json.loads(path.read_text()) if path.exists() else {}


def write_site_files(root, rows, pages=True):
    """Write sitemap.xml and robots.txt next to index.html once data/site.json names the site's url. Returns that url."""
    root = Path(root)
    url = str(load_site(root).get("url") or "").strip()
    if not url:
        return None
    top = root.parent.parent
    (top / "sitemap.xml").write_text(sitemap_xml(url, [row["id"] for row in rows], pages))
    (top / "robots.txt").write_text(robots_txt(url))
    return url


def song_page_html(template, song, site):
    """One static page for a song, made from song.html: its own title, description, Open Graph data
    and structured data, served from songs/<id>.html. `<base href="../">` keeps the shared page's
    relative paths working from that folder; `data-song` tells song-page.js which song to open."""
    esc = html_escape
    name = site.get("name") or "Nagori"
    title = f"{song['title']} · {song['artist']} · {name}"
    description = f"Chords, tab, video sync and finger positions for {song['title']} by {song['artist']}."
    url = str(site.get("url") or "").rstrip("/")
    page_url = f"{url}/songs/{song['id']}.html" if url else None
    out = template

    def once(old, new):
        nonlocal out
        assert out.count(old) == 1, f"song.html template: expected one {old[:40]!r}"
        out = out.replace(old, new)

    once('<meta charset="utf-8">\n', '<meta charset="utf-8">\n  <base href="../">\n')
    once(re.search(r"<title>[^<]*</title>", out).group(0), f"<title>{esc(title)}</title>")
    once(re.search(r'<meta name="description" content="[^"]*">', out).group(0), f'<meta name="description" content="{esc(description)}">')
    once(re.search(r'<meta property="og:title" content="[^"]*">', out).group(0), f'<meta property="og:title" content="{esc(title)}">')
    once(re.search(r'<meta property="og:description" content="[^"]*">', out).group(0), f'<meta property="og:description" content="{esc(description)}">')
    extra = []
    if page_url:
        extra += [
            f'<link rel="canonical" href="{esc(page_url)}">',
            f'<meta property="og:url" content="{esc(page_url)}">',
            f'<meta property="og:image" content="{esc(url)}/icons/og.png">',
            f'<meta name="twitter:image" content="{esc(url)}/icons/og.png">',
            f'<link rel="alternate" hreflang="en" href="{esc(page_url)}?lang=en">',
            f'<link rel="alternate" hreflang="zh-Hans" href="{esc(page_url)}?lang=zh">',
            f'<link rel="alternate" hreflang="x-default" href="{esc(page_url)}">',
        ]
    data = {"@context": "https://schema.org", "@type": "MusicComposition", "name": song["title"]}
    if song["artist"].strip().lower() not in ("traditional", "anonymous"):  # a named composer; "(attributed to ...)" stays out of the name
        data["composer"] = {"@type": "Person", "name": re.sub(r"\s*\([^)]*\)\s*$", "", song["artist"])}
    if song.get("album"):
        data["inAlbum"] = {"@type": "MusicAlbum", "name": song["album"]}
    if song.get("year"):
        data["datePublished"] = str(song["year"])
    if page_url:
        data["url"] = page_url
    extra.append('<script type="application/ld+json">' + json.dumps(data, ensure_ascii=False).replace("</", "<\\/") + "</script>")
    once('  <meta property="og:type" content="website">\n', '  <meta property="og:type" content="music.song">\n')
    once('  <meta name="twitter:card" content="summary_large_image">\n', '  <meta name="twitter:card" content="summary_large_image">\n' + "".join(f"  {line}\n" for line in extra))
    once('<main class="song-page" id="app">', f'<main class="song-page" id="app" data-song="{esc(song["id"])}">')
    if out.count('href="#app"') == 1:  # the skip link: a fragment alone would resolve against <base>
        out = out.replace('href="#app"', f'href="songs/{esc(song["id"])}.html#app"')
    return out


def write_song_pages(root, rows, site):
    """songs/<id>.html for every listed song, from the song.html beside index.html; pages of songs no longer listed are removed. Returns the ids written."""
    root = Path(root)
    top = root.parent.parent
    template_path = top / "song.html"
    if not template_path.exists():
        return []
    template = template_path.read_text()
    pages = top / "songs"
    pages.mkdir(exist_ok=True)
    ids = [row["id"] for row in rows]
    for sid in ids:
        song = json.loads((root / sid / "song.json").read_text())
        (pages / f"{sid}.html").write_text(song_page_html(template, song, site))
    for stale in pages.glob("*.html"):
        if stale.stem not in ids:
            stale.unlink()
    return ids


def update_index(out_dir, song, curation):
    """Refresh the home page index after writing a song (kept for the importers)."""
    build_index(Path(out_dir).parent)


def load_curation(out_dir):
    path = Path(out_dir) / "curation.json"
    return json.loads(path.read_text()) if path.exists() else {}
