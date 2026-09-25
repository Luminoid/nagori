#!/usr/bin/env python3
"""Check a song folder against the data format in docs/song-format.md.

    scripts/validate-song.py data/songs/<slug> [...]     one or more song folders
    scripts/validate-song.py --all                       every folder under data/songs and private/songs, plus their indexes

Prints one line per problem and exits 1 when there are any. Only the Python
standard library is used; tests/test_import_musicxml.py runs it over every song.
"""

import json
import re
import sys
from fractions import Fraction
from pathlib import Path

SOUNDS = ("acoustic", "electric", "overdrive", "nylon", "muted")
NOTE_VALUES = (1, 2, 4, 8, 16, 32, 64)
SLIDES = ("up", "down", "legato", "shift", "above", "below")  # up/down slide out, above/below slide in
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
OVERRIDE_KEY_RE = re.compile(r"^(?:[a-z0-9-]+\|)?\d+:\d+(?:,\d+:\d+)*$")


def parse_voicing(text):
    text = str(text).strip()
    parts = re.split(r"[\s,]+", text) if re.search(r"[\s,]", text) else list(text)
    out = []
    for p in parts:
        if p.lower() == "x":
            out.append(None)
        elif p.isdigit():
            out.append(int(p))
        else:
            return None
    return out


def voicing_problem(frets_text, fingers_text, strings):
    """Same rules as voicingProblem in js/fingering.js, plus the string count."""
    frets = parse_voicing(frets_text)
    if frets is None:
        return f"unreadable frets {frets_text!r}"
    if len(frets) != strings:
        return f"{len(frets)} strings in {frets_text!r}, the part has {strings}"
    if not fingers_text:
        return None
    fingers = parse_voicing(fingers_text)
    if fingers is None or len(fingers) != len(frets):
        return f"fingers {fingers_text!r} do not match {frets_text!r}"
    fret_of = {}
    for i, (fret, finger) in enumerate(zip(frets, fingers)):
        if fret is None:
            if finger not in (None, 0):
                return f"finger on the muted string {i + 1}"
            continue
        if fret == 0:
            if finger:
                return f"finger on the open string {i + 1}"
            continue
        if not finger or finger > 4:
            return f"no finger for fret {fret} on string {i + 1}"
        if finger in fret_of and fret_of[finger] != fret:
            return f"finger {finger} on frets {fret_of[finger]} and {fret}"
        fret_of[finger] = fret
    return None


def check_library(library, strings, where, problems):
    if not isinstance(library, dict):
        problems.append(f"{where}: chordLibrary must be an object")
        return
    for name, entry in library.items():
        for v in entry if isinstance(entry, list) else [entry]:
            if not isinstance(v, dict) or "frets" not in v:
                problems.append(f"{where}: {name} needs a frets string")
                continue
            problem = voicing_problem(v["frets"], v.get("fingers"), strings)
            if problem:
                problems.append(f"{where}: {name} {v['frets']}: {problem}")


