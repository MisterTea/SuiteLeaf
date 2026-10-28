"""Choose open fonts for Office font families and add them to suiteleaf_catalog.json.

For each Office family, every open candidate that covers the family's own characters
is scored by how closely its glyphs overlap the Office glyphs (scaled to the same
height and centered in the same advance). The best family becomes the base; glyphs it
lacks come from a few close donors, then from whatever covers the rest. Every source
is pinned by URL and SHA-256.

    python scripts/fonts/suiteleaf_plan.py --gfonts DIR cjk
    python scripts/fonts/suiteleaf_plan.py --gfonts DIR repair WORK/results.json   # donors for what a build lacks

DIR is a checkout of github.com/google/fonts at the commit in suiteleaf_sources.GF.
The scan of that checkout is cached in --work, which also holds local candidates.
"""
import argparse
import glob
import hashlib
import json
import os
import pickle
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from fontTools.ttLib import TTCollection, TTFont

import suiteleaf_fill as fill
import suiteleaf_merge as merging
import suiteleaf_sources
from suiteleaf_shaping import text_chars, worker_count

HERE = Path(__file__).parent
CATALOG = HERE / "suiteleaf_catalog.json"
OFFICE = "/Applications/Microsoft Word.app/Contents/Resources/DFonts"
GF_URL = suiteleaf_sources.GF.rsplit("ofl/", 1)[0]
# Families of the hand-written list in suiteleaf_families.py, and the Office families they cover.
TAKEN = ["Ironwood", "Acorn", "Cedar", "Linden", "Teak", "Sprig", "Willow", "Aspen", "Juniper", "Maple"]
EXACT = {"Arial", "Arial Rounded MT Bold", "Book Antiqua", "Palatino Linotype", "TH SarabunPSK", "Wingdings", "Calibri",
         "Consolas", "Times New Roman", "Symbol", "Batang", "BatangChe", "Gungsuh", "GungsuhChe", "Gulim", "GulimChe",
         "Dotum", "DotumChe"}
TREES = ("Sakura Keyaki Sugi Matsu Kaede Momiji Icho Kiri Tsubaki Kusu Shii Kashi Nara Buna Hiba Asunaro Tochi Kaya Enoki "
         "Mukunoki Hoop Wollemi Araucaria Podocarp Cottonwood Basswood Butternut Hackberry Sweetgum Sourwood Serviceberry "
         "Silverbell Smoketree Pawpaw Osage Chinaberry Tallow Soapberry Rambutan Lychee Longan Durian Jackfruit Breadfruit "
         "Neem Sal Deodar Chinar Peepal Ashoka Amla Jamun Kadam Gulmohar Sheesham Arjun Bael Palash Mahua Tendu Khair "
         "Babool Matai Puriri Pohutukawa Kowhai Manuka Karri Jarrah Marri Tuart Coolabah Bunya").split()
NAMES = {"MS Gothic": "SuiteLeaf Bamboo", "MS Mincho": "SuiteLeaf Hinoki"}
COMMON_HAN = ("的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好"
              "都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实"
              "回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世"
              "气信北少关并内加化由却代军产入先山五太水万市眼体别处总才场师书比住员九笑性通目华报立马命张活难神数件安表原车白应路期叫死"
              "常提感金何更反合放做系计或司利受光王果亲界及今京务制解各任至清物台象记边共风战干接它许八特觉望直服毛林题建南度统色字请交"
              "爱让认算论百吃义科怎元社术结六功指思非流每青管夫连远资队跟带花快条院变联言权往展该领传近留红治决周保达办运武半候七必城父")
COMMON_HANT = ("的一是不了人我在有他這中大來上國個到說們為子和你地出道也時年得就那要下以生會自著去之過家學對可她裡後小麼心多天而能好"
               "都然沒日於起還發成事只作當想看文無開手十用主行方又如前所本見經頭面公同三已老從動兩長知民樣現分將外但身些與高意進把法此實"
               "回二理美點月明其種聲全工己話兒者向情部正名定女問力機給等幾很業最間新什打便位因重被走電四第門相次東政海口使教西再平真聽世"
               "氣信北少關並內加化由卻代軍產入先山五太水萬市眼體別處總才場師書比住員九笑性通目華報立馬命張活難神數件安表原車白應路期叫死"
               "常提感金何更反合放做系計或司利受光王果親界及今京務制解各任至清物台象記邊共風戰乾接它許八特覺望直服毛林題建南度統色字請交")
