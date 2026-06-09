#!/usr/bin/env python3
"""Doing Business corroboration for the vendor alias map.

Pulls NYC's Doing Business "People" dataset (NYC Open Data 2sps-j9st), builds an
organization -> distinctive-principals index, and checks the hand-verified vendor
alias map against it.

PRIVACY / PUBLISH SAFETY (this is load-bearing, do not relax):
  * The committed output, data/doing-business-corroboration.json, contains ONLY
    organization-level results: per alias group, how many of its spellings appear
    in Doing Business, how many distinctive principals they share, and a status
    (corroborated / review / insufficient). It names NO individual and asserts NO
    cross-firm relationship. That is the only thing CI ever writes.
  * The candidate-merge discovery (which DOES surface individual names as evidence
    and pairs of firms) runs ONLY when DB_CANDIDATES=1 is set in the environment.
    CI never sets it. Run it locally for your own review; its output file
    (db-merge-candidates.txt) is git-ignored and must never be committed.

Counsel rule honored: corroborate, never auto-merge; keep the human-verified gate.

stdlib only (urllib + json + re). Mirrors the /vendors/ page normName() exactly.
"""

import json, os, re, sys, time
import urllib.request, urllib.error

PEOPLE_DS = "2sps-j9st"
HOST = "https://data.cityofnewyork.us/resource"
TOKEN = "3TAzQQPiSG2T4WGWfYYUxxqfJ"   # public read-only Socrata app token (site-wide)
PAGE = 50000
# A principal/owner key tied to more than this many distinct orgs is treated as
# non-distinctive (common name or serial board member) and ignored as a signal.
MAX_ORGS_PER_PRINCIPAL = 6

_TRAIL = re.compile(r"[.,;:&/\\'\"`\-\s]+$")

def norm_name(s):
    if s is None:
        s = ""
    s = s.strip()
    s = re.sub(r"\s+", " ", s)
    s = s.upper()
    s = _TRAIL.sub("", s)
    return s.strip()

def log(*a):
    print(*a, flush=True)

def get_json(ds, params):
    qs = "&".join("%s=%s" % (k, urllib.parse.quote(str(v))) for k, v in params.items())
    url = "%s/%s.json?%s" % (HOST, ds, qs)
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "ConcreteIndex/1.0 (+https://concreteindex.co)",
        "X-App-Token": TOKEN,
    })
    last = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            last = e
            log("  fetch attempt %d failed: %s" % (attempt + 1, e))
            time.sleep(3 * (attempt + 1))
    raise RuntimeError("fetch failed after retries: %s" % last)

def fetch_people():
    cols = "organization_name,person_name_first,person_name_middle,person_name_last,relationship_type_code"
    rows, off = [], 0
    while True:
        page = get_json(PEOPLE_DS, {
            "$select": cols, "$limit": PAGE, "$offset": off, "$order": "organization_name",
        })
        rows.extend(page)
        log("  pulled %d (total %d)" % (len(page), len(rows)))
        if len(page) < PAGE:
            break
        off += PAGE
        time.sleep(0.5)
        if off > 2_000_000:
            log("  WARNING paging cap hit"); break
    return rows

def principal_key(r):
    # A distinctive identity for one principal/owner. For entity-owner (EWN) rows
    # the "last" field holds an owning entity name, which is an equally valid
    # shared-owner signal; either way no individual is published from this.
    parts = [r.get("person_name_first", ""), r.get("person_name_middle", ""),
             r.get("person_name_last", "")]
    return norm_name(" ".join(p for p in parts if p))

def load_aliases():
    for p in ("site/data/vendor-aliases.json", "data/vendor-aliases.json"):
        if os.path.exists(p):
            with open(p) as f:
                return json.load(f), p
    raise SystemExit("vendor-aliases.json not found")

def build_index(rows):
    """rows -> (org_principals, principal_orgs, distinctive). Pure; unit-tested."""
    org_principals, principal_orgs = {}, {}
    for r in rows:
        org = norm_name(r.get("organization_name", ""))
        pk = principal_key(r)
        if not org or not pk:
            continue
        org_principals.setdefault(org, set()).add(pk)
        principal_orgs.setdefault(pk, set()).add(org)
    distinctive = {pk for pk, orgs in principal_orgs.items()
                   if len(orgs) <= MAX_ORGS_PER_PRINCIPAL}
    return org_principals, principal_orgs, distinctive

