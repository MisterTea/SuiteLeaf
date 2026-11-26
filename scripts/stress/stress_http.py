#!/usr/bin/env python3
"""HTTP stress against several real node containers on one Postgres with a
fake blob bridge (see run-http-stress.sh). Stdlib only. Prints a report and
exits non-zero if an invariant fails."""
import json, os, random, subprocess, sys, threading, time, urllib.error, urllib.request

BASES = os.environ["STRESS_BASES"].split(",")
BOOT = os.environ["STRESS_BOOTSTRAP"]
PG = os.environ["STRESS_PG_CONTAINER"]
BLOBS = os.environ["STRESS_BLOB_DIR"]
SECONDS = int(os.environ.get("STRESS_SECONDS", "40"))
WORKERS = int(os.environ.get("STRESS_WORKERS", "24"))
MIX = os.environ.get("STRESS_MIX", "mixed")  # "mixed" or "items" (saves+comments only)
PW = "stress-password-" + "x" * 16
failures = []
lock = threading.Lock()

def call(method, path, body=None, token=None, headers=None, base=None, raw=False):
    h = {}
    if body is not None and not isinstance(body, bytes):
        h["content-type"] = "application/json"
        body = json.dumps(body).encode()
    if token:
        h["authorization"] = "Bearer " + token
    h.update(headers or {})
    req = urllib.request.Request((base or random.choice(BASES)) + path, method=method, headers=h, data=body)
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            return r.status, (data if raw else (json.loads(data) if data else None)), time.time() - t
    except urllib.error.HTTPError as e:
        e.read()
        return e.code, None, time.time() - t
    except Exception as e:  # connection errors count as failures
        return 0, str(e), time.time() - t

def check(ok, msg):
    if not ok:
        failures.append(msg)
    print(("PASS " if ok else "FAIL ") + msg, flush=True)

def pct(xs, p):
    xs = sorted(xs)
    return xs[round((len(xs) - 1) * p)] if xs else 0

def line(label, lat, wall):
    return f"{label}: n={len(lat)} {len(lat)/wall:.0f}/s p50={pct(lat,.5)*1e3:.0f}ms p99={pct(lat,.99)*1e3:.0f}ms max={pct(lat,1)*1e3:.0f}ms"

def psql(sql):
    out = subprocess.run(["docker", "exec", PG, "psql", "-U", "postgres", "-d", "stress", "-tAc", sql],
                         capture_output=True, text=True, check=True).stdout
    return out.strip()

def burst(n, fn):
    out, barrier = [], threading.Barrier(n)
    def run(i):
        barrier.wait()
        r = fn(i)
        with lock:
            out.append(r)
    ts = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    [t.start() for t in ts]; [t.join() for t in ts]
    return out

report = []
# 1. First-admin burst across all instances.
res = burst(12, lambda i: call("POST", "/api/auth/sign-up/email",
    {"name": f"F{i}", "email": f"founder{i}@example.com", "password": PW},
    headers={"x-suiteleaf-invite": BOOT}, base=BASES[i % len(BASES)]))
wins = [r for r in res if r[0] == 200]
check(len(wins) == 1, f"12 concurrent bootstrap sign-ups -> {len(wins)} winner (statuses {sorted(r[0] for r in res)})")
admin_email = wins[0][1]["user"]["email"]
admin_id = wins[0][1]["user"]["id"]
signin = lambda email: call("POST", "/api/auth/sign-in/email", {"email": email, "password": PW})
A = signin(admin_email)[1]["token"]

def invite(email):
    s, b, _ = call("POST", "/api/admin/invitations", {"email": email}, A)
    assert s == 200, s
    return b["url"].split("invite=")[1]

# 2. One invite, 12 concurrent redemptions.
tok = invite("second@example.com")
res = burst(12, lambda i: call("POST", "/api/auth/sign-up/email",
    {"name": f"S{i}", "email": "second@example.com", "password": PW},
    headers={"x-suiteleaf-invite": tok}, base=BASES[i % len(BASES)]))
wins = [r for r in res if r[0] == 200]
check(len(wins) == 1, f"12 concurrent redemptions of one invite -> {len(wins)} winner")
second_id = wins[0][1]["user"]["id"]
B = signin("second@example.com")[1]["token"]

