import unittest

from modules.core.connections import lines


class Lines(unittest.TestCase):
    def test_writes_prefixed_heredoc_and_skips_bad_names_or_empty(self):
        out = lines([{"name": "META_ACCESS_TOKEN", "value": "abc"}, {"name": "bad name", "value": "x"},
                     {"name": "GA4_SERVICE_ACCOUNT_JSON", "value": '{\n "a": 1\n}'}, {"name": "SNAP_REFRESH_TOKEN", "value": ""}])
        self.assertEqual(len(out), 2)
        name, rest = out[0].split("<<", 1)
        tag = rest.split("\n", 1)[0]
        self.assertEqual(name, "V_META_ACCESS_TOKEN")
        self.assertEqual(out[0], f"V_META_ACCESS_TOKEN<<{tag}\nabc\n{tag}\n")
        self.assertIn('\n "a": 1\n', out[1])


if __name__ == "__main__":
    unittest.main()
