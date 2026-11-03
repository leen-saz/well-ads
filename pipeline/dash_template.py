"""قالب اللوحة كامل: template.html وسكربته من pipeline/dash/*.js بالترتيب مكان /*__APP__*/ (المرحلة 4.3).
الناتج نفس الصفحة حرف بحرف. كل من يقرا القالب يمر من هنا."""
import glob
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def app_files():
    return sorted(glob.glob(os.path.join(HERE, "dash", "[0-9][0-9]-*.js")))


def template():
    tpl = open(os.path.join(HERE, "template.html"), encoding="utf-8").read()
    app = "".join(open(f, encoding="utf-8").read() for f in app_files())
    assert tpl.count("/*__APP__*/\n") == 1, "template.html needs exactly one /*__APP__*/ line"
    return tpl.replace("/*__APP__*/\n", app, 1)
