# The Concrete Index

**NYC public construction capital, tracked end to end.**

Live at **[concreteindex.co](https://concreteindex.co)**

The Concrete Index tracks the demand side of New York City public construction: where capital money is coming from, how fast it moves, and which agencies drive it. It is built entirely on public data and refreshes itself from the public record, live in the browser for most sources and nightly for the one a browser cannot reach.

## The three-stage funnel

| Stage | What it measures | Source |
|---|---|---|
| **[Pipeline](https://concreteindex.co/pipeline/)** | Capital dollars committed to projects but not yet spent (forward demand) | NYC OMB Capital Projects Dashboard ([`fb86-vt7u`](https://data.cityofnewyork.us/City-Government/Capital-Projects-Dashboard-Citywide-Budget-and-Sch/fb86-vt7u)), published 3×/year |
| **[Awarded](https://concreteindex.co)** | Construction contract awards entering the market | City Record Recent Contract Awards ([`qyyg-4tf5`](https://data.cityofnewyork.us/City-Government/Recent-Contract-Awards/qyyg-4tf5)), updated daily |
| **[Funnel](https://concreteindex.co/funnel/)** | All three stages plus velocity: spending pace and backlog coverage | Both sources; spending measured as growth in cumulative spend-to-date between plan snapshots |

The **[Briefing](https://concreteindex.co/briefing/)** page composes a written "state of NYC construction demand" from the live data on every load.

## The differentiator

The Concrete Index measures the *flow between* ledgers: how much funded work is stacked upstream and how fast it converts to awards and cash. **Backlog coverage**, unspent committed dollars divided by trailing-year spending, is the demand-side counterpart to a contractor's backlog ratio.

## Architecture

Each page is a self-contained static HTML file that queries the Socrata APIs (`data.cityofnewyork.us`, `data.ny.gov`) directly from the browser, and most figures are recomputed from the live public record on every load. No backend and no database. The one source a browser cannot reach, Checkbook NYC (which blocks cross-origin requests and returns a paged XML feed), is fetched and normalized nightly by a scheduled GitHub Action that writes a compact static file the site reads. Hosted on GitHub Pages.

A vendor lookup groups each contractor's name and joint-venture spellings into one parent total through a hand-verified, address-corroborated alias map (deterministic record linkage, not fuzzy matching), and shows award-notice value alongside Checkbook's registered and paid figures as three separate measures.

Data treatment highlights (full definitions on each page's methodology section):

- Sub-project rows in the capital plan are collapsed to one record per project (by agency + FMS ID, keeping the most advanced phase) so no dollar is double-counted.
- Spending per period is the growth in each project's cumulative spend-to-date between consecutive plan snapshots, floored at zero, a conservative treatment.
- Borough on the Awarded page is derived from award title and description text and disclosed as such; the capital plan carries structured geography.

## Author

Built by Salar Jalinous · [salar.jalinous@gmail.com](mailto:salar.jalinous@gmail.com)
