#!/usr/bin/env python3
"""
colorboss.py: zero-dependency color toolkit (Python 3.8+).

  convert  <color>                 hex <-> oklch, gamut check
  contrast <fg> <bg>               WCAG 2.x ratio + APCA Lc + verdicts
  scale    <color> [--name N] [--neutral] [--no-anchor]
                                   11-step OKLCH scale (50..950), gamut-mapped, CSS out
  check    <tokens.css>            validates every "@check" pair in light AND dark; exit 1 on fail
  cvd      <color> <color> ...     Machado 2009 simulation, worst-pair distance per CVD type

Colors: "#rgb", "#rrggbb", "oklch(L C H)" with L as 0-1 or %.
"""
import math, re, sys, itertools

# ------------------------------------------------------------------ conversions
def srgb_to_lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def lin_to_srgb(c):
    c = min(max(c, 0.0), 1.0)
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

def lin_to_oklab(r, g, b):
    l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b
    m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b
    s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b
    l, m, s = (math.copysign(abs(x) ** (1/3), x) for x in (l, m, s))
    return (0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
            1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
            0.0259040371*l + 0.7827717662*m - 0.8086757660*s)

def oklab_to_lin(L, a, b):
    l = (L + 0.3963377774*a + 0.2158037573*b) ** 3
    m = (L - 0.1055613458*a - 0.0638541728*b) ** 3
    s = (L - 0.0894841775*a - 1.2914855480*b) ** 3
    return (4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
            -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
            -0.0041960863*l - 0.7034186147*m + 1.7076147010*s)

def oklch_to_lin(L, C, H):
    h = math.radians(H)
    return oklab_to_lin(L, C*math.cos(h), C*math.sin(h))

def lin_to_oklch(rgb):
    L, a, b = lin_to_oklab(*rgb)
    C = math.hypot(a, b)
    H = math.degrees(math.atan2(b, a)) % 360 if C > 1e-4 else 0.0
    return L, C, H

def in_gamut(rgb, eps=1e-4): return all(-eps <= v <= 1 + eps for v in rgb)

def gamut_map(L, C, H):
    """CSS Color 4 style: keep L and H, reduce C until in sRGB (binary search)."""
    if L >= 1: return (1.0, 0.0, H)
    if L <= 0: return (0.0, 0.0, H)
    if in_gamut(oklch_to_lin(L, C, H)): return (L, C, H)
    lo, hi = 0.0, C
    while hi - lo > 1e-5:
        mid = (lo + hi) / 2
        if in_gamut(oklch_to_lin(L, mid, H)): lo = mid
        else: hi = mid
    return (L, lo, H)

def max_chroma(L, H): return gamut_map(L, 0.5, H)[1]

def safe_round(L, C, H):
    """Round to the precision written in CSS (L 0.1%, C 0.001, H 0.1) and stay in sRGB."""
    L, H = round(L, 3), round(H, 1)
    C = math.floor(C * 1000) / 1000
    while C > 0 and not in_gamut(oklch_to_lin(L, C, H), eps=0):
        C = round(C - 0.001, 3)
    return L, max(C, 0.0), H

def to_hex(rgb): return "#%02X%02X%02X" % tuple(round(lin_to_srgb(v) * 255) for v in rgb)

def fmt_oklch(L, C, H): return f"oklch({L*100:.1f}% {C:.3f} {H:.1f})"

def parse_color(s):
    """Return linear sRGB tuple (unclamped for oklch input)."""
    s = s.strip().lower()
    m = re.fullmatch(r"#?([0-9a-f]{3}|[0-9a-f]{6})", s)
    if m:
        h = m.group(1)
        if len(h) == 3: h = "".join(c*2 for c in h)
        return tuple(srgb_to_lin(int(h[i:i+2], 16) / 255) for i in (0, 2, 4))
    m = re.fullmatch(r"oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:/\s*[\d.%]+)?\s*\)", s)
    if m:
        L = float(m.group(1)) / (100 if m.group(2) else 1)
        return oklch_to_lin(L, float(m.group(3)), float(m.group(4)))
    if s == "white": return (1.0, 1.0, 1.0)
    if s == "black": return (0.0, 0.0, 0.0)
    raise ValueError(f"colore non riconosciuto: {s!r}")

def clamp_rgb(rgb): return tuple(min(max(v, 0.0), 1.0) for v in rgb)

# ------------------------------------------------------------------ contrast
def wcag_Y(c):
    c = clamp_rgb(c); return 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2]

def wcag_ratio(fg, bg):
    a, b = wcag_Y(fg), wcag_Y(bg)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)

def apca_lc(fg, bg):
    """APCA-W3 0.0.98G-4g. Positive = dark text on light bg, negative = light on dark."""
    def ys(c):
        r, g, b = (lin_to_srgb(v) for v in c)              # back to 8-bit-ish encoded
        y = 0.2126729*r**2.4 + 0.7151522*g**2.4 + 0.0721750*b**2.4
        return y if y > 0.022 else y + (0.022 - y) ** 1.414
    t, b = ys(fg), ys(bg)
    if abs(b - t) < 0.0005: return 0.0
    if b > t:
        S = (b**0.56 - t**0.57) * 1.14
        return 0.0 if S < 0.1 else (S - 0.027) * 100
    S = (b**0.65 - t**0.62) * 1.14
    return 0.0 if S > -0.1 else (S + 0.027) * 100