# 3. Last-admin races: two admins demote each other at once.
admins = lambda: int(psql("SELECT count(*) FROM \"user\" WHERE role LIKE '%admin%'"))
for rnd in range(5):
    s, _, _ = call("POST", f"/api/admin/users/{second_id}/role", {"role": "admin"}, A)
    if s != 200:  # A was the one demoted last round; B restores A instead
        call("POST", f"/api/admin/users/{admin_id}/role", {"role": "admin"}, B)
    check(admins() == 2, f"round {rnd}: two admins before the race")
    res = burst(2, lambda i: call("POST", f"/api/admin/users/{[second_id, admin_id][i]}/role", {"role": "user"}, [A, B][i], base=BASES[i % len(BASES)]))
    ok = [r for r in res if r[0] == 200]
    check(len(ok) == 1 and admins() == 1, f"round {rnd}: mutual demotion -> {len(ok)} succeeded, {admins()} admin left (statuses {sorted(r[0] for r in res)})")
# Make sure A is admin for the rest.
call("POST", f"/api/admin/users/{admin_id}/role", {"role": "admin"}, B)
A = signin(admin_email)[1]["token"]

# 4. Mixed workload + sign-in sampler.
PAYLOADS = [b"shared payload one " * 200, b"shared payload two " * 300, b"three" * 1000, b"four " * 50]
folders = []
for i in range(6):
    s, b, _ = call("POST", "/api/drive/items", {"name": f"folder-{i}", "kind": "folder"}, A)
    folders.append(b["id"])
files, heads, known = [], {}, set(PAYLOADS)
for i in range(48):  # starting files so the items mix has targets
    s, b, _ = call("POST", "/api/drive/items", {"name": f"seed-{i}.txt", "kind": "file", "parentId": folders[i % 6]}, A)
    files.append(b["id"])
stats, lat = {}, {}
stop = time.time() + SECONDS

def record(op, status, d):
    with lock:
        stats.setdefault(op, {}).setdefault(status, 0)
        stats[op][status] += 1
        lat.setdefault(op, []).append(d)

def worker(w):
    rnd = random.Random(w)
    while time.time() < stop:
        op = rnd.choices(["create", "save", "stale", "comment", "rename", "move", "fmove", "trash", "acl"],
                         [10, 30, 5, 12, 8, 8, 4, 5, 5] if MIX == "mixed" else [0, 60, 5, 35, 0, 0, 0, 0, 0])[0]
        with lock:
            pool = list(files)
        if op == "create" or not pool:
            parent = rnd.choice(folders + [None])
            s, b, d = call("POST", "/api/drive/items", {"name": f"f-{w}-{rnd.random():.6f}.txt", "kind": "file", "parentId": parent}, A)
            record("create", s, d)
            if s == 201:
                with lock:
                    files.append(b["id"])
            continue
        fid = rnd.choice(pool)
        if op in ("save", "stale"):
            payload = rnd.choice(PAYLOADS) if rnd.random() < .8 else os.urandom(16).hex().encode() * 64
            with lock:
                known.add(payload)
            head = heads.get(fid)
            hdr = {"content-type": "text/plain", "if-match": f'"{head or "*"}"'}
            s, b, d = call("PUT", f"/api/drive/items/{fid}/content", payload, A, hdr)
            record("save", s, d)
            if s == 200 and b:
                old = head
                heads[fid] = b.get("headVersionId")
                if op == "stale" and old and old != heads[fid]:
                    s2, _, d2 = call("PUT", f"/api/drive/items/{fid}/content", payload, A,
                                     {"content-type": "text/plain", "if-match": f'"{old}"'})
                    record("stale-if-match(expect 409)", s2, d2)
            elif s == 409:
                s3, b3, _ = call("GET", f"/api/drive/items/{fid}", token=A)
                if s3 == 200:
                    heads[fid] = b3.get("headVersionId")
        elif op == "comment":
            s, _, d = call("POST", f"/api/drive/items/{fid}/comments", {"body": "stress", "anchor": None}, A)
            record("comment", s, d)
        elif op == "rename":
            s, _, d = call("PATCH", f"/api/drive/items/{fid}", {"name": f"r-{rnd.random():.6f}.txt"}, A)
            record("rename", s, d)
        elif op == "move":
            s, _, d = call("PATCH", f"/api/drive/items/{fid}", {"parentId": rnd.choice(folders + [None])}, A)
            record("move", s, d)
        elif op == "fmove":  # folder into folder: cycles must be refused
            a, b2 = rnd.sample(folders, 2)
            s, _, d = call("PATCH", f"/api/drive/items/{a}", {"parentId": b2}, A)
            record("folder-move", s, d)
        elif op == "trash":
            s, _, d = call("PATCH", f"/api/drive/items/{fid}", {"trashed": True}, A)
            record("trash", s, d)
            if s == 200:
                s, _, d = call("DELETE", f"/api/drive/items/{fid}", token=A)
                record("delete-forever", s, d)
                if s == 204:
                    with lock:
                        if fid in files:
                            files.remove(fid)
        elif op == "acl":
            s, _, d = call("PUT", f"/api/drive/items/{fid}/acl", {"principalType": "user", "principalId": second_id, "role": "viewer"}, A)
            record("acl", s, d)