def check_track_file(path, meta, bars, signature, problems):
    """Check one track file; returns each bar's (beat total, bar length) for the cross-part check, None for a whole-rest bar."""
    where = path.name
    lengths = []
    try:
        track = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        problems.append(f"{where}: cannot read ({exc})")
        return
    strings = meta.get("strings")
    if track.get("id") != meta.get("id"):
        problems.append(f"{where}: id {track.get('id')!r} differs from song.json {meta.get('id')!r}")
    if track.get("strings") != strings or track.get("tuning") != meta.get("tuning"):
        problems.append(f"{where}: strings/tuning differ from song.json")
    measures = track.get("measures")
    if not isinstance(measures, list):
        problems.append(f"{where}: measures must be a list")
        return
    if len(measures) != bars:
        problems.append(f"{where}: {len(measures)} measures, song has {bars} bars")
    sig = signature
    for m_index, measure in enumerate(measures):
        bar = f"{where} bar {m_index + 1}"
        if not isinstance(measure, dict) or not isinstance(measure.get("beats"), list):
            problems.append(f"{bar}: needs a beats list")
            continue
        if "sig" in measure:
            s = measure["sig"]
            if not (isinstance(s, list) and len(s) == 2 and all(isinstance(x, int) and x > 0 for x in s)):
                problems.append(f"{bar}: sig must be [beats, unit]")
            else:
                sig = s
        if "marker" in measure and not isinstance(measure["marker"], str):
            problems.append(f"{bar}: marker must be text")
        total = Fraction(0)
        for b_index, beat in enumerate(measure["beats"]):
            at = f"{bar} beat {b_index + 1}"
            d = beat.get("d") if isinstance(beat, dict) else None
            if not (isinstance(d, list) and len(d) == 2 and all(isinstance(x, int) for x in d) and d[0] > 0 and d[1] > 0):
                problems.append(f"{at}: d must be [numerator, denominator]")
                continue
            total += Fraction(d[0], d[1])
            if beat.get("t") not in NOTE_VALUES:
                problems.append(f"{at}: t must be one of {NOTE_VALUES}")
            if not isinstance(beat.get("notes"), list):
                problems.append(f"{at}: notes must be a list")
                continue
            if beat.get("rest") and beat["notes"]:
                problems.append(f"{at}: a rest cannot have notes")
            if not beat.get("rest") and not beat["notes"]:
                problems.append(f"{at}: no notes and not a rest")
            for n_index, note in enumerate(beat["notes"]):
                if not isinstance(note, dict) or not isinstance(note.get("s"), int) or not isinstance(note.get("f"), int):
                    problems.append(f"{at} note {n_index + 1}: needs integer s and f")
                    continue
                if strings and not 0 <= note["s"] < strings:
                    problems.append(f"{at} note {n_index + 1}: string {note['s']} outside 0..{strings - 1}")
                if not 0 <= note["f"] <= 30:
                    problems.append(f"{at} note {n_index + 1}: fret {note['f']}")
                if "slide" in note and note["slide"] not in SLIDES:
                    problems.append(f"{at} note {n_index + 1}: slide must be one of {SLIDES}")
                if "bend" in note and not isinstance(note["bend"], (int, float)):
                    problems.append(f"{at} note {n_index + 1}: bend must be a number")
        # A whole rest stands for the whole bar whatever the signature; transcriptions also round tuplets a little.
        whole_rest = len(measure["beats"]) == 1 and measure["beats"][0].get("rest") and total == 1
        if sig and not whole_rest and total > Fraction(sig[0], sig[1]) + Fraction(1, 8):
            problems.append(f"{bar}: beats add up to {total}, longer than a {sig[0]}/{sig[1]} bar")
        lengths.append(None if whole_rest or not sig else (total, Fraction(sig[0], sig[1])))
    return lengths


