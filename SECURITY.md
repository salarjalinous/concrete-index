# Security and privacy

Last reviewed: November 20, 2026

The Concrete Index (concreteindex.co) is static HTML served by GitHub Pages from the repository root. There is no backend, no database, no account system, no cookies, no analytics, and no browser storage written by site code.

## Reporting a vulnerability

Open a security advisory on the repository (Security tab, "Report a vulnerability") so the report stays private until a fix ships. For anything that is not sensitive, use the [issues page](https://github.com/salarjalinous/concrete-index/issues). No email address is published.

## What a visitor's browser sends

| Recipient | Pages | What it receives |
| --- | --- | --- |
| GitHub Pages (concreteindex.co) | Every page | IP address, requested path, user agent. GitHub logs visitor IP addresses for security purposes, signed in or not, under the [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). GitHub publishes no Pages-specific retention period. |
| data.cityofnewyork.us (NYC Open Data, Socrata) | Home, Pipeline, Bidding, Awarded, Funnel, Agencies, Contractors, Regional, Analysis, Briefing | IP address, user agent, the SoQL query the page sends |
| data.ny.gov (Open NY, Socrata) | Regional; Contractors on a firm lookup (MTA and State section) | IP address, user agent, the SoQL query the page sends |

Contracts and the editorial pages (Methodology, About, Privacy, Terms, Sources, 404, redirect stubs) contact no host other than this site. Fonts (Source Serif 4, Public Sans, IBM Plex Mono, OFL) and Chart.js are served same-origin; Google Fonts, cdnjs, and Unsplash are no longer contacted.

### User input

The site does take user input, and some of it leaves the browser:

- **Contractors search.** The typed name is quote-escaped and placed in a SoQL `$where` clause sent as a GET request to data.cityofnewyork.us and, for the MTA and State section, data.ny.gov. The operator of both portals (Tyler Technologies, which runs Socrata) can log the term with the visitor's IP address and user agent. The network call happens only on an explicit submit or selection; typing alone sends nothing. The page writes the submitted term to its own address (`?q=`) so a lookup can be bookmarked or shared; it is never written to storage, and under the same-origin referrer policy that address is not sent to the data APIs.
- **Contracts search.** Filters a same-origin file (`/data/contract-search.json`) inside the browser. Nothing is sent.
- **Filters, toggles, sort controls.** Change the query parameters a page sends to the data APIs on Bidding, Awarded, Agencies, and Contractors; they carry no free text.

The privacy notice at [/privacy/](https://concreteindex.co/privacy/) states the same flows for visitors.

## Content Security Policy

Delivered as a `<meta http-equiv="Content-Security-Policy">` tag, identical within each page type. The `'unsafe-inline'` limitation is **resolved** as of November 20, 2026: no page carries an inline script, inline style, `style=` attribute, or `on*=` handler, and the post-build check fails the build if one appears. Per-page strings:

Editorial and static pages (About, Methodology, Privacy, Terms, Sources, 404, redirect stubs):

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; upgrade-insecure-requests
```

NYC data pages (Home, Pipeline, Bidding, Awarded, Funnel, Agencies, Analysis, Briefing): the same string with

```
connect-src 'self' https://data.cityofnewyork.us
```

Regional and Contractors:

```
connect-src 'self' https://data.cityofnewyork.us https://data.ny.gov
```

Contracts keeps `connect-src 'self'`.

GitHub Pages cannot send response headers, so `frame-ancestors`, `report-uri`, and `Permissions-Policy` are unavailable. A meta CSP cannot set `frame-ancestors`; the site can be framed by another origin.

## Referrer policy

`<meta name="referrer" content="same-origin">` on every page. Requests to the data APIs and outbound dataset links carry no `Referer` header.

## Third-party code

| Dependency | Version | How it is served | Integrity |
| --- | --- | --- | --- |
| Chart.js | 4.4.1 | Same-origin, chart pages only | Pinned by `package-lock.json` integrity; installed with `npm ci` only |
| Source Serif 4, Public Sans, IBM Plex Mono | per lockfile | Same-origin WOFF2 (latin range, re-subset by `tools/subset-fonts.sh`), license files shipped alongside | Pinned by `package-lock.json` integrity |

No other third-party script, stylesheet, font, or image is loaded.

## Scheduled jobs and secrets

Four scheduled GitHub Actions write public data into `data/` and push to `main`: `archive.yml`, `checkbook.yml`, `doing-business.yml`, and `payments.yml`. They share one concurrency group (`main-data-push`, cancel-in-progress off) and rebase before each push. A fifth workflow, `test.yml`, runs the test suite on pull requests and code pushes with `contents: read` and writes nothing. GitHub Pages serves the committed files directly; there is no build step on the server.

- The data jobs use the default `GITHUB_TOKEN` with `contents: write`.
- `BLS_API_KEY` is optional; the archive job uses it only if present.
- The Socrata app token embedded in page code is a public, read-only throttling token, not a secret.
- The Doing Business job commits only organization-level corroboration results. Its name-bearing candidate discovery runs only when `DB_CANDIDATES=1` is set locally and its output file is git-ignored; CI never sets the flag.

## Contractors page

Contractor groupings come from a hand-verified alias map (`data/vendor-aliases.json`). No individual is named on the site. Data-built values reach the DOM through `textContent` or an escaping helper and travel in `data-*` attributes, never as inline handler code.
