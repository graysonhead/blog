#!/usr/bin/env python3
"""Pull logbook totals from MyFlightbook into static/data/logbook/totals.json.

Stdlib only. Commands:

  mfb_sync.py auth      One-time browser sign-in. Saves an access + refresh
                        token to ~/.config/mfb-sync/tokens.json (mode 600).
  mfb_sync.py totals    Fetches totals into static/data/logbook/totals.json.
  mfb_sync.py aircraft  Fetches aircraft + flights, aggregates hours by type
                        and tail into static/data/logbook/aircraft.json, and
                        downloads each aircraft's MyFlightbook photo.
  mfb_sync.py flights   Lists recent flights with their IDs.
  mfb_sync.py flight ID Snapshots one flight's track + logbook fields for
                        {{ flightlog(flight=ID) }}. Never re-fetched unless
                        --refresh, so a published post doesn't change.
  mfb_sync.py sync      totals + aircraft, plus any flight a post references
                        that hasn't been snapshotted yet. This is what CI runs.

Client credentials come from --client-id/--client-secret, MFB_CLIENT_ID /
MFB_CLIENT_SECRET, or ~/.config/mfb-sync/client.json. Register a client at
https://myflightbook.com/logbook/mvc/oAuth with the totals, readflight, readaircraft and visited scopes and a
callback of https://localhost:8765/callback (or pass --redirect-uri to match
whatever you registered).

Endpoints are from https://myflightbook.com/logbook/mvc/oAuth/Metadata.
"""

import argparse
import base64
import hashlib
import http.server
import csv
import io
import json
import math
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE = "https://myflightbook.com/logbook/mvc/oAuth"
AUTHORIZE_URL = f"{BASE}/Authorize"
TOKEN_URL = f"{BASE}/OAuthToken"
RESOURCE_URL = f"{BASE}/OAuthResource"

# MyFlightbook's client registration only accepts https callbacks. Nothing
# listens there: after you approve, the browser fails to connect, and you
# paste that page's URL (it carries the one-time code) back into the script.
DEFAULT_REDIRECT = "https://localhost:8765/callback"
DEFAULT_SCOPE = "totals readflight readaircraft visited"
TOKEN_PATH = Path(os.environ.get("MFB_TOKEN_FILE", Path.home() / ".config/mfb-sync/tokens.json"))
CLIENT_PATH = Path(os.environ.get("MFB_CLIENT_FILE", Path.home() / ".config/mfb-sync/client.json"))
REPO_ROOT = Path(__file__).resolve().parent.parent
TOTALS_OUT = REPO_ROOT / "static/data/logbook/totals.json"
AIRCRAFT_OUT = REPO_ROOT / "static/data/logbook/aircraft.json"
# Aircraft photos. Sync writes only to auto/; overrides/ is yours. A file
# named overrides/<TAIL>.{jpg,jpeg,png,webp} replaces that aircraft's
# MyFlightbook photo, and an optional overrides/<TAIL>.txt holds its caption
# (no .txt = no caption). Tails match case-insensitively.
AIRCRAFT_IMG_DIR = REPO_ROOT / "static/images/logbook/aircraft"
AIRCRAFT_IMG_AUTO = AIRCRAFT_IMG_DIR / "auto"
AIRCRAFT_IMG_OVERRIDES = AIRCRAFT_IMG_DIR / "overrides"
OVERRIDE_EXTS = (".jpg", ".jpeg", ".png", ".webp")
MFB_PHOTO_CREDIT = "Photo via MyFlightbook"

# Per-flight snapshots for {{ flightlog(flight=ID) }}: mfb-<ID>.gpx (track)
# and mfb-<ID>.json (logbook fields). Only the fields below are published;
# remarks, crew/instructor names and the private edit link never are.
FLIGHTS_DIR = REPO_ROOT / "static/data/flights"
CONTENT_DIR = REPO_ROOT / "content"
FLIGHT_FIELDS = {
    # MyFlightbook field: (output key, label, kind)
    "TotalFlightTime": ("total", "Logged", "time"),
    "PIC": ("pic", "PIC", "time"),
    "Dual": ("dual", "Dual received", "time"),
    "Nighttime": ("night", "Night", "time"),
    "CrossCountry": ("xc", "Cross-country", "time"),
    "IMC": ("imc", "Actual instrument", "time"),
    "SimulatedIFR": ("sim", "Simulated instrument", "time"),
    "Landings": ("landings", "Landings", "int"),
    "NightLandings": ("night_landings", "Night landings", "int"),
    "Approaches": ("approaches", "Approaches", "int"),
}
MFB_SITE = "https://myflightbook.com"