def corroborate(groups, org_principals, distinctive):
    """Per alias group: org-level corroboration status + counts. Names nothing."""
    results = []
    n_corrob = n_review = n_insuff = 0
    for g in groups:
        variant_norms = {norm_name(v) for v in g.get("variants", [])}
        matched = [o for o in variant_norms if o in org_principals]
        sets = [org_principals[o] & distinctive for o in matched]
        shared = set()
        for i in range(len(sets)):
            for j in range(i + 1, len(sets)):
                shared |= (sets[i] & sets[j])
        if len(matched) >= 2 and shared:
            status = "corroborated"; n_corrob += 1
        elif len(matched) >= 2 and not shared:
            status = "review"; n_review += 1
        else:
            status = "insufficient"; n_insuff += 1
        if matched:
            results.append({"parent": g["parent"], "dbdb_orgs_matched": len(matched),
                            "shared_principals": len(shared), "status": status})
    results.sort(key=lambda x: (x["status"] != "review", -x["shared_principals"], x["parent"]))
    return results, (n_corrob, n_review, n_insuff)

def main():
    groups, alias_path = load_aliases()
    log("Loaded %d alias groups from %s" % (len(groups), alias_path))

    log("Fetching Doing Business People (%s)..." % PEOPLE_DS)
    people = fetch_people()
    log("Total people rows: %d" % len(people))

    org_principals, principal_orgs, distinctive = build_index(people)
    log("orgs=%d principals=%d distinctive=%d"
        % (len(org_principals), len(principal_orgs), len(distinctive)))

    # ---- Corroborate the alias map (SAFE, committed output) ----
    results, (n_corrob, n_review, n_insuff) = corroborate(groups, org_principals, distinctive)
    out = {
        "meta": {
            "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "source": "NYC Doing Business Search - People (NYC Open Data 2sps-j9st)",
            "note": "Organization-level corroboration of the vendor alias map. No individuals are named. "
                    "corroborated = the group's spellings present in Doing Business share a distinctive principal; "
                    "review = present but share none (worth a human look); insufficient = fewer than two spellings present.",
            "people_rows": len(people),
            "alias_groups": len(groups),
            "groups_in_dbdb": len(results),
            "corroborated": n_corrob, "review": n_review, "insufficient_present": n_insuff,
        },
        "groups": results,
    }

    # Quality gate: keep the last good file on a thin pull rather than overwrite.
    if len(people) < 1000 or len(org_principals) < 100:
        log("WARNING: Doing Business pull looks partial (people=%d, orgs=%d). "
            "Keeping existing file, exiting without write." % (len(people), len(org_principals)))
        sys.exit(0)

    os.makedirs("data", exist_ok=True)
    with open("data/doing-business-corroboration.json", "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    log("Wrote data/doing-business-corroboration.json: corroborated=%d review=%d insufficient=%d"
        % (n_corrob, n_review, n_insuff))

    # ---- Candidate-merge discovery (LOCAL ONLY; names individuals; never in CI) ----
    if os.environ.get("DB_CANDIDATES") == "1":
        variant_to_parent = {}
        for g in groups:
            for v in g.get("variants", []):
                variant_to_parent[norm_name(v)] = g["parent"]
        lines = ["# Doing Business merge candidates (PRIVATE — do not commit)\n",
                 "# Org pairs sharing >= 2 distinctive principals, not already in the same alias group.\n"]
        seen = set()
        for pk, orgs in principal_orgs.items():
            if pk not in distinctive or len(orgs) < 2:
                continue
            orgl = sorted(orgs)
            for i in range(len(orgl)):
                for j in range(i + 1, len(orgl)):
                    a, b = orgl[i], orgl[j]
                    pa, pb = variant_to_parent.get(a), variant_to_parent.get(b)
                    if pa and pb and pa == pb:
                        continue  # already grouped together
                    common = sorted((org_principals[a] & org_principals[b]) & distinctive)
                    if len(common) >= 2 and (a, b) not in seen:
                        seen.add((a, b))
                        lines.append("%s  <->  %s   | shared: %s | parents: %s / %s\n"
                                     % (a, b, ", ".join(common), pa or "-", pb or "-"))
        with open("db-merge-candidates.txt", "w") as f:
            f.writelines(lines)
        log("Wrote db-merge-candidates.txt (%d candidate pairs) — LOCAL ONLY, do not commit"
            % (len(seen)))

if __name__ == "__main__":
    main()
