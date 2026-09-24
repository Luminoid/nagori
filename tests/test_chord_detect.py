"""Unit tests for scripts/chord_detect.py (run: python3 -m unittest discover -s tests -p 'test_*.py')."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from chord_detect import detect_chord_timeline, parse_chord  # noqa: E402

STANDARD = [64, 59, 55, 50, 45, 40]
BASS = [43, 38, 33, 28]


def beat(notes, d=(1, 4)):
    return {"d": list(d), "t": d[1], "notes": [{"s": s, "f": f} for s, f in notes]}


def track(measures, tuning=STANDARD, kind="guitar"):
    return {"tuning": tuning, "kind": kind, "measures": [{"beats": beats} for beats in measures]}


class ParseChordTest(unittest.TestCase):
    def test_roots_qualities_and_bass(self):
        self.assertEqual(parse_chord("Dmaj7/F#"), (2, "maj7", 6))
        self.assertEqual(parse_chord("Bbm"), (10, "m", None))
        self.assertEqual(parse_chord("E5"), (4, "5", None))
        self.assertIsNone(parse_chord("Xyz"))
        self.assertIsNone(parse_chord("Cmaj13"))


class DetectTest(unittest.TestCase):
    def test_open_chords_are_named(self):
        c_major = [beat([(5, 3), (4, 3), (3, 2), (2, 0), (1, 1), (0, 0)], (1, 1))]  # 332010 low->high? use tab strings: s5=E
        c_major = [beat([(4, 3), (3, 2), (2, 0), (1, 1), (0, 0)], (1, 1))]  # x32010
        a_minor = [beat([(4, 0), (3, 2), (2, 2), (1, 1), (0, 0)], (1, 1))]  # x02210
        timeline = detect_chord_timeline([track([c_major, a_minor])], 2)
        self.assertEqual([e["chord"] for e in timeline], ["C", "Am"])

    def test_bass_note_makes_a_slash_chord(self):
        c_over_e = [beat([(2, 0), (1, 1), (0, 0)], (1, 1))]  # G C E on top strings
        bass = track([[beat([(3, 0)], (1, 1))]], tuning=BASS, kind="bass")  # low E
        timeline = detect_chord_timeline([track([c_over_e]), bass], 1)
        self.assertEqual(timeline[0]["chord"], "C/E")

    def test_vocabulary_restricts_names(self):
        f_minor_arpeggio = [beat([(5, 1)]), beat([(3, 3)]), beat([(2, 1)]), beat([(1, 1)])]  # F C Ab F
        timeline = detect_chord_timeline([track([f_minor_arpeggio])], 1, vocabulary=["Fm", "C/E", "Ab"])
        self.assertEqual(timeline[0]["chord"], "Fm")

    def test_two_chords_in_one_bar(self):
        half_c_half_g = [
            beat([(4, 3), (3, 2), (2, 0), (1, 1), (0, 0)], (1, 2)),  # C
            beat([(5, 3), (4, 2), (3, 0), (2, 0), (1, 0), (0, 3)], (1, 2)),  # G
        ]
        timeline = detect_chord_timeline([track([half_c_half_g])], 1)
        self.assertEqual([(e["pos"], e["chord"]) for e in timeline], [(0.0, "C"), (0.5, "G")])

    def test_repeated_chords_collapse_into_one_entry(self):
        a_minor = [beat([(4, 0), (3, 2), (2, 2), (1, 1), (0, 0)], (1, 1))]
        timeline = detect_chord_timeline([track([a_minor, a_minor, a_minor])], 3)
        self.assertEqual(len(timeline), 1)


if __name__ == "__main__":
    unittest.main()