LOCAL = {  # Candidates outside Google Fonts: (zip or deb URL, SHA-256, member pattern, cache folder, license file member)
    "jigmo": ("https://kamichikoichi.github.io/jigmo/Jigmo-20230816.zip",
              "4d2641686e0978819a3fc0f5250b31a209f829de42bb12448745fc8d89dd2fc2", "zip", "Jigmo-20230816/{}", "Jigmo-20230816/LICENSE.txt"),
    "ume": ("https://deb.debian.org/debian/pool/main/f/fonts-horai-umefont/fonts-horai-umefont_670-5_all.deb",
            "1b1ed2bef53ff395439ce3999b8c28dc8b9bff9d4d0de31cc440a1f331b4a9b9", "deb", "*/horai-umefont/{}",
            "*/doc/fonts-horai-umefont/copyright"),
}


def log(message):
    print(message, file=sys.stderr, flush=True)


# --- Candidate fonts ------------------------------------------------------------------

def scan_corpus(gfonts, work):
    """Every Google Fonts OFL face (variable fonts by named instance): (path, coords, family, weight, italic, cmap)."""
    cache = Path(work) / "corpus.pkl"
    if cache.exists():
        return pickle.loads(cache.read_bytes())
    out = []
    for p in sorted(glob.glob(f"{gfonts}/ofl/*/*.ttf")):
        try:
            f = TTFont(p, lazy=True)
            cmap = frozenset((f.getBestCmap() or {}).keys())
            name = f["name"].getDebugName(16) or f["name"].getDebugName(1)
        except Exception:
            continue
        if "fvar" in f:
            for inst in f["fvar"].instances:
                c = inst.coordinates
                if c.get("wdth", 100) != 100:
                    continue
                italic = "Italic" in p or c.get("ital", 0) > 0 or c.get("slnt", 0) != 0
                out.append((p, tuple(sorted(c.items())), name, c.get("wght", 400), italic, cmap))
        else:
            out.append((p, None, name, f["OS/2"].usWeightClass, bool(f["head"].macStyle & 2) or "Italic" in p, cmap))
    cache.write_bytes(pickle.dumps(out))
    return out


def usable(candidate):
    """Fonts that cannot donate outlines: blank placeholders and bitmap color fonts."""
    return candidate[2] != "Adobe Blank" and "Color" not in candidate[2]


def local_candidates(work):
    """Jigmo (CC0, with CJK Extension B) and the Ume fonts, unpacked into the work folder."""
    out = []
    for key, (url, sha, kind, pattern, _) in LOCAL.items():
        folder = Path(work) / key
        if not folder.exists():
            blob = suiteleaf_sources._download(url)
            assert hashlib.sha256(blob).hexdigest() == sha, url
            suiteleaf_sources._extract(blob, kind, {pattern.format(n): f"{key}/{n}" for n in _names(blob, kind, pattern)}, Path(work))
        for p in sorted(folder.glob("*.ttf")):
            f = TTFont(p, lazy=True)
            out.append((str(p), None, f["name"].getDebugName(1), f["OS/2"].usWeightClass, False, frozenset(f.getBestCmap())))
    return out


def _names(blob, kind, pattern):
    import fnmatch, io, tarfile, zipfile
    if kind == "zip":
        names = zipfile.ZipFile(io.BytesIO(blob)).namelist()
    else:
        names = [m.name for m in tarfile.open(fileobj=io.BytesIO(suiteleaf_sources._deb_data(blob))).getmembers()]
    return [n.rsplit("/", 1)[-1] for n in names if fnmatch.fnmatch(n, pattern.format("*.ttf"))]


# --- Scoring --------------------------------------------------------------------------

def overlap(office, donor, cps):
    """Mean overlap of the donor's glyphs, scaled to the Office glyphs' height and centered in their advance."""
    dfont, dgs, dcmap, dupem = donor
    cps = [c for c in cps if c in dcmap and c in office.cmap]

    def height(gs, cmap, chars):
        hs = [b[3] - b[1] for b in (fill.bounds(gs, cmap[c]) for c in chars) if b and b[3] > b[1]]
        return float(np.median(hs)) if hs else None

    oh, dh = height(office.gs, office.cmap, cps), height(dgs, dcmap, cps)
    if not cps or not oh or not dh:
        return 0.0
    s, k = oh / dh, fill.PX / office.upem
    vals = []
    for c in cps:
        dx = (office.advance(c) - dfont["hmtx"][dcmap[c]][0] * s) / 2
        vals.append(fill.iou(office.raster(c), fill.raster_from(dgs, dcmap[c], (s * k, 0, 0, s * k, dx * k + 8, 0))))
    return float(np.mean(vals))


