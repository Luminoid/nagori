"""Chord detection from tab notes, for transcriptions without chord annotations.

Given the converted tracks (see import-songsterr.py), score every bar (and its
two halves) against chord templates using duration-weighted pitch classes from
the harmony tracks, with the bass track supplying the bass note. Returns a
chord timeline: [{"bar", "pos", "chord"}] with one entry per change.
"""

from fractions import Fraction

SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
# Guitarists' habits: sharps for F#/C#/G#, flats for Bb/Eb/Ab/Db.
DEFAULT_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]
NOTE_INDEX = {n: i for i, n in enumerate(SHARP)} | {n: i for i, n in enumerate(FLAT)}

TEMPLATES = {
    "": (0, 4, 7),
    "m": (0, 3, 7),
    "5": (0, 7),
    "7": (0, 4, 7, 10),
    "m7": (0, 3, 7, 10),
    "maj7": (0, 4, 7, 11),
    "sus2": (0, 2, 7),
    "sus4": (0, 5, 7),
    "dim": (0, 3, 6),
    "m7b5": (0, 3, 6, 10),
    "aug": (0, 4, 8),
    "6": (0, 4, 7, 9),
    "m6": (0, 3, 7, 9),
    "add9": (0, 2, 4, 7),
    "madd9": (0, 2, 3, 7),
    "dim7": (0, 3, 6, 9),
    "m(maj7)": (0, 3, 7, 11),
    "9": (0, 2, 4, 7, 10),
}
# How much a missing chord tone costs, by interval class role.
MISSING_COST = {0: 1.2, 3: 0.6, 4: 0.6, 7: 0.15}


def parse_chord(name):
    """'Dmaj7/F#' -> (root pc, quality, bass pc or None); None if unknown."""
    base, _, bass = name.partition("/")
    root = base[:2] if len(base) > 1 and base[1] in "#b" else base[:1]
    quality = base[len(root):]
    if root not in NOTE_INDEX or quality not in TEMPLATES:
        return None
    bass_pc = NOTE_INDEX.get(bass) if bass else None
    if bass and bass_pc is None:
        return None
    return NOTE_INDEX[root], quality, bass_pc


def _weights(tracks, bar, start, end):
    """Duration-weighted pitch classes sounding in [start, end) of the bar, plus the bass note.

    The bass note is the one the bass plays first in the window (walking lines
    pass through other notes later); without a bass part, the lowest note of the
    first sounding beat stands in.
    """
    weights = {}
    first_bass = None  # (position, pitch)
    first_any = None
    for track in tracks:
        measure = track["measures"][bar] if bar < len(track["measures"]) else None
        if not measure:
            continue
        total = sum(Fraction(b["d"][0], b["d"][1]) for b in measure["beats"]) or Fraction(1)
        pos = Fraction(0)
        for beat in measure["beats"]:
            dur = Fraction(beat["d"][0], beat["d"][1])
            beat_start = pos / total
            pos += dur
            if beat.get("rest") or beat_start < start or beat_start >= end:
                continue
            is_bass = track.get("kind") == "bass"
            lowest = None
            for note in beat["notes"]:
                if note.get("dead") or note.get("tie"):
                    continue
                pitch = track["tuning"][note["s"]] + note["f"] + track.get("pitchOffset", 0)
                weights[pitch % 12] = weights.get(pitch % 12, 0.0) + float(dur)
                if lowest is None or pitch < lowest:
                    lowest = pitch
            if lowest is None:
                continue
            if is_bass and (first_bass is None or beat_start < first_bass[0]):
                first_bass = (beat_start, lowest)
            if first_any is None or beat_start < first_any[0] or (beat_start == first_any[0] and lowest < first_any[1]):
                first_any = (beat_start, lowest)
    bass = first_bass or first_any
    return weights, (bass[1] % 12 if bass else None)


def _score(weights, total, root, quality, bass_pc, bass_required=None):
    tones = {(root + i) % 12: i for i in TEMPLATES[quality]}
    score = 0.0
    for pc, w in weights.items():
        score += w if pc in tones else -0.8 * w
    for pc, interval in tones.items():
        if pc not in weights:
            score -= total * MISSING_COST.get(interval, 0.5)
    if bass_pc is not None:
        if bass_required is not None:
            score += total * (0.5 if bass_pc == bass_required else -0.6)
        elif bass_pc == root:
            score += total * 0.5
        elif bass_pc in tones:
            score += total * 0.1
        else:
            score -= total * 0.4
    score -= total * 0.05 * max(0, len(tones) - 3)
    return score


def _candidates(vocabulary):
    if vocabulary:
        out = []
        for name in vocabulary:
            parsed = parse_chord(name)
            if parsed:
                out.append((name, *parsed))
        if out:
            return out
    return [(None, root, quality, None) for root in range(12) for quality in TEMPLATES]


def _best(weights, bass_pc, candidates, names):
    total = sum(weights.values())
    if total <= 0 or len(weights) < 2:
        return None, 0.0
    best = None
    for name, root, quality, bass_req in candidates:
        s = _score(weights, total, root, quality, bass_pc, bass_req)
        if best is None or s > best[0]:
            best = (s, name, root, quality, bass_req)
    s, name, root, quality, bass_req = best
    if name is None:
        name = names[root] + quality
        if bass_pc is not None and bass_pc != root and bass_pc in {(root + i) % 12 for i in TEMPLATES[quality]}:
            name += "/" + names[bass_pc]
    return name, s / total


def detect_chord_timeline(tracks, bars, vocabulary=None, names=None, split_threshold=0.12):
    """Detect one or two chords per bar. tracks: converted harmony + bass tracks."""
    names = names or DEFAULT_NAMES
    candidates = _candidates(vocabulary)
    timeline = []
    last = None

    def push(bar, pos, chord):
        nonlocal last
        if chord and chord != last:
            timeline.append({"bar": bar, "pos": pos, "chord": chord})
            last = chord

    for bar in range(bars):
        whole_w, whole_bass = _weights(tracks, bar, Fraction(0), Fraction(1))
        whole, whole_ratio = _best(whole_w, whole_bass, candidates, names)
        if whole is None:
            continue
        halves = []
        for start, end in ((Fraction(0), Fraction(1, 2)), (Fraction(1, 2), Fraction(1))):
            w, b = _weights(tracks, bar, start, end)
            halves.append(_best(w, b, candidates, names))
        (first, r1), (second, r2) = halves
        if first and second and first != second and min(r1, r2) > whole_ratio + split_threshold:
            push(bar, 0.0, first)
            push(bar, 0.5, second)
        else:
            push(bar, 0.0, whole)
    return timeline