def validate_song(folder):
    """Return a list of problems for one song folder (empty when it is fine)."""
    folder = Path(folder)
    problems = []
    path = folder / "song.json"
    if not path.exists():
        return [f"{folder}: no song.json"]
    try:
        song = json.loads(path.read_text())
    except ValueError as exc:
        return [f"{path}: invalid JSON ({exc})"]
    where = folder.name
    if song.get("id") != folder.name:
        problems.append(f"{where}: id {song.get('id')!r} should match the folder name")
    elif not ID_RE.match(folder.name):
        problems.append(f"{where}: id must be lower-case letters, digits and dashes")
    for key in ("title", "artist"):
        if not isinstance(song.get(key), str) or not song[key].strip():
            problems.append(f"{where}: {key} is required")
    bars = song.get("bars")
    if not isinstance(bars, int) or bars <= 0:
        problems.append(f"{where}: bars must be a positive integer")
        bars = 0
    sig = song.get("timeSignature")
    if not (isinstance(sig, list) and len(sig) == 2 and all(isinstance(x, int) and x > 0 for x in sig)):
        problems.append(f"{where}: timeSignature must be [beats, unit]")
    if song.get("bpm") is not None and not isinstance(song["bpm"], (int, float)):
        problems.append(f"{where}: bpm must be a number")
    for i, entry in enumerate(song.get("tempo") or []):
        if not all(isinstance(entry.get(k), (int, float)) for k in ("bar", "pos", "bpm", "unit")):
            problems.append(f"{where}: tempo entry {i + 1} needs bar, pos, bpm and unit")
    tracks = song.get("tracks")
    if not isinstance(tracks, list) or not tracks:
        problems.append(f"{where}: tracks must be a non-empty list")
        tracks = []
    ids = set()
    guitar_strings = None
    bar_lengths = {}  # track id -> per bar (beat total, bar length)
    for i, meta in enumerate(tracks):
        at = f"{where} track {meta.get('id') or i + 1}"
        tid = meta.get("id")
        if not isinstance(tid, str) or not ID_RE.match(tid):
            problems.append(f"{at}: id must be lower-case letters, digits and dashes")
        elif tid in ids:
            problems.append(f"{at}: duplicate id")
        ids.add(tid)
        if not meta.get("name"):
            problems.append(f"{at}: name is required")
        if meta.get("kind") not in ("guitar", "bass"):
            problems.append(f"{at}: kind must be guitar or bass")
        strings = meta.get("strings")
        tuning = meta.get("tuning")
        if not isinstance(strings, int) or not 4 <= strings <= 8:
            problems.append(f"{at}: strings must be 4..8")
        elif not (isinstance(tuning, list) and len(tuning) == strings and all(isinstance(m, int) for m in tuning)):
            problems.append(f"{at}: tuning must list {strings} MIDI numbers, high string first")
        elif meta.get("kind") == "guitar" and guitar_strings is None:
            guitar_strings = strings
        if "capo" in meta and not (isinstance(meta["capo"], int) and meta["capo"] >= 0):
            problems.append(f"{at}: capo must be a whole number")
        if "sound" in meta and meta["sound"] not in SOUNDS:
            problems.append(f"{at}: sound must be one of {SOUNDS}")
        if "level" in meta and not (isinstance(meta["level"], (int, float)) and 0 <= meta["level"] <= 1):
            problems.append(f"{at}: level must be between 0 and 1")
        fingering = meta.get("fingering")
        if fingering is not None:
            if not isinstance(fingering, dict):
                problems.append(f"{at}: fingering must be an object")
            elif "maxSpan" in fingering and not (isinstance(fingering["maxSpan"], int) and 2 <= fingering["maxSpan"] <= 6):
                problems.append(f"{at}: fingering.maxSpan must be 2..6")
        if meta.get("chordLibrary") is not None and isinstance(strings, int):
            check_library(meta["chordLibrary"], strings, at, problems)
        file = meta.get("file")
        if not isinstance(file, str) or not (folder / file).exists():
            problems.append(f"{at}: file {file!r} not found")
        elif isinstance(strings, int):
            lengths = check_track_file(folder / file, meta, bars, sig if isinstance(sig, list) else None, problems)
            if lengths:
                bar_lengths[meta.get("id")] = lengths
    # A bar every part writes short is a pickup and plays at its written length; a bar short in one
    # part only would be stretched against the others, so it must be padded with a rest instead.
    tolerance = Fraction(1, 8)
    for b in range(bars):
        full, short = [], []
        for tid, lengths in bar_lengths.items():
            if b >= len(lengths) or lengths[b] is None:
                continue
            total, length = lengths[b]
            (short if total < length - tolerance else full).append((tid, total, length))
        if full and short:
            tid, total, length = short[0]
            problems.append(f"{where} bar {b + 1}: {tid} holds {total} of a {length}-whole-note bar while {full[0][0]} fills it; pad the short part with a rest")
    if tracks and song.get("defaultTrack") not in ids:
        problems.append(f"{where}: defaultTrack {song.get('defaultTrack')!r} is not a track id")
    last = -1
    section_names = []
    for i, section in enumerate(song.get("sections") or []):
        if not isinstance(section.get("name"), str) or not isinstance(section.get("bar"), int):
            problems.append(f"{where}: section {i + 1} needs a name and a bar")
            continue
        if not 0 <= section["bar"] < max(bars, 1) or section["bar"] <= last:
            problems.append(f"{where}: section {section['name']!r} at bar {section['bar']} is out of range or out of order")
        if section["name"] in section_names:
            problems.append(f"{where}: section name {section['name']!r} is used twice; number repeats (Chorus, Chorus 2) so the sheet and the loop menu can tell them apart")
        section_names.append(section["name"])
        last = section["bar"]
    last = None
    for i, entry in enumerate(song.get("chordTimeline") or []):
        if not isinstance(entry, dict) or not isinstance(entry.get("bar"), int) or not (0 <= entry["bar"] < max(bars, 1)):
            problems.append(f"{where}: chord timeline entry {i + 1} needs a bar inside the song")
        elif not (isinstance(entry.get("pos"), (int, float)) and 0 <= entry["pos"] < 1):
            problems.append(f"{where}: chord timeline entry {i + 1} pos must be at least 0 and below 1 (a fraction of the bar)")
        elif not isinstance(entry.get("chord"), str) or not entry["chord"]:
            problems.append(f"{where}: chord timeline entry {i + 1} needs a chord name")
        else:
            key = (entry["bar"], entry["pos"])
            if last is not None and key <= last:
                problems.append(f"{where}: chord timeline entry {i + 1} is out of order or repeats a position")
            last = key
    sheet = song.get("chordSheet")
    if sheet is not None:
        if not isinstance(sheet, dict) or not isinstance(sheet.get("sections"), list):
            problems.append(f"{where}: chordSheet needs a sections list")
        else:
            for s_index, section in enumerate(sheet["sections"]):
                if section.get("name") is not None and section["name"] not in section_names:
                    problems.append(f"{where}: sheet section {section['name']!r} matches no section of the song")
                for l_index, line in enumerate(section.get("lines") or []):
                    at = f"{where} sheet section {s_index + 1} line {l_index + 1}"
                    if line.get("type") == "bars":
                        if not isinstance(line.get("bars"), list):
                            problems.append(f"{at}: bars line needs a bars list")
                    elif not isinstance(line.get("segments"), list):
                        problems.append(f"{at}: needs segments [{{chord, text}}]")
    lyrics = song.get("lyrics")
    if lyrics is not None and not isinstance(lyrics, list):
        problems.append(f"{where}: lyrics must be a list of {{bar, pos, text}}")
    last = None
    for i, entry in enumerate(lyrics if isinstance(lyrics, list) else []):
        at = f"{where}: lyric {i + 1}"
        if not isinstance(entry, dict) or not isinstance(entry.get("bar"), int) or not (0 <= entry["bar"] < max(bars, 1)):
            problems.append(f"{at} needs a bar inside the song")
        elif not (isinstance(entry.get("pos"), (int, float)) and 0 <= entry["pos"] < 1):
            problems.append(f"{at} pos must be at least 0 and below 1 (a fraction of the bar)")
        elif not isinstance(entry.get("text"), str) or not entry["text"].strip():
            problems.append(f"{at} needs its text")
        elif "join" in entry and not isinstance(entry["join"], bool):
            problems.append(f"{at} join must be true or false")
        else:
            key = (entry["bar"], entry["pos"])
            if last is not None and key < last:
                problems.append(f"{at} is out of order")
            last = key
    source = song.get("source")
    if isinstance(source, dict) and source.get("url") is not None and not re.match(r"^https?://", str(source["url"])):
        problems.append(f"{where}: source.url must start with http:// or https://")
    video = song.get("video")
    if video is not None:
        if not isinstance(video, dict) or not video.get("id"):
            problems.append(f"{where}: video needs an id")
        else:
            if not re.fullmatch(r"[A-Za-z0-9_-]{11}", str(video["id"])):
                problems.append(f"{where}: video.id must be a YouTube video id (11 characters)")
            if not isinstance(video.get("barTimes"), list) or len(video["barTimes"]) != bars:
                problems.append(f"{where}: video.barTimes must have one start time per bar ({bars})")
            elif any(b < a for a, b in zip(video["barTimes"], video["barTimes"][1:])):
                problems.append(f"{where}: video.barTimes must not decrease")
    if song.get("chordLibrary") is not None and guitar_strings:
        check_library(song["chordLibrary"], guitar_strings, f"{where} chordLibrary", problems)
    for key, value in (song.get("fingeringOverrides") or {}).items():
        if not OVERRIDE_KEY_RE.match(key):
            problems.append(f"{where}: fingeringOverrides key {key!r} must be string:fret pairs, optionally prefixed by a track id and |")
        elif not isinstance(value, dict) or not all(re.match(r"^\d+:\d+$", k) and str(v) in "1234" for k, v in value.items()):
            problems.append(f"{where}: fingeringOverrides {key!r} must map string:fret to a finger 1..4")
    return problems


