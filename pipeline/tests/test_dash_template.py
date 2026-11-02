"""المرحلة 4.3: سكربت اللوحة مقسوم في pipeline/dash/، والقالب يتجمّع منه بالترتيب."""
import os, re, sys, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from dash_template import app_files, template


class DashTemplateTests(unittest.TestCase):
    def test_every_piece_once_in_order(self):
        names = [os.path.basename(f) for f in app_files()]
        self.assertEqual(names, sorted(names))
        self.assertEqual(len(set(n[:2] for n in names)), len(names), "two pieces share a number")
        html = template()
        self.assertNotIn("/*__APP__*/", html)
        pos = [html.index(open(f, encoding="utf-8").read()) for f in app_files()]
        self.assertEqual(pos, sorted(pos))

    def test_one_script_inside_the_iife(self):
        html = template()
        # async since #80: the data may come from /dash.json
        self.assertEqual(len(re.findall(r"<script>\n\(async function\(\)\{\n", html)), 1)
        self.assertIn("\n})();\n</script>", html)


if __name__ == "__main__":
    unittest.main()
