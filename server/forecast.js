// The tracker's rules, kept pure so `npm test` can check them against hand calculations.
// Quantities are integer thousandths of the material's unit (12.5 m3 is 12500) and money is
// integer hundredths of the project's currency (cents), so no money is ever a float.

const MAX_QUANTITY = 1e9;
const MAX_MONEY = 1e9;

function parseNumber(value, max, scale) {
	const text = String(value ?? '').trim();
	const number = Number(text);
	if (text === '' || !Number.isFinite(number) || number < 0 || number > max) return null;
	return Math.round(number * scale);
}

/** '12.5' -> 12500 (thousandths). Null unless it is a number from 0 to a billion. */
export const parseQuantity = (value) => parseNumber(value, MAX_QUANTITY, 1000);

/** '285.50' -> 28550 (cents). Null unless it is an amount from 0 to a billion. */
export const parseMoney = (value) => parseNumber(value, MAX_MONEY, 100);

/** What a quantity costs at a rate per unit, to the nearest cent. */
export const costOf = (quantity, rateCents) => Math.round((quantity * rateCents) / 1000);

/** A real calendar date written YYYY-MM-DD. */
export function isDate(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	return new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

/** Today on the project's clock, YYYY-MM-DD, whatever the server's own zone. */
export function todayIn(timeZone, now = new Date()) {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(now);
}

/**
 * The rate per unit in force on `date`: the latest one that applies from that date or before. A
 * material's first rate applies from '' (from the start), so it covers every earlier date.
 */
export function rateOn(rates, materialId, date) {
	let found = null;
	for (const rate of rates) {
		if (rate.material_id !== materialId || rate.from_date > date) continue;
		if (!found || rate.from_date > found.from_date) found = rate;
	}
	return found ? found.cents : null;
}

/** A material is budgeted by area once any budget line for it names a location. */
export const isByArea = (budget, materialId) =>
	budget.some((line) => line.material_id === materialId && line.location_id !== '');

/**
 * Budget, delivered, remaining and forecast final cost, per material and area, and for the
 * project. A material budgeted by area is forecast per area; one budgeted for the whole project
 * is forecast as one, whatever area its deliveries name (they say where it went, nothing more).
 *
 * Remaining is the latest estimate less what has been delivered since the day it was made,
 * never below zero; with no estimate it is budget less delivered, never below zero, and marked
 * `suggested`. Forecast = what was delivered, each delivery at the rate it was entered at, plus
 * remaining at today's rate. Variance = forecast less budget: above zero is over budget.
 */
export function forecast({ materials, rates, budget, deliveries, estimates, today }) {
	const results = materials.map((material) => {
		const byArea = isByArea(budget, material.id);
		const groups = new Map();
		const group = (locationId) => {
			const key = byArea ? locationId : '';
			if (!groups.has(key)) {
				groups.set(key, {
					locationId: key,
					budgetQty: 0,
					budgetCost: 0,
					deliveredQty: 0,
					deliveredCost: 0,
					estimate: null,
					deliveries: []
				});
			}
			return groups.get(key);
		};

		for (const line of budget) {
			if (line.material_id !== material.id) continue;
			const g = group(line.location_id);
			g.budgetQty += line.qty_milli;
			g.budgetCost += line.cost_cents;
		}
		for (const delivery of deliveries) {
			if (delivery.material_id !== material.id) continue;
			const g = group(delivery.location_id);
			g.deliveredQty += delivery.qty_milli;
			g.deliveredCost += delivery.cost_cents;
			g.deliveries.push(delivery);
		}
		for (const estimate of estimates) {
			if (estimate.material_id !== material.id) continue;
			const g = group(estimate.location_id);
			if (!g.estimate || estimate.as_of > g.estimate.as_of) g.estimate = estimate;
		}

		const rateCents = rateOn(rates, material.id, today) ?? 0;
		const areas = [...groups.values()].map((g) => {
			let remainingQty;
			let deliveredSinceEstimate = 0;
			if (g.estimate) {
				// An estimate is what was still to come at the end of the day it was made.
				for (const d of g.deliveries) {
					if (d.date > g.estimate.as_of) deliveredSinceEstimate += d.qty_milli;
				}
				remainingQty = Math.max(0, g.estimate.qty_milli - deliveredSinceEstimate);
			} else {
				remainingQty = Math.max(0, g.budgetQty - g.deliveredQty);
			}
			const forecastCost = g.deliveredCost + costOf(remainingQty, rateCents);
			return {
				locationId: g.locationId,
				budgetQty: g.budgetQty,
				budgetCost: g.budgetCost,
				deliveredQty: g.deliveredQty,
				deliveredCost: g.deliveredCost,
				remainingQty,
				suggested: g.estimate === null,
				estimatedOn: g.estimate ? g.estimate.as_of : null,
				deliveredSinceEstimate,
				forecastCost,
				variance: forecastCost - g.budgetCost
			};
		});

		const sum = (field) => areas.reduce((total, area) => total + area[field], 0);
		return {
			id: material.id,
			name: material.name,
			unit: material.unit,
			rateCents,
			byArea,
			areas,
			budgetQty: sum('budgetQty'),
			budgetCost: sum('budgetCost'),
			deliveredQty: sum('deliveredQty'),
			deliveredCost: sum('deliveredCost'),
			remainingQty: sum('remainingQty'),
			forecastCost: sum('forecastCost'),
			variance: sum('variance')
		};
	});

	const total = (field) => results.reduce((sum, material) => sum + material[field], 0);
	return {
		materials: results,
		budgetCost: total('budgetCost'),
		deliveredCost: total('deliveredCost'),
		forecastCost: total('forecastCost'),
		variance: total('variance')
	};
}