def validate_all(root):
    root = Path(root)
    problems = []
    folders = sorted(p for p in root.iterdir() if p.is_dir())
    for folder in folders:
        problems.extend(validate_song(folder))
    index_path = root.parent / "songs.json"
    if index_path.exists():
        rows = json.loads(index_path.read_text())
        listed = {row.get("id") for row in rows}
        for folder in folders:
            if folder.name not in listed:
                problems.append(f"songs.json: no row for {folder.name}")
        for row in rows:
            if not (root / str(row.get("id"))).is_dir():
                problems.append(f"songs.json: row {row.get('id')!r} has no folder")
    else:
        problems.append(f"{index_path}: missing")
    return problems


def main(argv):
    top = Path(__file__).resolve().parent.parent
    roots = [top / "data" / "songs", top / "private" / "songs"]
    if not argv or argv == ["--all"]:
        problems = []
        count = 0
        for root in roots:
            if not root.is_dir():
                continue
            problems.extend(validate_all(root))
            count += len([p for p in root.iterdir() if p.is_dir()])
    else:
        problems = []
        for arg in argv:
            folder = Path(arg)
            if not folder.exists():
                folder = next((root / arg for root in roots if (root / arg).is_dir()), roots[0] / arg)
            problems.extend(validate_song(folder))
        count = len(argv)
    for problem in problems:
        print(problem)
    print(f"{count} song(s), {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
