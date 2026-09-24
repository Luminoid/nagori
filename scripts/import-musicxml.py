#!/usr/bin/env python3
"""Import a MusicXML score into Nagori's data format.

Usage:
    scripts/import-musicxml.py <score.musicxml|.xml|.mxl> [--out data/songs/<slug>] [--title T] [--artist A] [--let-ring] [--first-voice]

Guitar Pro, MuseScore and TuxGuitar all export MusicXML (MuseScore also opens
Guitar Pro files, so any .gp file can come in this way). Every part with a
string tuning or string/fret numbers becomes a track; a part with lyrics and no
strings supplies the words for the generated chord sheet. Chord symbols,
rehearsal marks, tempo marks, time signatures, ties, dots, tuplets, hammer-ons,
pull-offs, slides, bends, dead and ghost notes, pick strokes and beams are
read. Repeats are not unfolded: export the score with repeats written out if
they matter. Then, as for every importer, <out>/curation.json is merged in
(see docs/song-format.md). Only the Python standard library is used.
"""

import argparse
import itertools
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from songlib import (  # noqa: E402
    apply_track_meta,
    assemble_song,
    load_curation,
    slugify,
    write_song,
)

STEP_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
TYPE_VALUE = {"breve": 1, "whole": 1, "half": 2, "quarter": 4, "eighth": 8, "16th": 16, "32nd": 32, "64th": 64}
BEAT_UNIT = {"whole": 1, "half": 2, "quarter": 4, "eighth": 8, "16th": 16}
KIND_SUFFIX = {
    "major": "", "minor": "m", "dominant": "7", "major-seventh": "maj7", "minor-seventh": "m7",
    "augmented": "aug", "diminished": "dim", "diminished-seventh": "dim7", "half-diminished": "m7b5",
    "suspended-fourth": "sus4", "suspended-second": "sus2", "power": "5", "major-sixth": "6", "minor-sixth": "m6",
    "dominant-ninth": "9", "major-ninth": "maj9", "minor-ninth": "m9", "major-minor": "mMaj7",
    "dominant-11th": "11", "dominant-13th": "13", "augmented-seventh": "aug7", "none": "", "other": "",
}
STANDARD = [64, 59, 55, 50, 45, 40]
BASS = [43, 38, 33, 28]
DEFAULT_TUNINGS = {6: STANDARD, 4: BASS, 5: [43, 38, 33, 28, 23], 7: [64, 59, 55, 50, 45, 40, 35]}


def read_score(path):
    """The <score-partwise> root of a .musicxml, .xml or compressed .mxl file, namespaces stripped."""
    path = Path(path)
    if path.suffix.lower() == ".mxl":
        with zipfile.ZipFile(path) as archive:
            rootfile = None
            try:
                container = ET.fromstring(archive.read("META-INF/container.xml"))
                rootfile = next((el.get("full-path") for el in container.iter() if el.tag.endswith("rootfile")), None)
            except KeyError:
                pass
            if not rootfile:
                rootfile = next(n for n in archive.namelist() if n.lower().endswith((".xml", ".musicxml")) and not n.startswith("META-INF"))
            data = archive.read(rootfile)
    else:
        data = path.read_bytes()
    root = ET.fromstring(data)
    for el in root.iter():
        if "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    if root.tag == "score-timewise":
        raise SystemExit("timewise MusicXML is not supported; export a partwise score")
    if root.tag != "score-partwise":
        raise SystemExit(f"not a MusicXML score (root element {root.tag})")
    return root


def text(el, path, default=None):
    found = el.find(path) if el is not None else None
    return found.text.strip() if found is not None and found.text else default


def midi_of(pitch):
    step = text(pitch, "step", "C")
    alter = float(text(pitch, "alter", "0"))
    octave = int(text(pitch, "octave", "4"))
    return int(round((octave + 1) * 12 + STEP_PC[step] + alter))