# MyFlightbook serializes enums as integers and drops default (zero) values,
# so a missing NumericType means Integer and a missing Group means None.
NUM_TYPES = ["int", "decimal", "time", "currency"]
GROUP_NAMES = ["Other", "Category / Class", "ICAO", "Model", "Capabilities", "Totals", "Properties", "Total"]
GROUP_KEYS = ["none", "catclass", "icao", "model", "capabilities", "core", "properties", "total"]


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def client_creds(args):
    """Flags, then env vars, then ~/.config/mfb-sync/client.json ({"client_id": ..., "client_secret": ...})."""
    cid = args.client_id or os.environ.get("MFB_CLIENT_ID")
    secret = args.client_secret or os.environ.get("MFB_CLIENT_SECRET")
    if (not cid or not secret) and CLIENT_PATH.exists():
        conf = json.loads(CLIENT_PATH.read_text())
        cid = cid or conf.get("client_id")
        secret = secret or conf.get("client_secret")
    if not cid or not secret:
        die(f"no client credentials: create {CLIENT_PATH} or set MFB_CLIENT_ID / MFB_CLIENT_SECRET")
    return cid, secret


def post_form(url, fields):
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(url, data=data, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        die(f"{url} returned {e.code}: {e.read().decode(errors='replace')[:500]}")


def save_tokens(tok):
    if "expires_in" in tok:
        tok["expires_at"] = int(time.time()) + int(tok["expires_in"]) - 60
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_PATH.touch(mode=0o600, exist_ok=True)
    TOKEN_PATH.write_text(json.dumps(tok, indent=2))
    os.chmod(TOKEN_PATH, 0o600)


def load_tokens():
    # MFB_REFRESH_TOKEN lets CI run without a token file.
    if env_rt := os.environ.get("MFB_REFRESH_TOKEN"):
        return {"refresh_token": env_rt, "expires_at": 0}
    if not TOKEN_PATH.exists():
        die(f"no tokens at {TOKEN_PATH}; run `mfb_sync.py auth` first")
    return json.loads(TOKEN_PATH.read_text())


def access_token(args):
    tok = load_tokens()
    if tok.get("access_token") and tok.get("expires_at", 0) > time.time():
        return tok["access_token"]
    if not tok.get("refresh_token"):
        die("access token expired and no refresh token saved; run `mfb_sync.py auth` again")
    cid, secret = client_creds(args)
    new = post_form(TOKEN_URL, {
        "grant_type": "refresh_token",
        "refresh_token": tok["refresh_token"],
        "client_id": cid,
        "client_secret": secret,
    })
    # Keep the old refresh token if the server didn't rotate it.
    new.setdefault("refresh_token", tok["refresh_token"])
    if not os.environ.get("MFB_REFRESH_TOKEN"):
        save_tokens(new)
    elif new["refresh_token"] != tok["refresh_token"]:
        print("warning: refresh token rotated; update MFB_REFRESH_TOKEN", file=sys.stderr)
    return new["access_token"]


def cmd_auth(args):
    cid, secret = client_creds(args)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    url = AUTHORIZE_URL + "?" + urllib.parse.urlencode({
        "response_type": "code",
        "client_id": cid,
        "redirect_uri": args.redirect_uri,
        "scope": args.scope,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })

    redirect = urllib.parse.urlparse(args.redirect_uri)
    print(f"Open this URL to authorize:\n\n  {url}\n")
    webbrowser.open(url)

    if redirect.scheme == "http" and redirect.hostname in ("localhost", "127.0.0.1"):
        params = wait_for_callback(redirect)
    else:
        print("After approving, your browser will land on a page that can't load. That's expected.")
        pasted = input("Copy that page's full URL from the address bar and paste it here: ").strip()
        params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(pasted).query))

    if "error" in params:
        die(f"authorization failed: {params.get('error')} {params.get('error_description', '')}")
    if params.get("state") != state:
        die("state mismatch; refusing the code")

    tok = post_form(TOKEN_URL, {
        "grant_type": "authorization_code",
        "code": params["code"],
        "redirect_uri": args.redirect_uri,
        "client_id": cid,
        "client_secret": secret,
        "code_verifier": verifier,
    })
    save_tokens(tok)
    print(f"Saved tokens to {TOKEN_PATH} (scope: {tok.get('scope', args.scope)})")


