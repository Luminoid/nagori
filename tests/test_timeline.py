"""Chord timeline positions and the validator checks that guard them."""

import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from songlib import bar_lengths, chord_timeline  # noqa: E402

spec = importlib.util.spec_from_file_location("validate_song", ROOT / "scripts" / "validate-song.py")
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class ChordTimelineTest(unittest.TestCase):
    def test_pos_is_a_fraction_of_the_bar(self):
        q = {"d": [1, 4], "t": 4, "notes": [{"s": 0, "f": 0}]}
        track = {"id": "g", "measures": [
            {"sig": [5, 4], "beats": [dict(q, chord="A"), q, dict(q, chord="B"), q, q]},
            {"beats": [{"d": [1, 2], "t": 2, "notes": []}, {"d": [1, 2], "t": 2, "chord": "C", "notes": []}, q]},
        ]}
        self.assertEqual(bar_lengths(track["measures"]), [Fraction(5, 4), Fraction(5, 4)])
        self.assertEqual(chord_timeline([track], ["g"]), [
            {"bar": 0, "pos": 0.0, "chord": "A"},
            {"bar": 0, "pos": 0.4, "chord": "B"},
            {"bar": 1, "pos": 0.4, "chord": "C"},
        ])

    def test_four_four_is_unchanged(self):
        e = {"d": [1, 8], "t": 8, "notes": []}
        track = {"id": "g", "measures": [{"sig": [4, 4], "beats": [dict(e, chord="D")] + [e] * 3 + [dict(e, chord="G")] + [e] * 3}]}
        self.assertEqual([x["pos"] for x in chord_timeline([track], ["g"])], [0.0, 0.5])


class ValidatorTimelineTest(unittest.TestCase):
    def check(self, mutate):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "twelve-bar-blues"
            shutil.copytree(ROOT / "examples" / "twelve-bar-blues", folder)
            song = json.loads((folder / "song.json").read_text())
            mutate(song)
            (folder / "song.json").write_text(json.dumps(song))
            return validator.validate_song(folder)

    def test_example_is_clean(self):
        self.assertEqual(self.check(lambda song: None), [])

    def test_timeline_positions_must_be_bar_fractions_in_order(self):
        def pos_one(song):
            song["chordTimeline"][0]["pos"] = 1
        self.assertTrue(any("below 1" in p for p in self.check(pos_one)))

        def unsorted(song):
            song["chordTimeline"][0], song["chordTimeline"][1] = song["chordTimeline"][1], song["chordTimeline"][0]
        self.assertTrue(any("out of order" in p for p in self.check(unsorted)))

        def duplicate(song):
            song["chordTimeline"].insert(1, dict(song["chordTimeline"][0]))
        self.assertTrue(any("repeats a position" in p for p in self.check(duplicate)))

    def test_lyrics_need_a_bar_a_position_and_text(self):
        def bad(song):
            song["lyrics"] = [{"bar": 0, "pos": 0, "text": "one"}, {"bar": 0, "pos": 1, "text": "two"}, {"bar": 0, "pos": 0.5}, {"bar": 99, "pos": 0, "text": "far"}, {"bar": 1, "pos": 0, "text": "back", "join": 1}]
        problems = self.check(bad)
        self.assertTrue(any("lyric 2 pos" in p for p in problems))
        self.assertTrue(any("lyric 3 needs its text" in p for p in problems))
        self.assertTrue(any("lyric 4 needs a bar" in p for p in problems))
        self.assertTrue(any("lyric 5 join" in p for p in problems))

        def unsorted(song):
            song["lyrics"] = [{"bar": 1, "pos": 0, "text": "two"}, {"bar": 0, "pos": 0.5, "text": "one"}]
        self.assertTrue(any("lyric 2 is out of order" in p for p in self.check(unsorted)))

        def good(song):
            song["lyrics"] = [{"bar": 0, "pos": 0, "text": "one", "join": True}, {"bar": 1, "pos": 0.5, "text": "two"}]
        self.assertEqual(self.check(good), [])

    def test_source_url_and_video_id(self):
        def bad_url(song):
            song["source"] = {"name": "x", "url": "javascript:alert(1)"}
        self.assertTrue(any("source.url" in p for p in self.check(bad_url)))

        def bad_video(song):
            song["video"] = {"provider": "youtube", "id": "nope", "barTimes": [0.0] * song["bars"]}
        self.assertTrue(any("video.id" in p for p in self.check(bad_video)))


if __name__ == "__main__":
    unittest.main()