def value_for(d):
    """(note value, dots, tuplet) that draw a duration exactly: plain, dotted, double-dotted or a triplet; else the nearest plain value."""
    for value in (1, 2, 4, 8, 16, 32, 64):
        unit = Fraction(1, value)
        if d == unit:
            return value, 0, None
        if d == unit * Fraction(3, 2):
            return value, 1, None
        if d == unit * Fraction(7, 4):
            return value, 2, None
        if d == unit * Fraction(2, 3):
            return value, 0, 3
    return note_type_for(d, 0, None), 0, None


def note_type_for(d, dots, tuplet):
    """The note value drawn for a duration, when the file does not say."""
    plain = d
    if tuplet:
        plain = d * tuplet[0] / tuplet[1]
    if dots:
        plain = plain * 2 ** dots / (2 ** (dots + 1) - 1)
    for value in (1, 2, 4, 8, 16, 32, 64):
        if Fraction(1, value) <= plain:
            return value
    return 64


def chord_symbol(harmony):
    root = harmony.find("root")
    if root is None:
        return None
    name = text(root, "root-step", "")
    alter = int(float(text(root, "root-alter", "0")))
    name += "#" * alter if alter > 0 else "b" * (-alter)
    kind = harmony.find("kind")
    if kind is not None and kind.get("text"):
        name += kind.get("text")
    else:
        name += KIND_SUFFIX.get(text(kind, ".", "major") if kind is not None else "major", "")
    for degree in harmony.findall("degree"):
        if text(degree, "degree-type") == "add":
            name += f"add{text(degree, 'degree-value', '')}"
    bass = harmony.find("bass")
    if bass is not None:
        bass_name = text(bass, "bass-step", "")
        bass_alter = int(float(text(bass, "bass-alter", "0")))
        bass_name += "#" * bass_alter if bass_alter > 0 else "b" * (-bass_alter)
        if bass_name and bass_name != name[: len(bass_name)]:
            name += "/" + bass_name
    return name or None


