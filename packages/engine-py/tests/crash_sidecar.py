#!/usr/bin/env python3
import sys

sys.stderr.write("z is not defined\n")
sys.stderr.flush()
raise SystemExit(1)
