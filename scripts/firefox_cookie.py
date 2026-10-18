"""Legge soltanto CAUTH di Coursera da una copia temporanea del DB Firefox."""
from contextlib import closing
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import time


def firefox_cauth():
    configured = os.environ.get('STUDYBUDDY_FIREFOX_DIR')
    home = Path.home()
    roots = [Path(configured)] if configured else [
        home / '.config/mozilla/firefox', home / '.mozilla/firefox',
        home / '.var/app/org.mozilla.firefox/.mozilla/firefox',
        home / 'snap/firefox/common/.mozilla/firefox',
        home / 'Library/Application Support/Firefox/Profiles',
    ]
    if not configured and os.environ.get('APPDATA'):
        roots.append(Path(os.environ['APPDATA']) / 'Mozilla/Firefox/Profiles')
    candidates = []
    for root in roots:
        candidates.extend(root.glob('*/cookies.sqlite'))
        if (root / 'cookies.sqlite').is_file():
            candidates.append(root / 'cookies.sqlite')
    found = []
    for original in candidates:
        # Mai aprire il DB originale: SQLite potrebbe creare/aggiornare lo shm.
        # Copiamo anche il WAL, per includere gli accessi recenti con Firefox aperto.
        for attempt in range(3):
            try:
                with tempfile.TemporaryDirectory(prefix='studybuddy-firefox-') as temp:
                    target = Path(temp) / 'cookies.sqlite'
                    shutil.copyfile(original, target)
                    wal = Path(str(original) + '-wal')
                    if wal.exists():
                        shutil.copyfile(wal, Path(str(target) + '-wal'))
                    with closing(sqlite3.connect(target)) as db:
                        rows = db.execute(
                            "SELECT value, lastAccessed FROM moz_cookies "
                            "WHERE name = 'CAUTH' AND host IN ('coursera.org', '.coursera.org', 'www.coursera.org') "
                            "AND (expiry = 0 OR expiry > ?) ORDER BY lastAccessed DESC",
                            (int(time.time()),)).fetchall()
                        found.extend((accessed, value) for value, accessed in rows if value)
                break
            except (OSError, sqlite3.Error):
                if attempt < 2:
                    time.sleep(0.05)
    if not found:
        raise RuntimeError('Sessione Firefox non trovata')
    return max(found, key=lambda item: item[0])[1]