class PartReader:
    """Turns one <part> into measures in Nagori's format (first voice, first staff)."""

    def __init__(self, part, strings, tuning, capo, let_ring=False, first_voice=False, transpose=0):
        self.part = part
        self.strings = strings
        self.tuning = tuning
        self.capo = capo
        self.let_ring = let_ring
        self.first_voice = first_voice
        self.transpose = transpose  # semitones added to written pitches: the file's <transpose>, plus the curation file's
        self.current_voice = 1
        self.divisions = 1
        self.sig = None
        self.tempo = []
        self.lyric_tokens = []
        self.pending_break = False
        self.warnings = set()

    def string_for(self, midi):
        """A string and fret for a pitch the file gives no string for: the lowest fret that fits."""
        best = None
        for s, open_midi in enumerate(self.tuning):
            fret = midi - open_midi - self.capo
            if 0 <= fret <= 24 and (best is None or fret < best[1]):
                best = (s, fret)
        return best

    def read(self):
        """Measures in Nagori's format. Every voice of the first staff is read; when a bar has
        several, they are merged into one line (a note held under the others gets let ring),
        unless `first_voice` keeps voice 1 alone."""
        measures = []
        for m_index, measure in enumerate(self.part.findall("measure")):
            out = {"beats": []}
            cursor = Fraction(0)
            furthest = Fraction(0)
            events = []  # every beat of staff 1: {start, d, beat, voice}
            chords = []  # (position, name) from <harmony>
            last = {}  # voice -> its last event, for <chord/> notes
            skipped = False
            for el in measure:
                tag = el.tag
                if tag == "attributes":
                    if text(el, "divisions"):
                        self.divisions = int(text(el, "divisions"))
                    transpose = el.find("transpose")
                    if transpose is not None:
                        self.transpose += int(text(transpose, "chromatic", "0") or 0) + 12 * int(text(transpose, "octave-change", "0") or 0)
                    time = el.find("time")
                    if time is not None and text(time, "beats") and text(time, "beat-type"):
                        sig = [int(text(time, "beats").split("+")[0]), int(text(time, "beat-type"))]
                        if sig != self.sig:
                            self.sig = sig
                            out["sig"] = sig
                elif tag == "direction":
                    self.read_direction(el, m_index, cursor, out)
                elif tag == "harmony":
                    name = chord_symbol(el)
                    if name:
                        chords.append((cursor, name))
                elif tag == "backup":
                    cursor -= Fraction(int(text(el, "duration", "0")), self.divisions * 4)
                elif tag == "forward":
                    cursor += Fraction(int(text(el, "duration", "0")), self.divisions * 4)
                    furthest = max(furthest, cursor)
                elif tag == "note":
                    if el.find("grace") is not None or el.find("cue") is not None:
                        continue
                    voice = int(text(el, "voice", "1"))
                    staff = int(text(el, "staff", "1"))
                    d = Fraction(int(text(el, "duration", "0")), self.divisions * 4)
                    in_chord = el.find("chord") is not None
                    if in_chord:
                        start = last[voice]["start"] if voice in last else cursor
                    else:
                        start = cursor
                        cursor += d
                        furthest = max(furthest, cursor)
                    if staff != 1:
                        continue
                    if self.first_voice and voice != 1:
                        skipped = True
                        continue
                    self.current_voice = voice
                    if in_chord and voice in last and not last[voice]["beat"].get("rest"):
                        note = self.read_note(el, last[voice]["beat"])
                        if note:
                            last[voice]["beat"]["notes"].append(note)
                        continue
                    event = {"start": start, "d": d, "beat": self.read_beat(el, d), "voice": voice}
                    events.append(event)
                    last[voice] = event
            if skipped:
                self.warnings.add("extra voices were skipped")
            if len({e["voice"] for e in events}) > 1:
                self.warnings.add("several voices were merged into one line (let ring marks notes held under the others)")
                beats = self.merge_voices(events, furthest, chords)
            else:
                beats = self.sequence(events, furthest, chords)
            out["beats"] = beats
            if m_index == 0 and "sig" not in out:
                out["sig"] = self.sig or [4, 4]
            if self.let_ring:
                for beat in beats:
                    if beat["notes"]:
                        beat["ring"] = True
            measures.append(out)
        return measures

    @staticmethod
    def rest_beat(d):
        value, dots, tuplet = value_for(d)
        beat = {"d": [d.numerator, d.denominator], "t": value, "rest": True, "notes": []}
        if dots:
            beat["dots"] = dots
        if tuplet:
            beat["tuplet"] = tuplet
        return beat

    def sequence(self, events, end, chords):
        """One voice: its beats in order, gaps (from <forward>, or a voice that stops early) filled with rests."""
        beats, starts = [], []
        pos = Fraction(0)
        for event in sorted(events, key=lambda e: e["start"]):
            if event["start"] > pos:
                beats.append(self.rest_beat(event["start"] - pos))
                starts.append(pos)
            beats.append(event["beat"])
            starts.append(event["start"])
            pos = max(pos, event["start"] + event["d"])
        if events and end > pos:
            beats.append(self.rest_beat(end - pos))
            starts.append(pos)
        self.attach_chords(beats, starts, chords)
        return beats

    def merge_voices(self, events, end, chords):
        """Several voices as one tab line: a beat at every onset, its notes from every voice starting
        there; a note that lasts under later onsets marks its beat let ring."""
        sounding = [e for e in events if not e["beat"].get("rest")]
        if not sounding:
            return self.sequence(events, end, chords)
        onsets = sorted({e["start"] for e in sounding})
        beats, starts = [], []
        pos = Fraction(0)
        for i, onset in enumerate(onsets):
            if onset > pos:
                beats.append(self.rest_beat(onset - pos))
                starts.append(pos)
            group = [e for e in sounding if e["start"] == onset]
            held = max(e["d"] for e in group)
            nxt = onsets[i + 1] if i + 1 < len(onsets) else max(end, onset + held)
            d = min(nxt - onset, held)
            beats.append(self.merged_beat(group, d))
            starts.append(onset)
            pos = onset + d
            if nxt - onset > held:
                beats.append(self.rest_beat(nxt - onset - held))
                starts.append(pos)
                pos = nxt
        self.attach_chords(beats, starts, chords)
        self.beam(beats, starts)
        self.mark_tuplets(beats)
        return beats

    @staticmethod
    def merged_beat(group, d):
        value, dots, tuplet = value_for(d)
        beat = {"d": [d.numerator, d.denominator], "t": value}
        if dots:
            beat["dots"] = dots
        if tuplet:
            beat["tuplet"] = tuplet
        notes, seen = [], set()
        for event in sorted(group, key=lambda e: e["voice"]):
            for note in event["beat"]["notes"]:
                key = ("m", note["_midi"]) if "_midi" in note else (note["s"], note["f"])
                if key in seen:
                    continue
                seen.add(key)
                notes.append(note)
        beat["notes"] = notes
        if any(e["d"] > d for e in group) or any(e["beat"].get("ring") for e in group):
            beat["ring"] = True
        for key in ("stroke", "chord"):
            for event in group:
                if key in event["beat"]:
                    beat[key] = event["beat"][key]
                    break
        return beat

    @staticmethod
    def attach_chords(beats, starts, chords):
        """A chord symbol goes on the first sounding beat at or after its position."""
        pending = None
        i = 0
        chords = sorted(chords, key=lambda c: c[0])
        for beat, start in zip(beats, starts):
            while i < len(chords) and chords[i][0] <= start:
                pending = chords[i][1]
                i += 1
            if pending and not beat.get("rest"):
                beat["chord"] = pending
                pending = None

    def beam(self, beats, starts):
        """Beam runs of eighths and shorter inside one beat group (a quarter, or a dotted quarter in compound time)."""
        group_len = Fraction(3, 8) if self.sig and self.sig[1] == 8 and self.sig[0] % 3 == 0 else Fraction(1, 4)
        run, run_key = [], None

        def flush():
            if len(run) >= 2:
                beats[run[0]]["bs"] = True
                beats[run[-1]]["be"] = True
            run.clear()

        for i, (beat, start) in enumerate(zip(beats, starts)):
            beat.pop("bs", None)
            beat.pop("be", None)
            key = start // group_len
            if beat.get("rest") or beat["t"] < 8:
                flush()
            elif run and key == run_key:
                run.append(i)
            else:
                flush()
                run.append(i)
                run_key = key
        flush()

    @staticmethod
    def mark_tuplets(beats):
        """Triplet beats in runs of three get their bracket marks."""
        run = []

        def flush():
            if run:
                beats[run[0]]["ts"] = True
                beats[run[-1]]["te"] = True
            run.clear()

        for i, beat in enumerate(beats):
            beat.pop("ts", None)
            beat.pop("te", None)
            if beat.get("tuplet") == 3:
                run.append(i)
                if len(run) == 3:
                    flush()
            else:
                flush()
        flush()

    def place(self, measures):
        """Give every note that had no string number a string and fret by hand position: the whole part is
        walked once, choosing a position per beat so that the hand moves as little as possible while
        chords keep distinct strings and open strings stay welcome."""
        beats = [beat for m in measures for beat in m["beats"] if any("_midi" in n for n in beat["notes"])]
        if not beats:
            return
        positions = range(0, 13)
        options = [self.placements(beat, positions) for beat in beats]
        inf = float("inf")
        cost = [dict.fromkeys(positions, inf)]
        back = []
        for p in positions:
            if p in options[0]:
                cost[0][p] = options[0][p][0] + 0.15 * p
        for i in range(1, len(beats)):
            row, prev = {}, {}
            for p in positions:
                if p not in options[i]:
                    row[p] = inf
                    continue
                best = min(positions, key=lambda q: cost[i - 1][q] + (0.5 + 0.6 * abs(q - p) if q != p else 0.0))
                row[p] = cost[i - 1][best] + (0.5 + 0.6 * abs(best - p) if best != p else 0.0) + options[i][p][0] + 0.15 * p
                prev[p] = best
            cost.append(row)
            back.append(prev)
        p = min(positions, key=lambda q: cost[-1][q])
        chosen = [p]
        for i in range(len(beats) - 1, 0, -1):
            p = back[i - 1][p]
            chosen.append(p)
        chosen.reverse()
        for beat, p in zip(beats, chosen):
            auto = [n for n in beat["notes"] if "_midi" in n]
            for note, (s, f) in zip(auto, self.placements(beat, [p])[p][1]):
                note["s"], note["f"] = s, f
            for note in auto:
                note.pop("_midi", None)

    def placements(self, beat, positions):
        """position -> (cost, [(string, fret) per unplaced note]) for the positions where the beat's notes fit."""
        auto = [n for n in beat["notes"] if "_midi" in n]
        fixed = {n["s"] for n in beat["notes"] if "_midi" not in n}
        out = {}
        for p in positions:
            candidates = []
            for note in auto:
                found = []
                for s, open_midi in enumerate(self.tuning):
                    f = note["_midi"] - open_midi - self.capo
                    if f < 0 or f > 19 or s in fixed:
                        continue
                    if f == 0:
                        c = 0.0 if p <= 4 else 0.3
                    elif p <= f <= p + 3:
                        c = 0.1 * f
                    elif f == p + 4:
                        c = 0.5 + 0.1 * f
                    else:
                        continue
                    found.append((c, s, f))
                if not found:
                    break
                candidates.append(found)
            else:
                best = None
                for combo in itertools.product(*candidates):
                    used = [s for _, s, _ in combo]
                    if len(set(used)) < len(used):
                        continue
                    total = sum(c for c, _, _ in combo)
                    pairs = sorted(zip([n["_midi"] for n in auto], used))
                    total += 2.0 * sum(1 for a, b in zip(pairs, pairs[1:]) if a[1] < b[1])  # a higher pitch on a lower string
                    if best is None or total < best[0]:
                        best = (total, [(s, f) for _, s, f in combo])
                if best is not None:
                    out[p] = best
        if not out:
            # More notes than strings, or out of range: the lowest frets that fit, whatever the position.
            fallback = []
            for note in auto:
                placed = self.string_for(note["_midi"])
                fallback.append(placed or (0, 0))
            out = {p: (0.0, fallback) for p in positions}
        return out

    def read_direction(self, el, bar, cursor, measure):
        bar_len = Fraction(self.sig[0], self.sig[1]) if self.sig else Fraction(1)
        pos = float(cursor / bar_len) if bar_len else 0.0
        for dtype in el.findall("direction-type"):
            rehearsal = text(dtype, "rehearsal")
            if rehearsal:
                measure["marker"] = rehearsal
            metronome = dtype.find("metronome")
            if metronome is not None and text(metronome, "per-minute"):
                unit = BEAT_UNIT.get(text(metronome, "beat-unit", "quarter"), 4)
                bpm = float(text(metronome, "per-minute"))
                dots = len(metronome.findall("beat-unit-dot"))
                if dots:  # a dotted unit (♩. = 52 in 6/8) is stored as quarter notes: 52 × 1.5 = 78
                    bpm = bpm * (2 - 0.5 ** dots) * 4 / unit
                    unit = 4
                entry = {"bar": bar, "pos": pos, "bpm": int(bpm) if bpm.is_integer() else bpm, "unit": unit}
                if entry not in self.tempo:
                    self.tempo.append(entry)
                return
            words = (text(dtype, "words") or "").lower()
            if words.startswith("let ring"):
                self.let_ring = "off" not in words
        sound = el.find("sound")
        if sound is not None and sound.get("tempo"):
            bpm = float(sound.get("tempo"))
            entry = {"bar": bar, "pos": pos, "bpm": int(bpm) if bpm.is_integer() else bpm, "unit": 4}
            if entry not in self.tempo:
                self.tempo.append(entry)

    def read_beat(self, el, d):
        dots = len(el.findall("dot"))
        modification = el.find("time-modification")
        tuplet = None
        if modification is not None and text(modification, "actual-notes"):
            tuplet = (int(text(modification, "actual-notes")), int(text(modification, "normal-notes", "2")))
        type_name = text(el, "type")
        beat = {"d": [d.numerator, d.denominator], "t": TYPE_VALUE.get(type_name) or note_type_for(d, dots, tuplet)}
        if dots:
            beat["dots"] = dots
        if tuplet:
            beat["tuplet"] = tuplet[0]
        notations = el.find("notations")
        if notations is not None:
            for tup in notations.findall("tuplet"):
                if tup.get("type") == "start":
                    beat["ts"] = True
                elif tup.get("type") == "stop":
                    beat["te"] = True
            technical = notations.find("technical")
            if technical is not None:
                if technical.find("up-bow") is not None:
                    beat["stroke"] = "up"
                elif technical.find("down-bow") is not None:
                    beat["stroke"] = "down"
                for other in technical.findall("other-technical"):
                    if (other.text or "").strip().lower().startswith("let ring"):
                        beat["ring"] = True
            if notations.find("arpeggiate") is not None:
                beat.setdefault("stroke", "down")
        for beam in el.findall("beam"):
            if beam.get("number", "1") != "1":
                continue
            if beam.text == "begin":
                beat["bs"] = True
            elif beam.text == "end":
                beat["be"] = True
        if el.find("rest") is not None:
            beat["rest"] = True
            beat["notes"] = []
            return beat
        note = self.read_note(el, beat)
        if note is None:
            beat["rest"] = True
            beat["notes"] = []
        else:
            beat["notes"] = [note]
        return beat

    def read_note(self, el, beat):
        pitch = el.find("pitch")
        unpitched = el.find("unpitched")
        notations = el.find("notations")
        technical = notations.find("technical") if notations is not None else None
        string = text(technical, "string") if technical is not None else None
        fret = text(technical, "fret") if technical is not None else None
        tied = any(t.get("type") == "stop" for t in el.findall("tie"))
        lyric = el.find("lyric")
        if self.current_voice != 1:
            pass  # words come from the first voice only
        elif lyric is not None:
            if self.pending_break:
                self.lyric_tokens.append("\n")  # the line break waits for the next words, so held notes stay on their line
                self.pending_break = False
            syllabic = text(lyric, "syllabic", "single")
            token = text(lyric, "text", "")
            self.lyric_tokens.append(token + ("-" if syllabic in ("begin", "middle") else " "))
            if lyric.find("end-line") is not None or lyric.find("end-paragraph") is not None:
                self.pending_break = True
        elif not tied and (pitch is not None or unpitched is not None) and self.strings == 0:
            self.lyric_tokens.append("_ ")  # a sung note without words: a held syllable
        if self.strings == 0:
            return {"s": 0, "f": 0, "tie": True} if tied else {"s": 0, "f": 0}
        if string is not None and fret is not None:
            s = int(string) - 1
            f = int(fret)
        elif pitch is not None:
            midi = midi_of(pitch) + self.transpose
            placed = self.string_for(midi)
            if placed is None:
                self.warnings.add("some notes were out of the instrument's range and dropped")
                return None
            s, f = placed
            self.warnings.add("some notes had no string number; placed by hand position")
        else:
            return None
        if not 0 <= s < self.strings:
            self.warnings.add("some notes named a string the part does not have and were dropped")
            return None
        note = {"s": s, "f": f}
        if string is None and pitch is not None:
            note["_midi"] = midi  # placed properly by place() once the whole part is read
        if tied:
            note["tie"] = True
        notehead = el.find("notehead")
        if notehead is not None:
            if (notehead.text or "").strip().lower() in ("x", "cross"):
                note["dead"] = True
            if notehead.get("parentheses") == "yes":
                note["ghost"] = True
        if technical is not None:
            if any(h.get("type") == "start" for h in technical.findall("hammer-on") + technical.findall("pull-off")):
                note["hp"] = True
            bend = technical.find("bend")
            if bend is not None and text(bend, "bend-alter"):
                note["bend"] = float(text(bend, "bend-alter")) / 2  # semitones -> whole tones
        if notations is not None:
            slides = notations.findall("slide") + notations.findall("glissando")
            if any(s.get("type") == "start" for s in slides):
                note["slide"] = "legato"
        return note


