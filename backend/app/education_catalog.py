from __future__ import annotations

import time
from typing import Iterable

import requests

NSR_ENHETER_URL = "https://data-nsr.udir.no/enheter"

# Cache for the NSR dataset (it's ~7-8MB). We keep it in memory to avoid
# downloading it for every mobile keystroke.
_CACHE_TTL_SECONDS = 24 * 60 * 60

_vgs_cache: dict[str, object] = {
    "ts": 0.0,
    "items": [],
}


def _normalize(s: str) -> str:
    return (s or "").casefold().strip()


def _get_all_enheter() -> list[dict]:
    r = requests.get(NSR_ENHETER_URL, timeout=60)
    r.raise_for_status()
    data = r.json()
    if not isinstance(data, list):
        raise RuntimeError("Uventet respons fra NSR /enheter")
    return data


def get_videregaende_skoler() -> list[dict]:
    now = time.time()
    ts = float(_vgs_cache.get("ts") or 0.0)

    if now - ts < _CACHE_TTL_SECONDS and _vgs_cache.get("items"):
        return _vgs_cache["items"]  # type: ignore[return-value]

    all_items = _get_all_enheter()

    vgs = []
    for e in all_items:
        if not e.get("ErVideregaaendeSkole"):
            continue
        if not e.get("ErAktiv"):
            continue
        if not e.get("VisesPaaWeb"):
            continue

        # NSR includes "Utlandet" entries; user asked for schools in Norway.
        if str(e.get("FylkeNr") or "") == "25":
            continue

        name = (e.get("FulltNavn") or e.get("Navn") or "").strip()
        if not name:
            continue

        vgs.append(
            {
                "name": name,
                "kind": "videregående",
                "kommune": e.get("KommuneNavn"),
                "fylke_nr": e.get("FylkeNr"),
                "kommune_nr": e.get("KommuneNr"),
            }
        )

    vgs.sort(key=lambda x: _normalize(x["name"]))

    _vgs_cache["ts"] = now
    _vgs_cache["items"] = vgs

    return vgs


def search_in(items: Iterable[dict], q: str) -> list[dict]:
    qn = _normalize(q)
    if not qn:
        return list(items)

    out: list[dict] = []
    for it in items:
        if qn in _normalize(it.get("name", "")):
            out.append(it)

    return out


UNIVERSITIES: list[dict] = [
    # Universiteter
    {"name": "Universitetet i Oslo", "kind": "universitet"},
    {"name": "NTNU – Norges teknisk-naturvitenskapelige universitet", "kind": "universitet"},
    {"name": "Universitetet i Bergen", "kind": "universitet"},
    {"name": "UiT Norges arktiske universitet", "kind": "universitet"},
    {"name": "Universitetet i Stavanger", "kind": "universitet"},
    {"name": "Universitetet i Agder", "kind": "universitet"},
    {"name": "Nord universitet", "kind": "universitet"},
    {"name": "Norges miljø- og biovitenskapelige universitet (NMBU)", "kind": "universitet"},
    {"name": "OsloMet – storbyuniversitetet", "kind": "universitet"},
    {"name": "Universitetet i Sørøst-Norge (USN)", "kind": "universitet"},

    # Vitenskapelige høyskoler / kunsthøyskoler / sentrale høyskoler (vanlige søk)
    {"name": "Norges Handelshøyskole (NHH)", "kind": "høyskole"},
    {"name": "Arkitektur- og designhøgskolen i Oslo (AHO)", "kind": "høyskole"},
    {"name": "Kunsthøgskolen i Oslo (KHiO)", "kind": "høyskole"},
    {"name": "Norges musikkhøgskole (NMH)", "kind": "høyskole"},
    {"name": "MF vitenskapelig høyskole", "kind": "høyskole"},
    {"name": "Politihøgskolen", "kind": "høyskole"},

    # Utvalg av store høyskoler/private aktører (ofte brukt i CV)
    {"name": "Høyskolen Kristiania", "kind": "høyskole"},
    {"name": "BI Norwegian Business School", "kind": "høyskole"},
    {"name": "Høgskulen på Vestlandet", "kind": "høyskole"},
    {"name": "Høgskolen i Innlandet", "kind": "høyskole"},
    {"name": "Høyskolen i Østfold", "kind": "høyskole"},
]


ONLINE_SCHOOLS: list[dict] = [
    {"name": "Noroff (nettstudier)", "kind": "nettskole"},
    {"name": "NKI Nettstudier", "kind": "nettskole"},
    {"name": "Campus NooA", "kind": "nettskole"},
    {"name": "Nettskolen i Nordland", "kind": "nettskole"},
    {"name": "Nettskulen Vestland", "kind": "nettskole"},
    {"name": "Nettskolen i Rogaland", "kind": "nettskole"},
]


def get_static(kind: str) -> list[dict]:
    if kind == "universitet":
        return list(UNIVERSITIES)
    if kind == "nettskole":
        return list(ONLINE_SCHOOLS)
    if kind == "static":
        return list(UNIVERSITIES) + list(ONLINE_SCHOOLS)
    return []
