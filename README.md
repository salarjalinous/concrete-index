# The Concrete Index

**NYC public construction capital, from commitment to cash.**

[concreteindex.co](https://concreteindex.co)

The Concrete Index tracks the demand side of New York City public construction: where capital money is committed, how fast it reaches contractors, and how fast it turns into cash. It is built entirely on public data. Most pages query NYC Open Data and Open NY from the browser when they load; payment data, cost series, and long histories come from nightly jobs that write same-origin files under `data/`.

## Four ledgers

| Ledger | What it measures | Source | Page |
| --- | --- | --- | --- |
| Committed | Unspent budget on active capital projects, one record per agency and FMS ID | NYC OMB Capital Projects Dashboard ([`fb86-vt7u`](https://data.cityofnewyork.us/City-Government/Capital-Projects-Dashboard-Citywide-Budget-and-Sch/fb86-vt7u)), published three times a year | [Pipeline](https://concreteindex.co/pipeline/) |
| Awarded | Construction award notices, deduplicated to one record per PIN | City Record Recent Contract Awards ([`qyyg-4tf5`](https://data.cityofnewyork.us/City-Government/Recent-Contract-Awards/qyyg-4tf5)), published daily | [Awarded](https://concreteindex.co/awarded/) |
| Registered | Current amounts of registered construction expense contracts | Checkbook NYC, Office of the NYC Comptroller | [Contracts](https://concreteindex.co/contracts/) |
| Paid | Cumulative paid to date on those same contracts | Checkbook NYC | [Funnel](https://concreteindex.co/funnel/) |

The ledgers come from three publishers with different scopes and windows. No key joins Committed to Awarded, so the site never sums the four or draws one as a share of another. Every dataset, with its ID, publisher, cadence, and license, is listed at [/sources/](https://concreteindex.co/sources/).

## Pages

Pipeline, Bidding, Awarded, Contracts, Funnel, Agencies, Contractors, Regional, Analysis, Briefing, plus Methodology, About, Privacy, Terms, and Sources. Routes: `/pipeline/`, `/bidding/`, `/awarded/`, `/contracts/`, `/funnel/`, `/agencies/`, `/contractors/`, `/regional/`, `/analysis/`, `/briefing/`, `/methodology/`, `/about/`, `/privacy/`, `/terms/`, `/sources/`. The retired addresses `/solicitations/`, `/competitive/`, `/agency/`, `/vendors/`, and `/velocity/` forward to their new pages with the query and hash kept. Most data pages end with their own "Methodology & definitions" section; [/methodology/](https://concreteindex.co/methodology/) collects them word for word, with a dated log of methodology changes.

## What it computes

- **Backlog coverage:** unspent committed dollars divided by trailing-year capital spending, in years. A market-level ratio, the demand-side counterpart to a contractor's backlog; it is not any firm's backlog.
- **The Concrete Index:** a geometric blend of trailing-twelve-month new-award value and count, renewals and awards of $500M and above excluded, 2019 = 100. A cost-adjusted version deflates award value by a 60/40 blend of two BLS series.
- **Payment velocity:** first-payment lag and days to half paid on registered construction contracts of $500,000 or more registered since 2019 that are open or closed within the past year, from dated Checkbook NYC disbursements.

Treatments, disclosed on each page:

- Capital-plan sub-project rows collapse to one record per project (agency plus FMS ID, most advanced phase kept), so no budget is counted twice.
- Spending per period is the growth in cumulative spend-to-date between consecutive plan snapshots, on a matched panel of projects observed in both, floored at zero.
- Trailing twelve months is twelve fully-elapsed months; the partial month in progress is never read.
- Borough on award notices is derived from title and description text and labeled as such; the capital plan carries a structured borough field.
- Contractor name variants roll up through a hand-verified alias map, corroborated at the organization level against the Doing Business Database. No individual is named.

## Architecture

Static HTML served by GitHub Pages from the repository root. Shared CSS and JavaScript under `/assets/`; no inline script or style; per-page Content Security Policy. No backend, no database, no cookies, no analytics.

Nightly workflows in `.github/workflows/`:

| Workflow | Writes |
| --- | --- |
| `archive.yml` | `awards.json`, `solicitations.json`, `plan-latest.json`, `cost-index.json` (BLS), `precomputed.json`, `plan-history.json` |
| `checkbook.yml` | `checkbook-vendors.json`, `flow.json` |
| `doing-business.yml` | `doing-business-corroboration.json` (organization-level only) |
| `payments.yml` | `contract-search.json`, `contract-index.json`, `contract-detail/*.json`, `contract-aggregates.json` |

Every Socrata pull in these jobs is paged and checked against the source's own row count, and the job stops rather than saving a partial file. `test.yml` runs the methodology and builder tests (`node --test`) on pull requests and code pushes, read-only.

The git history of `data/` is a dated archive of each source.

See [SECURITY.md](SECURITY.md) for data flows, the CSP, and how to report a vulnerability.

## Working on the site

- `npm ci`, then `node tools/vendor.mjs` copies Chart.js 4.4.1 into `/assets/vendor` (versions pinned in `package-lock.json`). `node tools/vendor.mjs --fonts` also recopies the fonts; follow it with `tools/subset-fonts.sh` to keep them inside the 110 KB budget.
- The shared `<head>`, masthead, rail, footer, line art, and the redirect stubs at retired routes are generated by `node tools/stamp.mjs` between `<!-- ci:… -->` markers. Titles, descriptions, routes, and CSP types live in that script; edit it, not the stamped blocks.
- `node tools/check.mjs` must exit 0 before a deploy: no inline script or style, no `style=` or `on*=` attributes, no em dashes, no third-party subresources, per-page CSP matching the hosts each page fetches, spacing only from `tokens.css`, fonts within budget.
- `STRICT_PAGES=1 node --test test/methodology.test.js test/builders.test.js` runs the methodology rules against the page modules in `/assets/pages/` and the nightly builders against archived data. `node tools/test-fmt.mjs` proves `ci.fmt` reproduces every page formatter.

## Corrections

Open an issue at [github.com/salarjalinous/concrete-index/issues](https://github.com/salarjalinous/concrete-index/issues) with the page, the figure, and the source record.

## Author

Built by Salar Jalinous. An independent personal project, not affiliated with the City or State of New York or any employer.