def part_setup(part, score_part, override=None, single_part=False):
    """(strings, tuning high string first, capo, kind, name, instrument, assumed) for a part.

    strings is 0 for a part without strings (a vocal line). A score without a tab
    staff or string numbers still yields a guitar or bass when the part says so
    (its name, instrument or MIDI program), when the curation file declares
    `strings` for it, or when it is the score's only part and carries no lyrics;
    `assumed` then says what was assumed.
    """
    override = override or {}
    name = text(score_part, "part-name") or part.get("id")
    instrument = text(score_part, "score-instrument/instrument-name") or name
    program = text(score_part, "midi-instrument/midi-program")
    strings = 0
    tuning = None
    capo = 0
    first = part.find("measure/attributes")
    details = first.find("staff-details") if first is not None else None
    if details is not None:
        lines = text(details, "staff-lines")
        tunings = {}
        for st in details.findall("staff-tuning"):
            line = int(st.get("line", "0"))
            tunings[line] = midi_of(ET.fromstring(f"<pitch><step>{text(st, 'tuning-step', 'E')}</step><alter>{text(st, 'tuning-alter', '0')}</alter><octave>{text(st, 'tuning-octave', '2')}</octave></pitch>"))
        if tunings:
            strings = max(tunings)
            tuning = [tunings.get(line) for line in range(strings, 0, -1)]
        elif lines and int(lines) in (4, 5, 6, 7):
            strings = int(lines)
        capo = int(text(details, "capo", "0") or 0)
    lowered = f"{name} {instrument}".lower()
    number = int(program) if program and program.strip().isdigit() else None
    guitar_like = (number is not None and 25 <= number <= 32) or "guitar" in lowered or "gitarre" in lowered or "guitarra" in lowered
    bass_like = (number is not None and 33 <= number <= 40) or "bass" in lowered
    string_numbers = [int(s.text) for s in part.iter("string") if s.text and s.text.isdigit()]
    if strings == 0 and string_numbers:
        # String numbers alone say how many strings are used, not how many there are: a guitar part keeps six.
        strings = max(string_numbers)
        if guitar_like and not bass_like:
            strings = max(strings, 6)
        elif bass_like and not guitar_like:
            strings = max(strings, 4)
    if override.get("strings"):
        strings = int(override["strings"])
    if override.get("tuning"):
        tuning = [int(m) for m in override["tuning"]]
    if override.get("capo") is not None:
        capo = int(override["capo"])
    has_lyrics = part.find(".//lyric") is not None
    assumed = None
    if strings == 0 and not override.get("vocal") and not has_lyrics and (guitar_like or bass_like or single_part):
        strings = 4 if bass_like and not guitar_like else 6
        assumed = f"no tab staff or string numbers: read as a {'four-string bass' if strings == 4 else 'six-string guitar'} in standard tuning, notes placed by hand position"
    if strings and (tuning is None or len(tuning) != strings or any(t is None for t in tuning)):
        # Derive open-string pitches from notes that carry both a pitch and a string, fill the rest from a default.
        derived = {}
        for note in part.iter("note"):
            pitch = note.find("pitch")
            technical = note.find("notations/technical")
            if pitch is None or technical is None or not text(technical, "string") or text(technical, "fret") is None:
                continue
            s = int(text(technical, "string")) - 1
            if 0 <= s < strings and s not in derived:
                derived[s] = midi_of(pitch) - int(text(technical, "fret")) - capo
        default = DEFAULT_TUNINGS.get(strings) or [STANDARD[i % 6] for i in range(strings)]
        tuning = [(tuning[s] if tuning and s < len(tuning) and tuning[s] is not None else derived.get(s, default[s])) for s in range(strings)]
    is_bass = strings == 4 or bass_like
    kind = "bass" if is_bass and strings else "guitar"
    return strings, tuning, capo, kind, name, instrument, assumed
