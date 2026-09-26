#!/usr/bin/env python3
"""Import a Songsterr song into Nagori's data format.

The author's personal convenience, not the supported way in (that is
import-musicxml.py or writing the JSON by hand): it reads Songsterr's
undocumented endpoints, which can change or be blocked at any time and whose
terms of use you should check yourself, and the transcriptions it pulls are
for personal practice, not for redistribution.

Usage:
    scripts/import-songsterr.py <songId> [--revision <id>] [--out data/songs/<slug>] [--all-tracks]

Fetches the revision metadata, every string-instrument track, the official
video sync points, and the chord sheet, then writes:

    <out>/song.json          metadata, video sync, sections, chord sheet, chord timeline
    <out>/tracks/<id>.json   one file per track, in the format documented in docs/song-format.md

If <out>/curation.json exists it is merged in (album, key, chord library,
chord-sheet sections, chord aliases, per-part settings, fingering overrides).
Only the Python standard library is used.
"""

import argparse
import copy
import gzip
import json
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from songlib import (  # noqa: E402
    apply_track_meta,
    assemble_song,
    dedupe_names,
    load_curation,
    slugify,
    write_song,
)

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
API = "https://www.songsterr.com/api"
CDN = "https://dqsljvtekg760.cloudfront.net"


def fetch(url, binary=False):
    """GET a URL. Prefers curl (urllib chokes on the HTTP 103 hints Songsterr sends)."""
    if shutil.which("curl"):
        result = subprocess.run(["curl", "-sSL", "--fail", "-A", UA, url], capture_output=True, check=True)
        data = result.stdout
    else:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
    if binary:
        return data
    return data.decode("utf-8")


def fetch_json(url):
    return json.loads(fetch(url))


def fetch_part(song_id, revision_id, image, part_id):
    raw = fetch(f"{CDN}/{song_id}/{revision_id}/{image}/{part_id}.json", binary=True)
    try:
        raw = gzip.decompress(raw)
    except OSError:
        pass
    return json.loads(raw)


# --- Track conversion -------------------------------------------------------

SLIDE_NAMES = {"upwards": "up", "downwards": "down", "above": "above", "below": "below", "legato": "legato", "shift": "shift"}


def convert_note(note):
    if note.get("rest"):
        return None
    out = {"s": note["string"], "f": note.get("fret", 0)}  # muted strums may carry no fret
    if note.get("tie"):
        out["tie"] = True
    if note.get("dead"):
        out["dead"] = True
    if note.get("ghost"):
        out["ghost"] = True
    if note.get("hp"):
        out["hp"] = True
    if note.get("slide"):
        out["slide"] = SLIDE_NAMES.get(note["slide"], note["slide"])
    if note.get("bend"):
        tone = note["bend"].get("tone", 50)
        out["bend"] = tone / 100  # in whole tones: 0.5 = half step
    return out


def convert_beat(beat):
    num, den = beat["duration"]
    out = {"d": [num, den], "t": beat.get("type", 4)}
    if beat.get("dots"):
        out["dots"] = beat["dots"]
    if beat.get("tuplet"):
        out["tuplet"] = beat["tuplet"]
    if beat.get("tupletStart"):
        out["ts"] = True
    if beat.get("tupletStop"):
        out["te"] = True
    if beat.get("letRing"):
        out["ring"] = True
    if beat.get("beamStart"):
        out["bs"] = True
    if beat.get("beamStop"):
        out["be"] = True
    chord = beat.get("chord")
    if chord and chord.get("text"):
        out["chord"] = chord["text"]
    # A strum comes two ways that disagree by convention: brushStroke.direction is the hand's (down plays the
    # low strings first, which is what the tab's arrow and the playback's stagger mean), while upStroke and
    # downStroke name the arrow Songsterr draws along the staff, which points the other way (a brush "down"
    # beat carries upStroke). pickStroke is the pick-direction symbol, also the hand's.
    brush = beat.get("brushStroke")
    if isinstance(brush, dict) and brush.get("direction") in ("up", "down"):
        out["stroke"] = brush["direction"]
    elif beat.get("pickStroke") in ("up", "down"):
        out["stroke"] = beat["pickStroke"]
    elif beat.get("downStroke"):
        out["stroke"] = "up"
    elif beat.get("upStroke"):
        out["stroke"] = "down"
    notes = [n for n in (convert_note(n) for n in beat.get("notes", [])) if n]
    if beat.get("rest") or not notes:
        out["rest"] = True
        out["notes"] = []
    else:
        out["notes"] = notes
    return out