def score_candidate(args):
    """One candidate font against every Office face that wants it: [(face key, score)]."""
    path, coords, faces = args
    try:
        donor = fill.donor_font(path, 0, coords)
    except Exception:
        return [(key, 0.0) for key, _, _ in faces]
    out = []
    for key, office_path, cps in faces:
        office = _office(office_path)
        cover = sum(c in donor[2] for c in cps) / max(len(cps), 1)
        out.append((key, overlap(office, donor, cps) * cover))
    fill.donor_font.cache_clear()
    return out


_OFFICES = {}


def _office(path):
    if path not in _OFFICES:
        if len(_OFFICES) > 4:
            _OFFICES.clear()
        _OFFICES[path] = fill.Office(path)
    return _OFFICES[path]


def score_all(requests):
    """requests: {face key: (office path, cps, [candidates])} -> {face key: {candidate index: score}}."""
    by_font = {}
    for key, (office_path, cps, cands) in requests.items():
        for c in cands:
            by_font.setdefault((c[0], c[1]), []).append((key, office_path, cps))
    jobs = [(p, co, faces) for (p, co), faces in by_font.items()]
    log(f"scoring {len(jobs)} candidate fonts with {worker_count()} workers")
    scores = {}
    with ProcessPoolExecutor(worker_count(), max_tasks_per_child=4) as ex:
        for (p, co, _), result in zip(jobs, ex.map(score_candidate, jobs)):
            for key, s in result:
                scores.setdefault(key, {})[(p, co)] = s
    return scores


# --- Office faces ---------------------------------------------------------------------

def office_families(office_dir):
    fams = {}
    for f in sorted(os.listdir(office_dir)):
        if not f.lower().endswith((".ttf", ".otf", ".ttc")):
            continue
        fonts = TTCollection(f"{office_dir}/{f}").fonts if f.lower().endswith(".ttc") else [TTFont(f"{office_dir}/{f}", lazy=True)]
        for i, t in enumerate(fonts):
            n = t["name"]
            fams.setdefault(n.getDebugName(16) or n.getDebugName(1), []).append((f, i, n.getDebugName(17) or n.getDebugName(2)))
    return fams


def office_face(office_dir, work, file, index):
    out = Path(work) / f"office-{file}-{index}.ttf"
    if not out.exists():
        (TTCollection(f"{office_dir}/{file}").fonts[index] if file.lower().endswith(".ttc") else TTFont(f"{office_dir}/{file}")).save(out)
    return str(out)


def cjk_script(name, font):
    if "ExtB" in name:
        return "extb"
    pages = font["OS/2"].ulCodePageRange1
    if pages & (1 << 17):
        return "ja"
    if pages & (1 << 19) or pages & (1 << 21):
        return "ko"
    if pages & (1 << 20) and not pages & (1 << 18):
        return "zh-hant"
    if pages & (1 << 18) or pages & (1 << 20):
        return "zh"
    return None


def sample(script, cmap):
    if script == "ja":
        kana = [c for c in list(range(0x3041, 0x3097)) + list(range(0x30A1, 0x30F7)) if c in cmap]
        return kana + [ord(c) for c in COMMON_HAN if ord(c) in cmap][:200]
    if script == "ko":
        return [c for c in range(0xAC00, 0xD7A4, 37) if c in cmap][:300]
    if script == "zh-hant":
        return [ord(c) for c in COMMON_HANT if ord(c) in cmap][:300]
    if script == "extb":
        return [c for c in range(0x20000, 0x2A6E0, 97) if c in cmap][:300]
    return [ord(c) for c in COMMON_HAN if ord(c) in cmap][:300]


# --- Sources and licenses -------------------------------------------------------------

