#!/usr/bin/env python3
"""انتقل إلى modules/suggest/run.py. هذا الملف باقي عشان build.py والـworkflow."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from modules.suggest.run import build, plan, digest, main  # noqa: F401

if __name__ == "__main__":
    main()
