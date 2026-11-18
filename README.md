# Concrete and Reinforcement: a Teralo app

Track concrete and reinforcement on a [Teralo](https://teralo.co) project: what each material
costs, the budget, the delivery dockets as they come in, and what is still to come. From those it
works out the **forecast final cost** against budget, per material, per area and for the project,
with a chart, CSV exports and a card for the project dashboard.

Nothing in it is specific to concrete. A material is a name, a unit and a rate, so the same app
tracks precast panels, formwork hire or anything else bought by the unit. Copy it and change the
words.

Built with [`@teralo-co/apps`](https://github.com/teralo-co/teralo-app-sdk), using nothing an
outside author would not have.

## What it asks for

| Scope            | Why                                                                       |
| ---------------- | ------------------------------------------------------------------------- |
| `project:read`   | The project's currency, locale and time zone: money, dates and "today"    |
| `person:read`    | Who made each change, and whether they may change rates and budget        |
| `locations:read` | Budget and deliveries by area (level, pour), from the project's Locations |
| `database`       | Its own data on each project                                              |

It cannot reach the internet and cannot change anything in Teralo.

**Who may do what.** Anyone who can open the app enters deliveries and remaining estimates.
Materials, rates and budget need Teralo's "Apps: manage" on the project (`person.canManage`). The
server checks it on every change; the screens only hide what you cannot use.

## How the numbers work

- **Quantities** are kept in thousandths of the unit and **money** in cents, so no amount is ever
  a floating-point number. Money is in the project's currency, dates on the project's clock.
- **Rates** apply from a date. A material's first rate applies from the start. A delivery keeps
  the rate in force on its date when it was entered, whatever the rates do later.
- **Budget** is a quantity for the whole project, or split by area (not both). Its cost is fixed at
  the rate in force when it was saved.
- **Deliveries** of a material budgeted by area must name the area. For a material budgeted for
  the whole project the area is only a record of where it went.
- **Remaining** is the latest estimate, less whatever was delivered after the day it was made,
  never below zero. With no estimate it is budget less delivered, never below zero.
- **Forecast final cost** = delivered cost + remaining x today's rate. **Variance** = forecast less
  budget: above zero is over budget.

### Worked example

This is `test/forecast.test.js`, and the end-to-end check against a local Teralo got the same
figures. Today is 18 Nov 2026.

| Material        | Rate                                           | Budget                                               |
| --------------- | ---------------------------------------------- | ---------------------------------------------------- |
| 40 MPa concrete | $285.00/m3 from the start, $300.00 from 10 Nov | 100 m3, whole project, at $285 = $28,500.00          |
| N16 bar         | $1,850.00/t                                    | Level 2 10 t = $18,500.00; Level 3 12 t = $22,200.00 |

Deliveries: concrete 20.5 m3 on 3 Nov (at $285 = $5,842.50) and 30 m3 on 12 Nov (at $300 =
$9,000.00); N16 6.2 t to Level 2 on 4 Nov ($11,470.00) and 4 t to Level 3 on 5 Nov ($7,400.00).

Estimate: on 11 Nov, 40 m3 of concrete still to come.

- Concrete remaining = 40 - 30 (delivered after 11 Nov) = 10 m3, at today's $300 = $3,000.00.
  Forecast = 5,842.50 + 9,000.00 + 3,000.00 = **$17,842.50**, $10,657.50 under its $28,500.00.
- N16 Level 2 remaining = 10 - 6.2 = 3.8 t ($7,030.00): forecast $18,500.00, on budget.
  Level 3 remaining = 12 - 4 = 8 t ($14,800.00): forecast $22,200.00, on budget.
- Project: budget **$69,200.00**, delivered **$33,712.50**, forecast **$58,542.50**,
  **$10,657.50 under**.

## The code

```
teralo-app.json             manifest: id, version, scopes, card
migrations/0001_tracker.sql materials, rates, budget, deliveries, estimates, change log
server/forecast.js          the rules above, pure (tested)
server/index.js             the app's API: /summary, /materials, /rates, /budget, /deliveries,
                            /estimates, /history; every change logged in the same transaction
ui/index.html, app.js       the page and the dashboard card (app.js is the entry point)
screens/                    Overview (table, chart, CSV), Deliveries, Remaining, Setup, History,
                            the card, and lib.js (element builder, formats, saving)
test/forecast.test.js       npm test
```

Chart.js draws the chart; it is bundled into `app.js` by `teralo-app build`.

## Run it against a local Teralo

```sh
npm install
npm test
TERALO_PUBLISH_SECRET=<local key> npm run dev   # publishes a dev build to http://localhost:5173
```

The first time, install it as an organisation administrator in **Tool Settings > Apps** and switch
it on for a project; it is under **Apps** in that project, and its card is in the project
dashboard's Add widget list. After that, `npm run dev` moves the install to each new build: reload
to see it.

## Licence

MIT