def tempo_map(automation):
    """Songsterr tempo automation -> [{bar, pos, bpm, unit}]. bpm counts `unit` notes (4 quarter, 2 half)."""
    out = []
    for entry in automation:
        item = {"bar": entry.get("measure", 0), "pos": entry.get("position", 0), "bpm": entry["bpm"], "unit": entry.get("type", 4)}
        if item not in out:
            out.append(item)
    return sorted(out, key=lambda e: (e["bar"], e["pos"]))


def played_order(raw_measures):
    """Written bar indices in the order they are played, repeat signs unfolded: `repeatStart` opens a section,
    `repeat` on its last bar says how many times it plays, `alternateEnding` lists the passes a bar belongs to.
    Songsterr's sync points count played bars, so the tab has to as well."""
    order = []
    i = 0
    start = 0
    passes = {}
    limit = 8 * len(raw_measures) + 8  # a malformed repeat must not loop forever
    while i < len(raw_measures) and len(order) < limit:
        m = raw_measures[i]
        if m.get("repeatStart"):
            start = i
            passes.setdefault(start, 1)
        current = passes.get(start, 1)
        ending = m.get("alternateEnding")
        if ending and current not in ending:
            i += 1
            continue
        order.append(i)
        count = m.get("repeat")
        if count and current < count:
            passes[start] = current + 1
            i = start
            continue
        i += 1
    return order


def unfold_tempo(entries, order):
    """A tempo map written against written bars, restated for every pass of a repeated bar (a change repeated as such is kept once)."""
    out = []
    for played, written in enumerate(order):
        for e in entries:
            if e["bar"] == written and not (out and (out[-1]["bpm"], out[-1]["unit"]) == (e["bpm"], e["unit"])):
                out.append({**e, "bar": played})
    return out


def convert_measures(part):
    """The part's bars as played: repeats unfolded (played_order), a marker kept on a bar's first pass only."""
    written = []
    for m in part["measures"]:
        voices = m.get("voices", [])
        if len(voices) > 1:
            print(f"  note: measure with {len(voices)} voices, keeping the first", file=sys.stderr)
        beats = [convert_beat(b) for b in (voices[0]["beats"] if voices else [])]
        out = {"beats": beats}
        if m.get("marker") and m["marker"].get("text"):
            out["marker"] = m["marker"]["text"]
        if m.get("signature"):
            out["sig"] = m["signature"]
        written.append(out)
    order = played_order(part["measures"])
    if order == list(range(len(written))):
        return written
    measures = []
    seen = set()
    for i in order:
        m = copy.deepcopy(written[i])
        if i in seen:
            m.pop("marker", None)
        seen.add(i)
        measures.append(m)
    return measures


# --- Chord sheet ------------------------------------------------------------

def chord_name(chord):
    name = chord["baseNote"]["name"] + chord["chordType"].get("suffix", "")
    first = chord.get("firstNote")
    if first and first["name"] != chord["baseNote"]["name"]:
        name += "/" + first["name"]
    return name


def fetch_chord_sheet(song_id, slug):
    url = f"https://www.songsterr.com/a/wsa/{slug}-chords-s{song_id}"
    html = fetch(url)
    match = re.search(r'<script id="state" type="application/json">(.*?)</script>', html, re.S)
    if not match:
        return None
    state = json.loads(match.group(1))
    chordpro = (state.get("chordpro") or {}).get("current")
    if not chordpro:
        return None
    lines = []
    for entry in chordpro:
        kind = entry.get("type")
        if kind == "line":
            segments = []
            for token in entry.get("line", []):
                if token["type"] == "chord":
                    segments.append({"chord": chord_name(token["chord"]), "text": ""})
                else:
                    text = token.get("text", "")
                    if segments:
                        segments[-1]["text"] += text
                    else:
                        segments.append({"chord": None, "text": text})
            lines.append({"type": "line", "segments": segments})
        elif kind == "section":
            lines.append({"type": "section", "name": entry.get("text", "")})
        elif kind == "tuning":
            lines.append({"type": "tuning", "text": entry.get("text", "")})
        else:
            lines.append({"type": kind, "text": entry.get("text", "")})
    return {"source": url, "lines": lines}


SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
NOTE_TO_PC = {n: i for i, n in enumerate(SHARP_NAMES)} | {n: i for i, n in enumerate(FLAT_NAMES)}


def transpose_chord(name, semitones, prefer_sharps=True):
    """Shift a chord name's root (and slash bass) by semitones."""
    names = SHARP_NAMES if prefer_sharps else FLAT_NAMES

    def shift(part):
        root = part[:2] if len(part) > 1 and part[1] in "#b" else part[:1]
        if root not in NOTE_TO_PC:
            return part
        return names[(NOTE_TO_PC[root] + semitones) % 12] + part[len(root):]

    return "/".join(shift(part) for part in name.split("/"))


def apply_sheet_curation(sheet, curation):
    """Rename chords, merge slash-chord token pairs, and insert section headings."""
    aliases = curation.get("chordAliases", {})
    merges = [tuple(p) for p in curation.get("mergeSlashPairs", [])]
    semitones = curation.get("chordSheetTranspose", 0)
    lines = sheet["lines"]
    for line in lines:
        if line["type"] != "line":
            continue
        segs = line["segments"]
        for seg in segs:
            if seg["chord"] in aliases:
                seg["chord"] = aliases[seg["chord"]]
            if seg["chord"] and semitones:
                seg["chord"] = transpose_chord(seg["chord"], semitones, curation.get("preferSharps", True))
        i = 0
        while i < len(segs) - 1:
            a, b = segs[i], segs[i + 1]
            if (a["chord"], b["chord"]) in merges:
                text = a["text"].replace("/", "") + b["text"]
                segs[i] = {"chord": f"{a['chord']}/{b['chord']}", "text": text}
                del segs[i + 1]
            else:
                i += 1
    # Drop the notes preamble and Songsterr's own section entries, then regroup.
    content = [ln for ln in lines if ln["type"] == "line"]
    breaks = curation.get("chordSheetSections")
    if not breaks:
        # Use the sheet's own section headings when it has them.
        breaks = []
        index = 0
        for ln in lines:
            if ln["type"] == "section":
                breaks.append({"name": ln["name"], "fromLine": index})
            elif ln["type"] == "line":
                index += 1
        if breaks:
            dedupe_names([b["name"] for b in breaks], breaks)
    if not breaks:
        return {"source": sheet["source"], "sections": [{"name": None, "lines": content}]}
    sections = []
    for idx, brk in enumerate(breaks):
        start = brk["fromLine"]
        end = brk.get("toLine", breaks[idx + 1]["fromLine"] if idx + 1 < len(breaks) else len(content))
        sections.append({"name": brk["name"], "lines": content[start:end]})
    return {"source": sheet["source"], "sections": sections}