def wait_for_callback(redirect):
    result = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            if u.path != redirect.path:
                self.send_error(404)
                return
            result.update(urllib.parse.parse_qsl(u.query))
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"Got it. You can close this tab.")

        def log_message(self, *a):
            pass

    with http.server.HTTPServer((redirect.hostname, redirect.port or 80), Handler) as srv:
        print(f"Waiting for the redirect on {redirect.geturl()} ...")
        while not result:
            srv.handle_request()
    return result


def call(args, method, **params):
    q = urllib.parse.urlencode({"json": 1, **params})
    req = urllib.request.Request(
        f"{RESOURCE_URL}/{method}?{q}",
        headers={"Authorization": f"Bearer {access_token(args)}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        die(f"{method} returned {e.code}: {e.read().decode(errors='replace')[:500]}")


def enum_index(v, names):
    """MyFlightbook enums arrive as ints, but accept names too in case that changes."""
    if v is None:
        return 0
    if isinstance(v, int):
        return v
    lowered = [n.lower() for n in names]
    return lowered.index(str(v).lower()) if str(v).lower() in lowered else 0


def fmt(value, kind):
    if kind == "time":
        return f"{value:,.1f}"
    if kind == "int":
        return f"{int(value):,}"
    if kind == "currency":
        return f"${value:,.2f}"
    return f"{value:,.2f}"


def cmd_totals(args):
    raw = call(args, "TotalsForUserWithQuery")
    groups = {}
    for item in raw:
        gi = enum_index(item.get("Group"), ["None", "CategoryClass", "ICAO", "Model", "Capabilities", "CoreFields", "Properties", "Total"])
        kind = NUM_TYPES[enum_index(item.get("NumericType"), ["Integer", "Decimal", "Time", "Currency"])]
        value = float(item.get("Value", 0))
        g = groups.setdefault(gi, {
            "key": GROUP_KEYS[gi] if gi < len(GROUP_KEYS) else "none",
            "name": item.get("GroupName") or (GROUP_NAMES[gi] if gi < len(GROUP_NAMES) else "Other"),
            "items": [],
        })
        g["items"].append({
            "label": item.get("Description", ""),
            "sub": item.get("SubDescription", ""),
            "kind": kind,
            "value": value,
            "display": fmt(value, kind),
        })

    # "Overall" (total time, flight count) and the standard times together
    # make the headline tiles; the page renders a "core" group first as tiles.
    total = groups.pop(GROUP_KEYS.index("total"), None)
    if total:
        core = groups.setdefault(GROUP_KEYS.index("core"), {"key": "core", "name": "", "items": []})
        core["items"] = total["items"] + core["items"]

    # Headline numbers first, then by aircraft, then everything else.
    order = ["core", "catclass", "icao", "model", "capabilities", "properties", "none"]
    out = {
        "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "MyFlightbook",
        "groups": sorted(groups.values(), key=lambda g: order.index(g["key"])),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=2) + "\n")
    n = sum(len(g["items"]) for g in out["groups"])
    print(f"Wrote {n} totals in {len(out['groups'])} groups to {args.out}")


def fetch_flights(args, page=100):
    flights, offset = [], 0
    while True:
        batch = call(args, "FlightsWithQueryAndOffset", fq="{}", offset=offset, maxCount=page)
        flights.extend(batch)
        if len(batch) < page:
            return flights
        offset += page


def download_image(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "mfb-sync (personal blog build)"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            if not r.headers.get("Content-Type", "").startswith("image/"):
                return False
            dest.write_bytes(r.read())
            return True
    except urllib.error.URLError as e:
        print(f"warning: couldn't fetch {url}: {e}", file=sys.stderr)
        return False


def cmd_aircraft(args):
    aircraft = {a["AircraftID"]: a for a in call(args, "AircraftForUser")}
    flights = fetch_flights(args)

    tails = {}
    for f in flights:
        a = aircraft.get(f.get("AircraftID"))
        if not a:
            continue
        t = tails.setdefault(a["AircraftID"], {
            "tail": a.get("TailNumber", ""),
            "model": a.get("ModelDescription", ""),
            "name": " ".join(a.get("ModelCommonName", "").split()),
            "hours": 0.0, "flights": 0, "landings": 0, "first": None, "last": None,
            "_images": a.get("AircraftImages") or [],
        })
        t["hours"] += float(f.get("TotalFlightTime", 0))
        t["flights"] += 1
        t["landings"] += int(f.get("Landings", 0))
        day = (f.get("Date") or "")[:10]
        if day:
            t["first"] = min(filter(None, [t["first"], day]))
            t["last"] = max(filter(None, [t["last"], day]))

    # Photos: an override if you've provided one, otherwise the first image
    # on the aircraft's MyFlightbook record. MyFlightbook photos are
    # re-downloaded only when that record's image changes.
    prev = {}
    if args.out.exists():
        prev = {a["tail"]: a.get("image_src") for a in json.loads(args.out.read_text()).get("aircraft", [])}
    overrides = {}
    if AIRCRAFT_IMG_OVERRIDES.is_dir():
        for f in sorted(AIRCRAFT_IMG_OVERRIDES.iterdir()):
            if f.suffix.lower() in OVERRIDE_EXTS:
                overrides.setdefault(f.stem.upper(), f)
    AIRCRAFT_IMG_AUTO.mkdir(parents=True, exist_ok=True)
    public = lambda f: f.relative_to(REPO_ROOT / "static").as_posix()

    for t in tails.values():
        imgs = t.pop("_images")
        t["image"] = t["image_src"] = t["credit"] = None

        if (ov := overrides.get(t["tail"].upper())):
            caption = ov.with_suffix(".txt")
            t["image"] = public(ov)
            t["credit"] = caption.read_text().strip() or None if caption.exists() else None
            continue

        if not imgs or not imgs[0].get("URLFullImage"):
            continue
        src = imgs[0]["URLFullImage"]
        dest = AIRCRAFT_IMG_AUTO / f"{t['tail']}.jpg"
        if (dest.exists() and prev.get(t["tail"]) == src) or download_image(MFB_SITE + src, dest):
            t["image"] = public(dest)
            t["image_src"] = src
            t["credit"] = MFB_PHOTO_CREDIT

    types = {}
    for t in tails.values():
        ty = types.setdefault(t["model"], {"model": t["model"], "names": [], "hours": 0.0, "flights": 0, "landings": 0, "tails": 0})
        if t["name"] and t["name"] not in ty["names"]:
            ty["names"].append(t["name"])
        ty["hours"] += t["hours"]
        ty["flights"] += t["flights"]
        ty["landings"] += t["landings"]
        ty["tails"] += 1

    by_hours = lambda x: (-x["hours"], -x["flights"])
    out_tails = sorted(tails.values(), key=by_hours)
    out_types = sorted(types.values(), key=by_hours)
    for row in out_tails + out_types:
        row["hours"] = round(row["hours"], 1)
        row["display"] = fmt(row["hours"], "time")
    out = {
        "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "MyFlightbook",
        "types": out_types,
        "aircraft": out_tails,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=2) + "\n")
    print(f"Wrote {len(out_tails)} aircraft in {len(out_types)} types from {len(flights)} flights to {args.out}")


def flight_record(f):
    """The publishable subset of one MyFlightbook flight."""
    model = " ".join((f.get("ModelDisplay") or "").split())
    rec = {
        "id": f["FlightID"],
        "date": (f.get("Date") or "")[:10],
        "tail": f.get("TailNumDisplay", ""),
        "model": model,
        "route": " ".join((f.get("Route") or "").split()),
        "stats": [],
    }
    for src, (key, label, kind) in FLIGHT_FIELDS.items():
        v = f.get(src, 0) or 0
        if v:
            rec["stats"].append({"key": key, "label": label, "kind": kind, "value": v, "display": fmt(float(v), kind)})
    return rec


def snapshot_flight(args, flight_id, flights=None, refresh=False):
    """Writes mfb-<id>.json and .gpx unless they already exist (or refresh)."""
    meta = FLIGHTS_DIR / f"mfb-{flight_id}.json"
    gpx = FLIGHTS_DIR / f"mfb-{flight_id}.gpx"
    if meta.exists() and not refresh:
        return False
    flights = flights if flights is not None else fetch_flights(args)
    f = next((x for x in flights if x.get("FlightID") == flight_id), None)
    if not f:
        die(f"flight {flight_id} isn't in your logbook (run `mfb_sync.py flights` to list IDs)")
    rec = flight_record(f)
    track = call(args, "FlightPathForFlightGPX", idFlight=flight_id)
    rec["telemetry"] = isinstance(track, str) and "<trkpt" in track
    FLIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    if rec["telemetry"]:
        gpx.write_text(track)
    elif gpx.exists():
        gpx.unlink()
    meta.write_text(json.dumps(rec, indent=2) + "\n")
    print(f"Saved flight {flight_id} ({rec['date']} {rec['tail']} {rec['route']}){'' if rec['telemetry'] else ', no telemetry'}")
    add_metar(flight_id)
    return True


def referenced_flights():
    """Flight IDs used as {{ flightlog(flight=...) }} anywhere in content/."""
    pat = re.compile(r"flightlog\([^)]*\bflight\s*=\s*\"?(\d+)")
    ids = set()
    for md in CONTENT_DIR.rglob("*.md"):
        ids.update(int(m) for m in pat.findall(md.read_text(errors="replace")))
    return sorted(ids)


# ---------- departure METAR ----------
#
# Historical METARs come from the Iowa Environmental Mesonet ASOS archive
# (free, no key; aviationweather.gov only keeps ~2 weeks). Takeoff time is the
# first track point above AIRBORNE_KT, matching the figure's "Airborne" span.

IEM_ASOS = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
AIRBORNE_KT = 40
METAR_MAX_AGE = timedelta(minutes=90)


def takeoff_time(gpx_text):
    """First moment the track's ~10 s-averaged groundspeed reaches AIRBORNE_KT."""
    pts = []
    for m in re.finditer(r'<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>(.*?)</trkpt>', gpx_text, re.S):
        t = re.search(r"<time>([^<]+)</time>", m.group(3))
        if t:
            ts = datetime.fromisoformat(t.group(1).replace("Z", "+00:00"))
            pts.append((ts, float(m.group(1)), float(m.group(2))))
    cum = [0.0]
    for (_, la1, lo1), (_, la2, lo2) in zip(pts, pts[1:]):
        r = math.radians
        h = math.sin(r(la2 - la1) / 2) ** 2 + math.cos(r(la1)) * math.cos(r(la2)) * math.sin(r(lo2 - lo1) / 2) ** 2
        cum.append(cum[-1] + 2 * 3440.065 * math.asin(min(1, math.sqrt(h))))
    j = 0
    for i, (t, _, _) in enumerate(pts):
        while j < len(pts) - 1 and (pts[j + 1][0] - t).total_seconds() <= 10:
            j += 1
        dt = (pts[j][0] - t).total_seconds() / 3600
        if dt > 0 and (cum[j] - cum[i]) / dt >= AIRBORNE_KT:
            return t
    return None


def departure_station(route):
    """First airport in a route like "GTU -> GTU" or "KGTU KILE", as an ICAO id."""
    m = re.match(r"\s*([A-Za-z0-9]{3,4})\b", route or "")
    if not m:
        return None
    code = m.group(1).upper()
    return "K" + code if len(code) == 3 and code.isalpha() else code


def metar_before(station, when):
    """Latest official METAR/SPECI for `station` issued at or before `when`."""
    iem_id = station[1:] if len(station) == 4 and station.startswith("K") else station
    lo, hi = when - timedelta(days=1), when + timedelta(days=1)
    q = urllib.parse.urlencode([
        ("station", iem_id), ("data", "metar"), ("tz", "Etc/UTC"), ("format", "onlycomma"),
        ("latlon", "no"), ("missing", "empty"), ("direct", "no"),
        ("year1", lo.year), ("month1", lo.month), ("day1", lo.day),
        ("year2", hi.year), ("month2", hi.month), ("day2", hi.day),
        ("report_type", 3), ("report_type", 4),
    ])
    req = urllib.request.Request(f"{IEM_ASOS}?{q}", headers={"User-Agent": "mfb-sync (personal blog build)"})
    # IEM rate-limits bursts (429); back off and retry. A lookup that still
    # fails raises, so the caller leaves the flight to be retried next sync
    # rather than recording "no METAR".
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                rows = list(csv.DictReader(io.StringIO(r.read().decode())))
            break
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 3:
                raise
            time.sleep(10 * (attempt + 1))
    best = None
    for row in rows:
        raw = (row.get("metar") or "").strip()
        if not raw or "MADISHF" in raw:  # IEM-derived high-frequency copies, not official reports
            continue
        t = datetime.strptime(row["valid"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        if t <= when and (best is None or t >= best[0]):
            best = (t, raw)
    if not best or when - best[0] > METAR_MAX_AGE:
        return None
    return {"station": station, "time": best[0].strftime("%Y-%m-%dT%H:%MZ"), "raw": best[1]}


def add_metar(flight_id):
    """Adds `metar` (or null) to a saved flight, using its saved track and route."""
    meta = FLIGHTS_DIR / f"mfb-{flight_id}.json"
    gpx = FLIGHTS_DIR / f"mfb-{flight_id}.gpx"
    rec = json.loads(meta.read_text())
    rec["metar"] = None
    station = departure_station(rec.get("route"))
    takeoff = takeoff_time(gpx.read_text()) if gpx.exists() else None
    if station and takeoff:
        rec["takeoff"] = takeoff.strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            rec["metar"] = metar_before(station, takeoff)
        except urllib.error.URLError as e:
            print(f"  warning: METAR lookup for {station} failed ({e}); will retry next sync", file=sys.stderr)
            return
    meta.write_text(json.dumps(rec, indent=2) + "\n")
    if rec["metar"]:
        print(f"  departure METAR: {rec['metar']['raw']}")
    else:
        print(f"  no departure METAR ({'no takeoff in track' if not takeoff else 'no airport in route' if not station else 'none found near takeoff'})")


def cmd_flight(args):
    flights = fetch_flights(args)
    for fid in args.ids:
        if not snapshot_flight(args, fid, flights, refresh=args.refresh):
            print(f"Flight {fid} already saved; pass --refresh to fetch it again")
            if "metar" not in json.loads((FLIGHTS_DIR / f"mfb-{fid}.json").read_text()):
                add_metar(fid)


def cmd_flights(args):
    for f in fetch_flights(args)[: args.limit]:
        print(f"{f['FlightID']:>10}  {f['Date'][:10]}  {f.get('TailNumDisplay', ''):<8} {float(f.get('TotalFlightTime', 0)):>4.1f}h  {' '.join((f.get('Route') or '').split())}")


def cmd_sync(args):
    args.out = args.totals_out
    cmd_totals(args)
    args.out = args.aircraft_out
    cmd_aircraft(args)
    referenced = referenced_flights()
    missing = [i for i in referenced if not (FLIGHTS_DIR / f"mfb-{i}.json").exists()]
    if missing:
        flights = fetch_flights(args)
        for fid in missing:
            snapshot_flight(args, fid, flights)
    # Older snapshots saved before METARs were added get one now.
    for fid in referenced:
        meta = FLIGHTS_DIR / f"mfb-{fid}.json"
        if meta.exists() and "metar" not in json.loads(meta.read_text()):
            print(f"Flight {fid}:")
            add_metar(fid)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--client-id")
    p.add_argument("--client-secret")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("auth", help="one-time browser sign-in")
    a.add_argument("--redirect-uri", default=DEFAULT_REDIRECT)
    a.add_argument("--scope", default=DEFAULT_SCOPE, help='space-separated, e.g. "totals readflight"')
    a.set_defaults(fn=cmd_auth)

    t = sub.add_parser("totals", help="fetch totals into the site's data dir")
    t.add_argument("--out", type=Path, default=TOTALS_OUT)
    t.set_defaults(fn=cmd_totals)

    ac = sub.add_parser("aircraft", help="fetch per-type and per-tail hours, plus aircraft photos")
    ac.add_argument("--out", type=Path, default=AIRCRAFT_OUT)
    ac.set_defaults(fn=cmd_aircraft)

    sy = sub.add_parser("sync", help="totals + aircraft (what CI runs)")
    sy.add_argument("--totals-out", type=Path, default=TOTALS_OUT)
    sy.add_argument("--aircraft-out", type=Path, default=AIRCRAFT_OUT)
    sy.set_defaults(fn=cmd_sync)

    fl = sub.add_parser("flight", help="snapshot flights for {{ flightlog(flight=ID) }}")
    fl.add_argument("ids", type=int, nargs="+")
    fl.add_argument("--refresh", action="store_true", help="re-fetch even if already saved")
    fl.set_defaults(fn=cmd_flight)

    ls = sub.add_parser("flights", help="list recent flights and their IDs")
    ls.add_argument("-n", "--limit", type=int, default=20)
    ls.set_defaults(fn=cmd_flights)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
