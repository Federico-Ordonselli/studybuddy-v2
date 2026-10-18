"""Adattatore headless per il motore Coursera-Downloader locale (nessuna GUI)."""
import contextlib
import logging
import os
import sys
from types import SimpleNamespace


class DownloadFailure(Exception):
    def __init__(self, code):
        self.code = code


def main():
    source, slug, destination = sys.argv[1:]
    sys.path.insert(0, source)
    import requests
    from extractors import CourseraExtractor
    from downloaders import get_downloader
    from parallel import ConsecutiveDownloader
    from workflow import CourseraDownloader

    # Non invocare main_f: dipende dal parser GUI e chiama cache_syllabus come funzione.
    logging.disable(logging.CRITICAL)  # URL firmati e cookie non devono finire nei log.
    session = requests.Session()
    cauth = os.environ.pop('STUDYBUDDY_CAUTH', '')
    if os.environ.pop('STUDYBUDDY_COURSERA_AUTH', 'manual') == 'firefox':
        from firefox_cookie import firefox_cauth
        try:
            cauth = firefox_cauth()
        except RuntimeError:
            raise DownloadFailure('firefox-session') from None
    session.cookies.set('CAUTH', cauth, domain='.coursera.org')
    error, modules = CourseraExtractor(session).get_modules(
        slug, False, False, 'all', '720p', False,
        'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js', False)
    if not modules:
        raise DownloadFailure('syllabus')
    args = SimpleNamespace(file_formats=['all'], lecture_filter=None, resource_filter=None,
        section_filter=None, verbose_dirs=False, combined_section_lectures_nums=False,
        playlist=False, hooks=[], overwrite=False, resume=True, skip_download=False,
        wget=None, curl=None, aria2=None, axel=None, downloader_arguments=[])
    class CheckedDownloader(CourseraDownloader):
        def _download_completion_handler(self, url, result):
            # Il motore originale ignora False (es. HTTP 403 dopo i retry).
            if result is False:
                self.failed_urls.append(url)
            else:
                super()._download_completion_handler(url, result)

    downloader = CheckedDownloader(ConsecutiveDownloader(get_downloader(session, slug, args)),
        args, slug, path=destination, ignored_formats=[], disable_url_skipping=False)
    downloader.download_modules(modules)
    if downloader.failed_urls:
        raise DownloadFailure('resources')
    # L'estrattore può recuperare i moduli pur ricevendo 403 per singole letture.
    # Conserviamo i materiali disponibili e segnaliamo esplicitamente il limite.
    return bool(error)


if __name__ == '__main__':
    try:
        with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            partial = main()
        if partial:
            print('Download parziale: syllabus')
    except BaseException as error:
        # Nessun traceback: può contenere token di sessione o URL firmati.
        code = 'unknown'
        if isinstance(error, DownloadFailure):
            code = error.code
        elif isinstance(error, ImportError):
            code = 'dependencies'
        else:
            # requests potrebbe non essere installato: importarlo solo dopo ImportError.
            import requests
            if isinstance(error, requests.exceptions.HTTPError):
                status = error.response.status_code if error.response is not None else None
                code = 'access' if status in (401, 403) else 'http'
            elif isinstance(error, requests.exceptions.RequestException):
                code = 'network'
            elif isinstance(error, OSError):
                code = 'filesystem'
        print('Download fallito: ' + code, file=sys.stderr)
        sys.exit(1)