def gf_source(gfonts, path):
    """A checkout path -> (cache path, source entries including the folder's license file when it has one)."""
    rel = os.path.relpath(os.path.realpath(path), os.path.realpath(gfonts))
    kind, d, f = rel.split("/")
    prefix = "gf" if kind == "ofl" else "gfa"

    def entry(r):
        url = GF_URL + r.replace("[", "%5B").replace("]", "%5D")
        return {"url": url, "sha256": hashlib.sha256(Path(gfonts, r).read_bytes()).hexdigest(), "kind": "file",
                "dest": f"{prefix}/{r.split('/', 1)[1]}"}

    lic = f"{kind}/{d}/{'OFL.txt' if kind == 'ofl' else 'LICENSE.txt'}"
    return f"{prefix}/{d}/{f}", [entry(rel)] + ([entry(lic)] if Path(gfonts, lic).exists() else []), f"{prefix}/{d}/OFL.txt"


def resolve(gfonts, path):
    """-> (cache path, license files, source entries)."""
    for key, (url, sha, kind, pattern, license_member) in LOCAL.items():
        if f"/{key}/" in path:
            name = os.path.basename(path)
            lic = f"{key}/{license_member.rsplit('/', 1)[-1]}"
            return f"{key}/{name}", [lic], [{"url": url, "sha256": sha, "kind": kind,
                                               "members": {pattern.format(name): f"{key}/{name}", license_member: lic}}]
    cache, entries, lic = gf_source(gfonts, path)
    return cache, [lic], entries


def credit_of(path):
    n = TTFont(path, lazy=True)["name"]
    version = (n.getDebugName(5) or "").replace("Version ", "").split(";")[0]
    return f"{n.getDebugName(4)} {version}, {(n.getDebugName(0) or '').strip()}"


# --- Donors ---------------------------------------------------------------------------

def donor_pool(office, base_cmap, corpus, weight, italic, scores):
    """Close donors first (by the same score that chose the base), each taken only if it covers more
    of what is missing, then the Google Fonts faces that cover the most of the rest, Noto first."""
    missing = [c for c in text_chars(office.cmap) if c not in base_cmap and not merging.script_of(c)]
    left, chosen, families = set(missing), [], set()
    by_key = {(c[0], c[1]): c for c in corpus}
    ranked = sorted((kv for kv in scores.items() if kv[0] in by_key), key=lambda kv: -kv[1])
    for key, _ in ranked:
        p, coords, name, w, it, cmap = by_key[key]
        gain = left & cmap
        if name in families or len(gain) < max(3, 0.01 * len(missing)):
            continue
        chosen.append((p, coords, name))
        families.add(name)
        left -= gain
        if len(families) >= 4 or len(left) <= 0.005 * len(missing):
            break
    order = sorted(corpus, key=lambda c: (not c[2].startswith("Noto"), c[4] != italic, abs(c[3] - weight)))
    while left:
        best = max(order, key=lambda c: len(left & c[5]))
        gain = left & best[5]
        if not gain:
            break
        chosen.append((best[0], best[1], best[2]))
        left -= gain
    return chosen, len(left)


# --- Planning -------------------------------------------------------------------------