# --- Main -------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("song_id", type=int)
    ap.add_argument("--revision", type=int)
    ap.add_argument("--out")
    ap.add_argument("--all-tracks", action="store_true", help="include vocal and drum tracks")
    args = ap.parse_args()

    revisions = fetch_json(f"{API}/meta/{args.song_id}/revisions")
    revision_id = args.revision or revisions[0]["revisionId"]
    meta = fetch_json(f"{API}/meta/{args.song_id}/{revision_id}")
    slug = f"{slugify(meta['artist'])}-{slugify(meta['title'])}"
    out_dir = Path(args.out or f"data/songs/{slug}")
    out_dir.mkdir(parents=True, exist_ok=True)
    curation = load_curation(out_dir)
    track_meta = curation.get("tracks", {})
    include = curation.get("includeTracks")
    songsterr_slug = curation.get("slug", slug)
    print(f"{meta['artist']} - {meta['title']} (song {args.song_id}, revision {revision_id})")

    tracks = []
    timeline_only = []
    vocal = None
    for index, t in enumerate(meta["tracks"]):
        t.setdefault("partId", index)
        if index in (curation.get("timelineOnlyTracks") or []):
            part = fetch_part(args.song_id, revision_id, meta["image"], index)
            timeline_only.append({"id": f"timeline-{index}", "partId": index, "kind": "guitar", "measures": convert_measures(part)})
            continue
        if t.get("isVocalTrack") and vocal is None and (curation.get("lyricsTrack") in (None, index)):
            part = fetch_part(args.song_id, revision_id, meta["image"], t["partId"])
            lyrics = next((ln for ln in part.get("newLyrics") or [] if ln.get("text")), None)
            if lyrics:
                order = played_order(part["measures"])
                written_offset = (lyrics.get("offset") or 1) - 1  # the written bar the lyrics start on, moved to its first pass
                offset = order.index(written_offset) + 1 if written_offset in order else 1
                vocal = {"measures": convert_measures(part), "lyrics": lyrics["text"], "offset": offset}
        if include is not None and index not in include:
            continue
        if not args.all_tracks and (t.get("isDrums") or t.get("isVocalTrack") or not t.get("tuning")):
            continue
        part = fetch_part(args.song_id, revision_id, meta["image"], t["partId"])
        is_bass = bool(t.get("isBassGuitar")) or part["strings"] == 4 or "bass" in (t.get("instrument") or "").lower()
        track = {
            "id": slugify(t["name"]),
            "name": t["name"],
            "role": "Bass" if is_bass else "Guitar",
            "instrument": t.get("instrument"),
            "strings": part["strings"],
            "tuning": part["tuning"],
            "kind": "bass" if is_bass else "guitar",
            "partId": t["partId"],
            "measures": convert_measures(part),
        }
        if not tracks and len(track["measures"]) != len(part["measures"]):
            print(f"  repeats unfolded: {len(part['measures'])} written bars, {len(track['measures'])} played")
        tempo = (part.get("automations") or {}).get("tempo") or []
        if tempo:
            track["tempo"] = unfold_tempo(tempo_map(tempo), played_order(part["measures"]))
        if part.get("capo"):
            track["capo"] = part["capo"]
        apply_track_meta(track, track_meta.get(str(t["partId"]), {}))
        tracks.append(track)
        print(f"  track {t['partId']}: {track['name']} ({len(track['measures'])} bars)")
    if not tracks:
        raise SystemExit("no string-instrument tracks found")

    default_track = next((t["id"] for t in tracks if t["partId"] == meta.get("defaultTrack")), tracks[0]["id"])
    bars = len(tracks[0]["measures"])

    video = None
    try:
        points = fetch_json(f"{API}/video-points/{args.song_id}")
        bar_times = list(points["points"])[:bars]
        if len(bar_times) >= 2:
            step = bar_times[-1] - bar_times[-2]
            while len(bar_times) < bars:  # sync maps can stop short of the last bars
                bar_times.append(round(bar_times[-1] + step, 3))
        video = {
            "provider": "youtube",
            "id": points["videoId"],
            "title": curation.get("videoTitle"),
            "barTimes": bar_times,
        }
        print(f"  video {points['videoId']}: {len(points['points'])} sync points ({len(bar_times)} after padding)")
    except Exception as exc:  # noqa: BLE001
        print(f"  no video sync points ({exc})", file=sys.stderr)

    sheet = None
    if meta.get("hasChords", True):
        try:
            raw_sheet = fetch_chord_sheet(args.song_id, songsterr_slug)
            if raw_sheet:
                sheet = apply_sheet_curation(raw_sheet, curation)
                print(f"  chord sheet: {sum(len(s['lines']) for s in sheet['sections'])} lines")
        except Exception as exc:  # noqa: BLE001
            print(f"  no chord sheet ({exc})", file=sys.stderr)

    source = {
        "name": "Songsterr",
        "url": f"https://www.songsterr.com/a/wsa/{songsterr_slug}-tab-s{args.song_id}",
        "songId": args.song_id,
        "revisionId": revision_id,
        "author": (meta.get("author") or {}).get("name"),
    }
    song = assemble_song(
        slug=out_dir.name,
        title=meta["title"],
        artist=meta["artist"],
        tracks=tracks,
        curation=curation,
        source=source,
        timeline_only=timeline_only,
        vocal=vocal,
        sheet=sheet,
        video=video,
        default_track=default_track,
    )
    write_song(out_dir, song, tracks, curation)
    print(f"wrote {out_dir}/song.json and {len(tracks)} track files")


if __name__ == "__main__":
    main()