# Requirement levels. wcag = hard WCAG 2.2 AA minimum, lc = APCA target (|Lc|).
LEVELS = {
    "body":     dict(wcag=4.5, lc=75, desc="testo corrente / paragrafi"),
    "text":     dict(wcag=4.5, lc=60, desc="testo secondario, label, UI text"),
    "large":    dict(wcag=3.0, lc=45, desc="titoli >=24px o >=18.66px bold"),
    "ui":       dict(wcag=3.0, lc=30, desc="componenti non testuali: bordi input, focus, icone"),
    "disabled": dict(wcag=0.0, lc=30, desc="disabilitati/placeholder (esenti WCAG, ma leggibili)"),
    "decor":    dict(wcag=0.0, lc=15, desc="divisori/bordi decorativi (ok anche con WCAG >= 1.5)"),
}

def judge(fg, bg, level):
    r, lc = wcag_ratio(fg, bg), apca_lc(fg, bg)
    req = LEVELS[level]
    ok_w = r >= req["wcag"] - 1e-9
    ok_a = abs(lc) >= req["lc"]
    if level == "decor":   # APCA clamps very dark pairs to ~0 by design: accept a visible luminance step too
        ok_a = ok_a or r >= 1.5
    return r, lc, ok_w, ok_a

# ------------------------------------------------------------------ scales
STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
ACCENT_L = [0.975, 0.945, 0.895, 0.825, 0.730, 0.630, 0.545, 0.475, 0.400, 0.330, 0.260]
ACCENT_C = [0.10, 0.22, 0.42, 0.68, 0.90, 1.00, 1.00, 0.92, 0.80, 0.66, 0.52]
NEUTRAL_L = [0.985, 0.965, 0.925, 0.870, 0.715, 0.555, 0.460, 0.375, 0.285, 0.225, 0.180]

def make_scale(color, neutral=False, anchor=True, neutral_chroma=0.008):
    L0, C0, H = lin_to_oklch(parse_color(color))
    out = []
    if neutral:
        for s, L in zip(STEPS, NEUTRAL_L):
            # a hint of hue, slightly less at the extremes
            c = neutral_chroma * (0.6 if L > 0.95 else 1.0)
            out.append((s, *safe_round(*gamut_map(L, c, H))))
        return out, None
    for s, L, k in zip(STEPS, ACCENT_L, ACCENT_C):
        c = min(C0 * k, max_chroma(L, H))
        out.append((s, *safe_round(*gamut_map(L, c, H))))
    anchored = None
    if anchor:
        i = min(range(len(STEPS)), key=lambda j: abs(ACCENT_L[j] - L0))
        out[i] = (STEPS[i], *safe_round(*gamut_map(L0, C0, H)))
        anchored = STEPS[i]
    return out, anchored

# ------------------------------------------------------------------ CVD (Machado et al. 2009, severity 1.0)
MACHADO = {
    "protan": ((0.152286, 1.052583, -0.204868), (0.114503, 0.786281, 0.099216), (-0.003882, -0.048116, 1.051998)),
    "deutan": ((0.367322, 0.860646, -0.227968), (0.280085, 0.672501, 0.047413), (-0.011820, 0.042940, 0.968881)),
    "tritan": ((1.255528, -0.076749, -0.178779), (-0.078411, 0.930809, 0.147602), (0.004733, 0.691367, 0.303900)),
}
def simulate(rgb, kind):
    M = MACHADO[kind]; c = clamp_rgb(rgb)
    return clamp_rgb(tuple(sum(M[i][j]*c[j] for j in range(3)) for i in range(3)))

def delta_eok(a, b):
    A, B = lin_to_oklab(*clamp_rgb(a)), lin_to_oklab(*clamp_rgb(b))
    return math.dist(A, B) * 100   # x100: ~2 = barely noticeable, <5 = easy to confuse

# ------------------------------------------------------------------ tokens.css parsing
def parse_tokens(path):
    txt = open(path, encoding="utf-8").read()
    clean = re.sub(r"/\*.*?\*/", "", txt, flags=re.S)
    decls = {}
    for name, val in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", clean):
        decls.setdefault(name, val.strip())     # first definition wins (main :root block)
    checks = re.findall(r"@check\s+(--[\w-]+)\s+on\s+(--[\w-]+)\s*:\s*(\w+)", txt)
    return decls, checks

def split_args(s):
    depth, cur, out = 0, "", []
    for ch in s:
        if ch == "(": depth += 1
        if ch == ")": depth -= 1
        if ch == "," and depth == 0: out.append(cur); cur = ""
        else: cur += ch
    out.append(cur)
    return [x.strip() for x in out]

