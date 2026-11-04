"""Measuring the Office face's layout by shaping text, and our face's against it.

Shaping-heavy steps run on a pool of worker processes (POOL, set by the build); each job opens its
shapers once per process and every helper also works without a pool.
"""
import io
import unicodedata
from collections import Counter, defaultdict

from fontTools.ttLib import TTFont

from suiteleaf_glyphs import mark_glyphs
from suiteleaf_shaping import Shaper, char_script, clusters, total, worker_count

# Scripts Office fonts do not kern by default; pairs of thousands of ideographs are skipped.
UNKERNED = {"Hani", "Hira", "Kana", "Hang", "Bopo"}
COMMON = {"Zyyy", "Zinh", "Zzzz", None}
# Worker processes for shaping-heavy steps; the build sets it, and every helper works without it.
POOL = None
_SHAPERS = {}


def _shaper(key, source, units=None, features=None):
    if key not in _SHAPERS:
        if len(_SHAPERS) > 3:
            _SHAPERS.clear()
        _SHAPERS[key] = Shaper(source, units, features=features)
    return _SHAPERS[key]


def _chunks(items, n=None):
    n = n or worker_count()
    size = max(1, -(-len(items) // n))
    return [items[i:i + size] for i in range(0, len(items), size)]


def _map(fn, jobs):
    return list(POOL.map(fn, jobs)) if POOL else [fn(j) for j in jobs]


def _pairs_job(args):
    office_path, units, pool, firsts, adv, kern = args
    sh = _shaper(("office", office_path, units, kern), office_path, units, None if kern else {"kern": False})
    out = {}
    for a in firsts:
        for b in pool:
            pos = sh.shape(chr(a) + chr(b)).glyph_positions
            d = sum(p.x_advance for p in pos) - adv[a] - adv[b]
            # What of it the second glyph takes (a narrower alternate), moving where its cluster starts.
            second = (pos[1].x_offset, pos[1].x_advance - adv[b]) if len(pos) == 2 else (0, 0)
            if d or second != (0, 0):
                out[(a, b)] = (d, second)
    return out


def _fixes_job(args):
    office_path, units, key, data, texts, kern = args
    features = None if kern else {"kern": False}
    osh = _shaper(("office", office_path, units, kern), office_path, units, features)
    ssh = _shaper(("font", key, kern), data, None, features)
    return [boundary_fixes(osh, ssh, t) for t in texts]


def _accent_job(args):
    """Texts whose marks sit elsewhere than in the Office face: {(glyphs before, mark glyph): {(dx, dy): n}}.
    Each text reports its first misplaced mark; where ours draws a letter with more glyphs (the Office
    face draws Ố's two marks as one glyph), only the marks typed after it. Texts laid out differently are
    left to the other corrections."""
    office_path, units, key, data, texts = args
    osh = _shaper(("office", office_path, units), office_path, units)
    ssh = _shaper(("font", key), data)
    marks = mark_glyphs(TTFont(io.BytesIO(data)))
    out = defaultdict(Counter)

    def placed(buf):
        x, at = 0, []
        for p in buf.glyph_positions:
            at.append((x + p.x_offset, p.y_offset))
            x += p.x_advance
        return at, x

    for text in texts:
        ob, sb = osh.shape(text), ssh.shape(text)
        (oat, ox), (sat, sx) = placed(ob), placed(sb)
        if ox != sx:
            continue
        # The glyphs the lookups saw: a hidden character's own, not the space shown for it.
        names = [ssh.font.glyph_to_string(g.codepoint) for g in ssh.shape(text, preserve=True).glyph_infos]
        if len(names) != len(sat):
            continue
        if len(oat) == len(sat):
            compared = [(i, i) for i in range(len(oat))]
        elif len(oat) > len(sat):
            continue
        else:
            k = len(text) - len(text.rstrip("".join(ch for ch in text if unicodedata.category(ch) in ("Mn", "Me"))))
            if not k or min(len(oat), len(sat)) <= k:
                continue
            compared = [(len(oat) - k + j, len(sat) - k + j) for j in range(k)]
        for o, s in compared:
            if oat[o] != sat[s]:
                # Only marks move; a letter placed elsewhere is the kerning's to fix.
                if names[s] in marks:
                    # Everything from the base: the marks between may sit differently on each base.
                    context = tuple(names[:s + 1])
                    out[context][(oat[o][0] - sat[s][0], oat[o][1] - sat[s][1])] += 1
                break
    return out


def _learn_job(args):
    office_path, units, key, data, texts, names = args
    osh = _shaper(("office", office_path, units), office_path, units)
    ssh = _shaper(("font", key), data)
    seen = defaultdict(Counter)
    for text in texts:
        ob, sb = osh.shape(text), ssh.shape(text)
        if [i.cluster for i in ob.glyph_infos] != [i.cluster for i in sb.glyph_infos]:
            continue
        for info, op in zip(sb.glyph_infos, ob.glyph_positions):
            name = ssh.font.glyph_to_string(info.codepoint)
            if name in names:
                seen[name][op.x_advance] += 1
    return seen


def office_pairs(office_path, chars, units, exclude=(), kern=True):
    """Office spacing for ordered pairs beyond the two advances: kerning and two-letter ligatures, or
    without kerning (kern false) what of it stays when text is not kerned. -> ({pair: spacing}, {pair:
    (offset, advance change) of the second glyph, where the Office face draws it otherwise after the first})

    Browsers shape each script separately, so only pairs within one script (plus
    punctuation and other common characters) can meet.
    """
    sh = Shaper(office_path, units)
    groups, rare = defaultdict(list), defaultdict(list)
    common = []
    for c in chars:
        if c in exclude:
            continue
        s = char_script(c)
        if s in COMMON:
            common.append(c)
        else:
            (rare if s in UNKERNED else groups)[s].append(c)
    # CJK scripts rarely kern; measure one only when a sample of its pairs shows kerning. A large one
    # (Han, Hangul syllables) is measured against CJK punctuation only.
    punct = [c for c in common if 0x3000 <= c <= 0x303F or 0xFF00 <= c <= 0xFFEF]
    big = []
    for s, members in rare.items():
        sample = members[:: max(1, len(members) // 40)][:40]
        others = sample + common[:: max(1, len(common) // 120)][:120]
        if not any(total(sh, chr(a) + chr(b)) != total(sh, chr(a)) + total(sh, chr(b))
                   for a in sample for b in others if b != a) and \
           not any(total(sh, chr(b) + chr(a)) != total(sh, chr(a)) + total(sh, chr(b)) for a in sample for b in others[len(sample):]):
            continue
        if len(members) <= 3000:
            groups[s] = members
        else:
            big.append(members)
    adv = {c: total(sh, chr(c)) for g in list(groups.values()) + big + [common] for c in g}
    jobs = []
    for members in list(groups.values()) or [[]]:
        pool = members + common
        for firsts in _chunks(pool):
            jobs.append((office_path, units, pool, firsts, adv, kern))
    for members in big:
        for firsts in _chunks(members):
            jobs.append((office_path, units, punct, firsts, adv, kern))
        jobs.append((office_path, units, members, punct, adv, kern))
    deltas, seconds = {}, {}
    for part in _map(_pairs_job, jobs):
        for pair, (d, second) in part.items():
            if d:
                deltas[pair] = d
            if second != (0, 0):
                seconds[pair] = second
    return deltas, seconds


def boundary_fixes(osh, ssh, text):
    """Advance corrections so our glyphs reach every Office cluster boundary, and the end, together.

    Boundaries are visited left to right on the page, which for right-to-left text
    is the reverse of character order; the fixes come back in reading order.
    """
    _, ostarts, _, oend, _, _ = clusters(osh, text)
    names, sstarts, before, send, rtl, advances = clusters(ssh, text)

    def carrier(i):
        # A zero-width glyph (a mark) cannot take a correction: HarfBuzz zeroes mark advances.
        while i > 0 and advances[i] == 0:
            i -= 1
        return i

    fixes, carried = [], 0
    shared = sorted((k for k in ostarts if k in sstarts and before[k] >= 0), key=lambda k: sstarts[k])
    for k in shared + [None]:
        target = oend if k is None else ostarts[k]
        ours = (send if k is None else sstarts[k]) + carried
        r = target - ours
        if r:
            idx = carrier(len(names) - 1 if k is None else before[k])
            fixes.append((tuple(names), idx, r))
            carried += r
    # Lookups match glyphs in reading order.
    if rtl:
        fixes = [(seq[::-1], len(seq) - 1 - idx, r) for seq, idx, r in fixes]
    return fixes


def learn_advances(office_path, units, data, probes, names):
    """Widths for glyphs only reached through substitutions, from the Office face's shaping of the same text."""
    key = hash(data)
    seen = defaultdict(Counter)
    for part in _map(_learn_job, [(office_path, units, key, data, chunk, names) for chunk in _chunks(probes)]):
        for name, counts in part.items():
            seen[name].update(counts)
    return {n: c.most_common(1)[0][0] for n, c in seen.items()}
