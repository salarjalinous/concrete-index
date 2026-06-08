# The Concrete Index

**NYC public construction capital, from commitment to cash.**

Live at **[concreteindex.co](https://concreteindex.co)**

The Concrete Index tracks the demand side of New York City public construction — where capital money is coming from, how fast it moves, and which agencies drive it. It is built entirely on the City's public record and recomputes every figure live on each page load.

## The three-stage funnel

| Stage | What it measures | Source |
|---|---|---|
| **[Pipeline](https://concreteindex.co/pipeline/)** | Capital dollars committed to projects but not yet spent — forward demand | NYC OMB Capital Projects Dashboard ([`fb86-vt7u`](https://data.cityofnewyork.us/City-Government/Capital-Projects-Dashboard-Citywide-Budget-and-Sch/fb86-vt7u)), published 3×/year |
| **[Awarded](https://concreteindex.co)** | Construction contract awards entering the market | City Record Recent Contract Awards ([`qyyg-4tf5`](https://data.cityofnewyork.us/City-Government/Recent-Contract-Awards/qyyg-4tf5)), updated daily |
| **[Funnel](https://concreteindex.co/funnel/)** | All three stages plus velocity: spending pace and backlog coverage | Both sources; spending measured as growth in cumulative spend-to-date between plan snapshots |

The **[Briefing](https://concreteindex.co/briefing/)** page composes a written "state of NYC construction demand" from the live data on every load.

## The differentiator

Most public tools show one ledger at a time. The Concrete Index measures the *flow between* them: how much funded work is stacked upstream, how fast it converts to awards and cash, and which agencies move money fast or slow. **Backlog coverage** — unspent committed dollars divided by trailing-year spending — is the demand-side counterpart to a contractor's backlog ratio.

## Architecture

Each page is a self-contained static HTML file that queries the Socrata API (`data.cityofnewyork.us`) directly from the browser. No backend, no database, no scheduled jobs — the site is self-refreshing because the figures are recomputed from the live public record on every load. Hosted on GitHub Pages.

Data treatment highlights (full definitions on each page's methodology section):

- Sub-project rows in the capital plan are collapsed to one record per project (by agency + FMS ID, keeping the most advanced phase) so no dollar is double-counted.
- Spending per period is the growth in each project's cumulative spend-to-date between consecutive plan snapshots, floored at zero — a conservative treatment.
- Borough on the Awarded page is derived from award title and description text and disclosed as such; the capital plan carries structured geography.

## Author

Built by Salar Jalinous · [salar.jalinous@gmail.com](mailto:salar.jalinous@gmail.com)