def resolve(val, decls, theme, depth=0):
    if depth > 20: raise ValueError("riferimento circolare")
    val = val.strip()
    m = re.fullmatch(r"light-dark\((.*)\)", val, flags=re.S)
    if m:
        a, b = split_args(m.group(1))
        return resolve(a if theme == "light" else b, decls, theme, depth+1)
    m = re.fullmatch(r"var\(\s*(--[\w-]+)\s*(?:,(.*))?\)", val, flags=re.S)
    if m:
        name = m.group(1)
        if name in decls: return resolve(decls[name], decls, theme, depth+1)
        if m.group(2): return resolve(m.group(2), decls, theme, depth+1)
        raise ValueError(f"token non definito: {name}")
    return parse_color(val)

# ------------------------------------------------------------------ commands
def cmd_convert(c):
    rgb = parse_color(c); L, C, H = lin_to_oklch(rgb)
    ok = in_gamut(rgb)
    print(f"{to_hex(rgb)}  {fmt_oklch(L, C, H)}  {'in sRGB' if ok else 'FUORI sRGB, mappato -> ' + fmt_oklch(*gamut_map(L, C, H)) + ' ' + to_hex(oklch_to_lin(*gamut_map(L, C, H)))}")

def cmd_contrast(fg, bg):
    f, b = parse_color(fg), parse_color(bg)
    r, lc = wcag_ratio(f, b), apca_lc(f, b)
    print(f"{fg} su {bg}:  WCAG {r:.2f}:1   APCA Lc {lc:+.1f}  ({'testo scuro su chiaro' if wcag_Y(f) <= wcag_Y(b) else 'testo chiaro su scuro'})")
    for lvl, req in LEVELS.items():
        _, _, ow, oa = judge(f, b, lvl)
        print(f"  {lvl:9s} WCAG>={req['wcag']:<4} {'ok ' if ow else 'NO '}  |Lc|>={req['lc']:<3} {'ok ' if oa else 'NO '}  {req['desc']}")

def cmd_scale(c, name, neutral, anchor):
    sc, anchored = make_scale(c, neutral=neutral, anchor=anchor)
    if anchored: print(f"/* colore originale {c} fissato sullo step {anchored} */")
    for s, L, C, H in sc:
        rgb = oklch_to_lin(L, C, H)
        print(f"  --{name}-{s}: {fmt_oklch(L, C, H)}; /* {to_hex(rgb)}  bianco {wcag_ratio((1,1,1), rgb):.2f}:1 */")

def cmd_check(path, strict_apca=False):
    decls, checks = parse_tokens(path)
    if not checks:
        print("Nessuna riga '@check --fg on --bg : livello' trovata."); return 1
    fails = warns = 0
    # gamut check of every literal color
    for name, val in decls.items():
        if val.startswith("oklch("):
            if not in_gamut(parse_color(val)):
                print(f"GAMUT  {name}: {val} fuori sRGB (i browser fanno clipping)"); warns += 1
    for theme in ("light", "dark"):
        print(f"\n== tema {theme} ==")
        for fg, bg, lvl in checks:
            if lvl not in LEVELS: print(f"livello sconosciuto {lvl}"); fails += 1; continue
            try: f, b = resolve(f"var({fg})", decls, theme), resolve(f"var({bg})", decls, theme)
            except ValueError as e: print(f"ERRORE {e}"); fails += 1; continue
            r, lc, ow, oa = judge(f, b, lvl)
            st = "ok  " if ow and oa else ("FAIL" if not ow or strict_apca else "warn")
            if st == "FAIL": fails += 1
            if st == "warn": warns += 1
            print(f"{st} {fg:22s} su {bg:18s} [{lvl:8s}] WCAG {r:5.2f}  Lc {lc:+6.1f}")
    print(f"\n{fails} fail, {warns} warning")
    return 1 if fails else 0

def cmd_cvd(colors):
    rgbs = [parse_color(c) for c in colors]
    print(f"{'visione':8s} coppia peggiore           dE_ok x100  (<5 rischio confusione, <2 quasi identici)")
    for kind in ("normal", "protan", "deutan", "tritan"):
        sim = rgbs if kind == "normal" else [simulate(c, kind) for c in rgbs]
        worst = min(itertools.combinations(range(len(sim)), 2), key=lambda p: delta_eok(sim[p[0]], sim[p[1]]))
        d = delta_eok(sim[worst[0]], sim[worst[1]])
        print(f"{kind:8s} {colors[worst[0]]} / {colors[worst[1]]:14s} {d:6.1f}")

def main(argv):
    if len(argv) < 2 or argv[1] in ("-h", "--help"): print(__doc__); return 0
    cmd, a = argv[1], argv[2:]
    if cmd == "convert": cmd_convert(a[0])
    elif cmd == "contrast": cmd_contrast(a[0], a[1])
    elif cmd == "scale":
        name = a[a.index("--name")+1] if "--name" in a else "brand"
        cmd_scale(a[0], name, "--neutral" in a, "--no-anchor" not in a)
    elif cmd == "check": return cmd_check(a[0], "--strict" in a)
    elif cmd == "cvd": cmd_cvd(a)
    else: print(__doc__); return 2
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv))