signins, sessions = [], []
def sampler():
    # Better Auth rate-limits sign-in to 3 per 10s per client IP on each
    # instance, so sample sign-in round-robin under that limit.
    n = 0
    while time.time() < stop:
        s, _, d = call("POST", "/api/auth/sign-in/email", {"email": admin_email, "password": PW}, base=BASES[n % len(BASES)])
        with lock:
            signins.append((s, d))
        n += 1
        time.sleep(4.0 / len(BASES))
def session_sampler():
    while time.time() < stop:
        s, _, d = call("GET", "/api/auth/get-session", token=A)
        with lock:
            sessions.append((s, d))
        time.sleep(0.05)

begin = time.time()
ts = [threading.Thread(target=worker, args=(w,)) for w in range(WORKERS)] + [threading.Thread(target=sampler), threading.Thread(target=session_sampler)]
[t.start() for t in ts]; [t.join() for t in ts]
wall = time.time() - begin
allops = [d for v in lat.values() for d in v]
report.append(line(f"{MIX} workload ({WORKERS} workers, {len(BASES)} instances)", allops, wall))
for op in sorted(lat):
    report.append("  " + line(op, lat[op], wall) + f" statuses={stats[op]}")
report.append(line("sign-in during mixed load", [d for _, d in signins], wall) + f" statuses={sorted(set(s for s, _ in signins))}")
report.append(line("get-session during mixed load", [d for _, d in sessions], wall) + f" statuses={sorted(set(s for s, _ in sessions))}")
codes = {}
for v in stats.values():
    for k, n in v.items():
        codes[k] = codes.get(k, 0) + n
check(codes.get(503, 0) == 0 and not any(k >= 500 or k == 0 for k in codes), f"no 5xx/connection errors in mixed load (status totals {codes})")
stale = stats.get("stale-if-match(expect 409)", {})
check(set(stale) <= {409, 404}, f"stale If-Match saves are 409 (404 only if deleted meanwhile) ({stale})")
# 429 is Better Auth's own per-IP rate limiter (one load-generator IP); the
# request still crossed the node proxy, so its latency still counts.
for name, xs in (("sign-in", signins), ("get-session", sessions)):
    limited = sum(1 for s, _ in xs if s == 429)
    check(all(s in (200, 429) for s, _ in xs) and any(s == 200 for s, _ in xs),
          f"{name} under load: {len(xs) - limited} x 200, {limited} x 429 (rate limiter), nothing else")
    check(pct([d for _, d in xs], .99) < 1.0, f"{name} p99 under write load < 1s")

# 5. Invariants.
orphans = int(psql('SELECT count(*) FROM drive_item c WHERE c."parentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM drive_item p WHERE p.id=c."parentId")'))
check(orphans == 0, f"no orphaned items ({orphans})")
cyc = int(psql('WITH RECURSIVE up(start, id, depth) AS (SELECT id, "parentId", 1 FROM drive_item WHERE "parentId" IS NOT NULL '
               'UNION ALL SELECT up.start, p."parentId", depth+1 FROM up JOIN drive_item p ON p.id=up.id WHERE p."parentId" IS NOT NULL AND depth < 50) '
               'SELECT count(DISTINCT start) FROM up WHERE id=start OR depth>=50'))
check(cyc == 0, f"no cycles in the folder tree ({cyc})")
hashes = [h for h in psql('SELECT v."contentHash" FROM drive_version v JOIN drive_item i ON i.id=v."itemId"').split("\n") if h]
missing = [h for h in hashes if not os.path.exists(os.path.join(BLOBS, h))]
check(not missing, f"every live version's manifest blob exists ({len(hashes)} versions, {len(missing)} missing)")
deleted = sum(1 for _ in open(os.path.join(BLOBS, "_deletes.log"))) if os.path.exists(os.path.join(BLOBS, "_deletes.log")) else 0
live = [x for x in psql('SELECT id FROM drive_item WHERE kind=\'file\' AND "headVersionId" IS NOT NULL').split("\n") if x]
bad = []
for fid in live:
    s, b, _ = call("GET", f"/api/drive/items/{fid}/content", token=A, raw=True)
    if s != 200 or b not in known:
        bad.append((fid, s))
check(not bad, f"every live file reads back intact after GC ({len(live)} files, {deleted} blobs garbage-collected, bad={bad[:3]})")
print("REPORT\n  " + "\n  ".join(report))
print(f"RESULT: {len(failures)} failed checks" + ("".join("\n  FAIL " + f for f in failures)))
sys.exit(1 if failures else 0)