def plan(args, groups):
    """groups: [(group name, office family names, script)]; adds a catalog family per group."""
    catalog = json.loads(CATALOG.read_text())
    taken = set(catalog["families"]) | {f"SuiteLeaf {t}" for t in TAKEN} | set(NAMES.values())
    trees = [t for t in TREES if f"SuiteLeaf {t}" not in taken]
    fams = office_families(args.office)
    corpus = [c for c in scan_corpus(args.gfonts, args.work) if usable(c)]
    cands_all = [c for c in corpus if usable(c)] + local_candidates(args.work)
    log(f"{len(corpus)} Google Fonts faces")
    faces, requests = [], {}
    for group, office_names, script in groups:
        for oname in office_names:
            for file, index, style in fams[oname]:
                opath = office_face(args.office, args.work, file, index)
                office = TTFont(opath)
                cps = sample(script, set(office.getBestCmap() or {}))
                weight = office["OS/2"].usWeightClass
                italic = bool(office["head"].macStyle & 2)
                cands = [c for c in cands_all if not c[4] and abs(c[3] - weight) <= 250
                         and sum(x in c[5] for x in cps) >= 0.9 * len(cps)]
                key = (group, oname, file, index)
                faces.append((key, opath, style, weight, italic))
                requests[key] = (opath, cps, cands)
    scores = score_all(requests)
    by_group = {}
    for key, opath, style, weight, italic in faces:
        by_group.setdefault(key[0], []).append((key, opath, style, weight, italic))
    chosen = {}
    for group, rows in by_group.items():
        # One family for the whole group: the best mean over its faces.
        best_by_family = {}
        for key, *_ in rows:
            per = {}
            for (p, co), s in scores.get(key, {}).items():
                name = next(c[2] for c in requests[key][2] if (c[0], c[1]) == (p, co))
                per[name] = max(per.get(name, 0), s)
            for name, s in per.items():
                best_by_family.setdefault(name, []).append(s)
        ranked = sorted(((sum(v) / len(rows), n) for n, v in best_by_family.items() if len(v) == len(rows)), reverse=True)
        if not ranked:
            log(f"{group}: no candidate covers it")
            continue
        family_name = ranked[0][1]
        log(f"{group} -> {family_name} ({ranked[0][0]:.3f}); next {[n for _, n in ranked[1:4]]}")
        for key, opath, style, weight, italic in rows:
            pick = max(((s, pc) for pc, s in scores[key].items()
                        if next(c[2] for c in requests[key][2] if (c[0], c[1]) == pc) == family_name))[1]
            chosen[key] = pick
    for group, rows in by_group.items():
        if not any(key in chosen for key, *_ in rows):
            continue
        family = NAMES.get(group) or f"SuiteLeaf {trees.pop(0)}"
        spec = {"office": group, "group": group, "office_families": sorted({k[1] for k, *_ in rows}),
                "approximate": [], "merges": {}, "faces": []}
        sources, licenses, credits = [], [], set()
        for key, opath, style, weight, italic in rows:
            path, coords = chosen[key]
            cache, lic, entries = resolve(args.gfonts, path)
            sources += entries
            licenses += [x for x in lic if x not in licenses]
            credits.add(credit_of(path))
            office = fill.Office(opath)
            base_cmap = set(TTFont(path, lazy=True).getBestCmap())
            donors, uncovered = donor_pool(office, base_cmap, corpus, weight, italic, scores.get(key, {}))
            face_style = style if len(spec["office_families"]) == 1 else f"{key[1][len(os.path.commonprefix(spec['office_families'])):].strip()} {style}".strip()
            face = {"office": key[2], "index": key[3], "source": cache, "coords": dict(coords) if coords else None,
                    "style": face_style if face_style not in ("Roman", "Normal") else "Regular",
                    "options": {"fit": True, **({"slant": round(-TTFont(opath)["post"].italicAngle or 12, 1)} if italic else {})},
                    "donors": []}
            for p, co, name in donors:
                dcache, dentries, _ = gf_source(args.gfonts, p)
                sources += dentries
                face["donors"].append([dcache, [list(x) for x in co] if co else None, name])
            spec["faces"].append(face)
            log(f"  {family} {face['style']}: {cache}, {len(donors)} donors, {uncovered} characters uncovered")
        own = all(x.endswith("OFL.txt") for x in licenses)
        spec["base"] = {"credit": "; ".join(sorted(credits)), "files": licenses,
                        "license": "SIL Open Font License 1.1" if own else "SIL Open Font License 1.1 (the source's own license is also below)"}
        catalog["families"][family] = spec
        catalog["sources"] += sources
    # The catalog may have changed while scoring ran: add to its current contents.
    fresh = json.loads(CATALOG.read_text())
    fresh["families"].update({k: v for k, v in catalog["families"].items() if k not in fresh["families"]})
    fresh["sources"] = merge_sources(fresh["sources"] + catalog["sources"])
    tmp = CATALOG.with_suffix(".tmp")
    tmp.write_text(json.dumps(fresh, indent=1, ensure_ascii=False))
    os.replace(tmp, CATALOG)


def merge_sources(sources):
    seen, out = {}, []
    for s in sources:
        key = (s["url"], s.get("dest"))
        if key in seen:
            if s["kind"] != "file":
                seen[key]["members"].update(s["members"])
            continue
        seen[key] = {**s, "members": dict(s["members"])} if s["kind"] != "file" else s
        out.append(seen[key])
    return out


