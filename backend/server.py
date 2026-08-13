"""Compatibility launcher for StudyPilot backend.

Keeps the existing backend implementation intact while making two runtime
compatibility fixes needed on Python 3.13/3.14 Windows environments:
1. relax only VERIFY_X509_STRICT (certificate verification stays enabled),
2. extend the Anthropic HTTP timeout for long PDF-processing requests.
"""

import ssl

# Patch SSL context creation before the legacy backend imports/uses it.
_original_create_default_context = ssl.create_default_context


def _create_default_context_compat(*args, **kwargs):
    context = _original_create_default_context(*args, **kwargs)
    if hasattr(ssl, "VERIFY_X509_STRICT"):
        context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return context


ssl.create_default_context = _create_default_context_compat

# The existing server constructs httpx.AsyncClient(timeout=60). Replace only
# that client class with a compatibility subclass that gives long Anthropic
# generation requests enough time to complete.
import httpx

_OriginalAsyncClient = httpx.AsyncClient


class _StudyPilotAsyncClient(_OriginalAsyncClient):
    def __init__(self, *args, **kwargs):
        timeout = kwargs.get("timeout")
        if isinstance(timeout, httpx.Timeout):
            kwargs["timeout"] = httpx.Timeout(
                180.0,
                connect=30.0,
                read=180.0,
                write=180.0,
                pool=30.0,
            )
        super().__init__(*args, **kwargs)


httpx.AsyncClient = _StudyPilotAsyncClient

# Load the unchanged application implementation.
import server_legacy as _legacy

app = _legacy.app

# Preserve direct access to the legacy module's public names for uvicorn and
# any local tooling that imports server symbols.
for _name in dir(_legacy):
    if not _name.startswith("_"):
        globals()[_name] = getattr(_legacy, _name)
