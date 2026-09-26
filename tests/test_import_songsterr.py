"""The Songsterr importer's conversions: repeat unfolding and strum direction (no network: the raw shapes are built by hand)."""

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
spec = importlib.util.spec_from_file_location("import_songsterr", ROOT / "scripts" / "import-songsterr.py")
songsterr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(songsterr)

BEAT = {"type": 4, "duration": [1, 4], "notes": [{"string": 0, "fret": 0}]}


def bar(**marks):
    return {"voices": [{"beats": [BEAT]}], **marks}


class RepeatTest(unittest.TestCase):
    def test_alternate_endings_unfold_to_the_bars_as_played(self):
        measures = [{"repeatStart": True}, {"repeat": 3, "alternateEnding": [1, 2]}, {"alternateEnding": [3]}, {}]
        self.assertEqual(songsterr.played_order(measures), [0, 1, 0, 1, 0, 2, 3], "Exit Music's intro: bars 1-2 twice, then bar 1 and the third ending")

    def test_a_plain_repeat_plays_the_section_count_times(self):
        self.assertEqual(songsterr.played_order([{}, {"repeatStart": True}, {}, {"repeat": 2}, {}]), [0, 1, 2, 3, 1, 2, 3, 4])
        self.assertEqual(songsterr.played_order([{}, {}, {}]), [0, 1, 2], "no signs, no change")
        self.assertEqual(songsterr.played_order([{"repeat": 2}, {}]), [0, 0, 1], "a close without a start repeats from the first bar")

    def test_convert_measures_keeps_a_marker_on_the_first_pass_only(self):
        part = {"measures": [bar(repeatStart=True, marker={"text": "Intro"}, signature=[4, 4]), bar(repeat=2), bar(marker={"text": "Verse"})]}
        measures = songsterr.convert_measures(part)
        self.assertEqual([m.get("marker") for m in measures], ["Intro", None, None, None, "Verse"])
        self.assertEqual([m.get("sig") for m in measures], [[4, 4], None, [4, 4], None, None])
        measures[0]["beats"][0]["notes"][0]["f"] = 9
        self.assertEqual(measures[2]["beats"][0]["notes"][0]["f"], 0, "each pass is its own copy")

    def test_tempo_changes_follow_the_unfolded_bars(self):
        entries = [{"bar": 0, "pos": 0, "bpm": 60, "unit": 4}, {"bar": 2, "pos": 0, "bpm": 80, "unit": 4}]
        self.assertEqual(songsterr.unfold_tempo(entries, [0, 1, 0, 1, 2]), [{"bar": 0, "pos": 0, "bpm": 60, "unit": 4}, {"bar": 4, "pos": 0, "bpm": 80, "unit": 4}])
        self.assertEqual(songsterr.unfold_tempo(entries, [0, 1, 2, 0, 1, 2]), [{"bar": 0, "pos": 0, "bpm": 60, "unit": 4}, {"bar": 2, "pos": 0, "bpm": 80, "unit": 4}, {"bar": 3, "pos": 0, "bpm": 60, "unit": 4}, {"bar": 5, "pos": 0, "bpm": 80, "unit": 4}], "a section that changes tempo changes it on every pass")


class StrokeTest(unittest.TestCase):
    def test_brush_direction_is_the_hands_and_the_flags_name_the_staff_arrow(self):
        self.assertEqual(songsterr.convert_beat({**BEAT, "upStroke": 1, "brushStroke": {"direction": "down"}})["stroke"], "down")
        self.assertEqual(songsterr.convert_beat({**BEAT, "downStroke": 1, "brushStroke": {"direction": "up"}})["stroke"], "up")
        self.assertEqual(songsterr.convert_beat({**BEAT, "pickStroke": "up"})["stroke"], "up")
        self.assertEqual(songsterr.convert_beat({**BEAT, "upStroke": 1})["stroke"], "down", "a bare flag is the staff arrow, the opposite of the hand")
        self.assertNotIn("stroke", songsterr.convert_beat(BEAT))


if __name__ == "__main__":
    unittest.main()