def unique_id(base, taken):
    candidate = base or "part"
    n = 2
    while candidate in taken:
        candidate = f"{base}-{n}"
        n += 1
    taken.add(candidate)
    return candidate


def import_score(root, curation, *, filename="", title=None, artist=None, let_ring=False, first_voice=False):
    """Parse a score into (tracks, vocal, title, artist, warnings)."""
    score_parts = {sp.get("id"): sp for sp in root.findall("part-list/score-part")}
    track_meta = curation.get("tracks", {})
    tracks = []
    vocal = None
    taken = set()
    warnings = set()
    ring_ids = curation.get("letRing")
    parts = root.findall("part")
    for part in parts:
        pid = part.get("id")
        score_part = score_parts.get(pid)
        if score_part is None:
            continue
        override = track_meta.get(pid) or track_meta.get(text(score_part, "part-name") or pid) or track_meta.get(str(parts.index(part) + 1)) or {}
        strings, tuning, capo, kind, name, instrument, assumed = part_setup(part, score_part, override, single_part=len(parts) == 1)
        if assumed:
            warnings.add(f"{name}: {assumed}")
        base_id = override.get("id") or slugify(name)
        if strings == 0:
            reader = PartReader(part, 0, [], 0)
            measures = reader.read()
            lyrics = "".join(reader.lyric_tokens).strip()
            if lyrics and vocal is None:
                vocal = {"measures": measures, "lyrics": lyrics, "offset": 1}
            continue
        ring = let_ring or ring_ids is True or (isinstance(ring_ids, list) and (base_id in ring_ids or pid in ring_ids))
        reader = PartReader(part, strings, tuning, capo, let_ring=ring, first_voice=first_voice, transpose=int(override.get("transpose") or 0))
        measures = reader.read()
        reader.place(measures)
        warnings |= {f"{name}: {w}" for w in reader.warnings}
        track = {
            "id": unique_id(base_id, taken),
            "name": name,
            "role": "Bass" if kind == "bass" else "Guitar",
            "instrument": instrument,
            "strings": strings,
            "tuning": tuning,
            "kind": kind,
            "partId": pid,
            "measures": measures,
        }
        if reader.tempo:
            track["tempo"] = sorted(reader.tempo, key=lambda e: (e["bar"], e["pos"]))
        if capo:
            track["capo"] = capo
        apply_track_meta(track, override)
        tracks.append(track)
    bars = max((len(t["measures"]) for t in tracks), default=0)
    for t in tracks:
        while len(t["measures"]) < bars:
            t["measures"].append({"beats": []})
    title = title or curation.get("title") or text(root, "work/work-title") or text(root, "movement-title") or Path(filename).stem
    creators = {c.get("type", "composer"): (c.text or "").strip() for c in root.findall("identification/creator")}
    artist = artist or curation.get("artist") or creators.get("composer") or creators.get("lyricist") or next(iter(creators.values()), None) or "Unknown"
    return tracks, vocal, title, artist, warnings


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("score")
    ap.add_argument("--out")
    ap.add_argument("--title")
    ap.add_argument("--artist")
    ap.add_argument("--let-ring", action="store_true", help="treat every note as let ring (arpeggiated accompaniments)")
    ap.add_argument("--first-voice", action="store_true", help="keep only the first voice of each part instead of merging the voices into one line")
    args = ap.parse_args()

    root = read_score(args.score)
    out_dir = Path(args.out) if args.out else None
    curation = load_curation(out_dir) if out_dir else {}
    tracks, vocal, title, artist, warnings = import_score(root, curation, filename=args.score, title=args.title, artist=args.artist, let_ring=args.let_ring, first_voice=args.first_voice)
    if out_dir is None:
        out_dir = Path("data/songs") / f"{slugify(artist)}-{slugify(title)}"
        curation = load_curation(out_dir)
    if not tracks:
        raise SystemExit("no part with strings found (the score needs a tab staff, or string and fret numbers on its notes)")
    print(f"{artist} - {title} ({args.score})")
    for t in tracks:
        print(f"  part {t['partId']}: {t['name']} ({t['kind']}, {t['strings']} strings, {len(t['measures'])} bars)")
    for w in sorted(warnings):
        print(f"  note: {w}", file=sys.stderr)
    software = text(root, "identification/encoding/software")
    source = {"name": curation.get("sourceName") or "MusicXML", "url": curation.get("sourceUrl"), "file": Path(args.score).name, "software": software}
    if curation.get("sourceLabel"):
        source["label"] = curation["sourceLabel"]
    song = assemble_song(slug=out_dir.name, title=title, artist=artist, tracks=tracks, curation=curation, source=source, vocal=vocal)
    write_song(out_dir, song, tracks, curation)
    print(f"wrote {out_dir}/song.json and {len(tracks)} track files")


if __name__ == "__main__":
    main()