DEJAVU = {"sans": ["DejaVuSans", "DejaVuSans-Bold", "DejaVuSans-Oblique", "DejaVuSans-BoldOblique"],
          "serif": ["DejaVuSerif", "DejaVuSerif-Bold", "DejaVuSerif-Italic", "DejaVuSerif-BoldItalic"],
          "mono": ["DejaVuSansMono", "DejaVuSansMono-Bold", "DejaVuSansMono-Oblique", "DejaVuSansMono-BoldOblique"]}
DEJAVU_TAR = ("https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.tar.bz2",
              "fa9ca4d13871dd122f61258a80d01751d603b4d3ee14095d65453b4e846e17d7")


def repair(args, results_path):
    """Add donors for whatever each built face still lacks."""
    catalog = json.loads(CATALOG.read_text())
    corpus = [c for c in scan_corpus(args.gfonts, args.work) if usable(c)]
    for r in json.loads(Path(results_path).read_text()):
        spec = catalog["families"].get(r["family"])
        if not spec:
            continue
        office = TTFont(r["office_path"])
        ours = set(TTFont(r["path"]).getBestCmap())
        left = {c for c in text_chars(office.getBestCmap() or {}) if c not in ours}
        if not left:
            continue
        face = next(f for f in spec["faces"] if f["style"] == r["style"])
        weight, italic = office["OS/2"].usWeightClass, bool(office["head"].macStyle & 2)
        added = []
        if spec["base"]["license"].startswith("SIL"):
            order = sorted(corpus, key=lambda c: (not c[2].startswith("Noto"), c[4] != italic, abs(c[3] - weight)))
            while left:
                best = max(order, key=lambda c: len(left & c[5]))
                if not left & best[5]:
                    break
                left -= best[5]
                cache, entries, _ = gf_source(args.gfonts, best[0])
                catalog["sources"] += entries
                donor = [cache, [list(x) for x in best[1]] if best[1] else None, best[2]]
                if donor not in face["donors"]:
                    face["donors"].append(donor)
                    added.append(best[2])
        else:
            kind = "mono" if office["post"].isFixedPitch else "serif" if office["OS/2"].panose.bSerifStyle not in (11, 12, 13) else "sans"
            for k in (kind, "sans"):
                name = DEJAVU[k][(weight >= 600) + 2 * italic] + ".ttf"
                catalog["sources"].append({"url": DEJAVU_TAR[0], "sha256": DEJAVU_TAR[1], "kind": "tar",
                                           "members": {f"dejavu-fonts-ttf-2.37/ttf/{name}": f"dejavu/{name}"}})
                if [f"dejavu/{name}", None, "DejaVu"] not in face["donors"]:
                    face["donors"].append([f"dejavu/{name}", None, "DejaVu"])
                    added.append(name)
        log(f"{r['family']} {r['style']}: {len(added)} donors added for missing characters {added}")
    catalog["sources"] = merge_sources(catalog["sources"])
    tmp = CATALOG.with_suffix(".tmp")
    tmp.write_text(json.dumps(catalog, indent=1, ensure_ascii=False))
    os.replace(tmp, CATALOG)


def cjk_groups(args):
    catalog = json.loads(CATALOG.read_text())
    planned = {f for spec in catalog["families"].values() for f in spec.get("office_families", [])}
    groups = []
    for name, faces in office_families(args.office).items():
        if name in EXACT or name in planned:
            continue
        file, index, _ = faces[0]
        font = TTFont(office_face(args.office, args.work, file, index))
        script = cjk_script(name, font)
        cmap = font.getBestCmap() or {}
        if script and (sum(0x4E00 <= c <= 0x9FFF for c in cmap) > 2000 or script == "extb"):
            groups.append((name, [name], script))
    return groups


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("tier", choices=["cjk", "repair"])
    parser.add_argument("results", nargs="?", help="results.json of a build, for repair")
    parser.add_argument("--gfonts", required=True, help="Checkout of github.com/google/fonts")
    parser.add_argument("--office", default=OFFICE)
    parser.add_argument("--work", default=str(Path.home() / ".cache" / "suiteleaf-work" / "plan"))
    args = parser.parse_args()
    Path(args.work).mkdir(parents=True, exist_ok=True)
    if args.tier == "repair":
        repair(args, args.results)
        sys.exit()
    groups = cjk_groups(args)
    log(f"{len(groups)} groups: {[g[0] for g in groups]}")
    plan(args, groups)
