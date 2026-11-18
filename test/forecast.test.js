import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	costOf,
	forecast,
	isDate,
	parseMoney,
	parseQuantity,
	rateOn,
	todayIn
} from '../server/forecast.js';

const CONCRETE = 1;
const N16 = 2;
const L2 = 'loc-level-2';
const L3 = 'loc-level-3';

// The worked example in the README, worked by hand there.
const project = {
	materials: [
		{ id: CONCRETE, name: '40 MPa concrete', unit: 'm3' },
		{ id: N16, name: 'N16 bar', unit: 't' }
	],
	rates: [
		{ material_id: CONCRETE, cents: 28500, from_date: '' },
		{ material_id: CONCRETE, cents: 30000, from_date: '2026-11-10' },
		{ material_id: N16, cents: 185000, from_date: '' }
	],
	budget: [
		{ material_id: CONCRETE, location_id: '', qty_milli: 100000, cost_cents: 2850000 },
		{ material_id: N16, location_id: L2, qty_milli: 10000, cost_cents: 1850000 },
		{ material_id: N16, location_id: L3, qty_milli: 12000, cost_cents: 2220000 }
	],
	deliveries: [
		{
			date: '2026-11-03',
			material_id: CONCRETE,
			location_id: '',
			qty_milli: 20500,
			cost_cents: 584250
		},
		// Names an area, but concrete is budgeted for the whole project: forecast as one.
		{
			date: '2026-11-12',
			material_id: CONCRETE,
			location_id: L2,
			qty_milli: 30000,
			cost_cents: 900000
		},
		{ date: '2026-11-04', material_id: N16, location_id: L2, qty_milli: 6200, cost_cents: 1147000 },
		{ date: '2026-11-05', material_id: N16, location_id: L3, qty_milli: 4000, cost_cents: 740000 }
	],
	estimates: [{ material_id: CONCRETE, location_id: '', qty_milli: 40000, as_of: '2026-11-11' }],
	today: '2026-11-18'
};

test('parses quantities to thousandths and money to cents, refusing anything else', () => {
	assert.equal(parseQuantity('12.5'), 12500);
	assert.equal(parseQuantity(' 0.001 '), 1);
	assert.equal(parseMoney('285.50'), 28550);
	assert.equal(parseMoney('19.99'), 1999);
	for (const bad of ['', '  ', '-1', 'abc', '1e10', null, undefined, 'Infinity']) {
		assert.equal(parseQuantity(bad), null, String(bad));
	}
});

test('reads dates and today on the project clock', () => {
	assert.ok(isDate('2026-11-18'));
	assert.ok(!isDate('2026-02-30'));
	assert.ok(!isDate('2026-1-1'));
	const evening = new Date('2026-11-18T14:00:00Z');
	assert.equal(todayIn('Australia/Sydney', evening), '2026-11-19');
	assert.equal(todayIn('America/New_York', evening), '2026-11-18');
});

test('a rate applies from its date; the first rate covers everything before', () => {
	assert.equal(rateOn(project.rates, CONCRETE, '2020-01-01'), 28500);
	assert.equal(rateOn(project.rates, CONCRETE, '2026-11-09'), 28500);
	assert.equal(rateOn(project.rates, CONCRETE, '2026-11-10'), 30000);
	assert.equal(rateOn(project.rates, 99, '2026-11-10'), null);
	assert.equal(costOf(20500, 28500), 584250);
	assert.equal(costOf(1, 1), 0);
});

test('forecasts the worked example to the cent', () => {
	const result = forecast(project);
	const [concrete, n16] = result.materials;

	// Concrete: estimated 40 m3 to come on 11 Nov, 30 m3 delivered since, so 10 m3 at today's $300.
	assert.equal(concrete.byArea, false);
	assert.equal(concrete.areas.length, 1);
	assert.equal(concrete.remainingQty, 10000);
	assert.equal(concrete.areas[0].deliveredSinceEstimate, 30000);
	assert.equal(concrete.forecastCost, 584250 + 900000 + 300000);
	assert.equal(concrete.variance, 1784250 - 2850000);

	// N16 by area, no estimates: remaining is budget less delivered in each area.
	assert.equal(n16.byArea, true);
	assert.deepEqual(
		n16.areas.map((a) => [a.locationId, a.remainingQty, a.suggested, a.forecastCost]),
		[
			[L2, 3800, true, 1850000],
			[L3, 8000, true, 2220000]
		]
	);
	assert.equal(n16.variance, 0);

	assert.equal(result.budgetCost, 6920000);
	assert.equal(result.deliveredCost, 3371250);
	assert.equal(result.forecastCost, 5854250);
	assert.equal(result.variance, -1065750);
});

test('remaining never goes below zero, so over-delivery shows as over budget', () => {
	const result = forecast({
		...project,
		deliveries: [
			...project.deliveries,
			{ date: '2026-11-15', material_id: N16, location_id: L2, qty_milli: 5000, cost_cents: 925000 }
		],
		estimates: [{ material_id: CONCRETE, location_id: '', qty_milli: 10000, as_of: '2026-11-01' }]
	});
	const [concrete, n16] = result.materials;
	assert.equal(concrete.remainingQty, 0); // 10 m3 estimated, 50.5 m3 delivered since
	const level2 = n16.areas.find((a) => a.locationId === L2);
	assert.equal(level2.remainingQty, 0);
	assert.equal(level2.forecastCost, 1147000 + 925000);
	assert.equal(level2.variance, 222000);
});

test('a delivery to an area with no budget line is its own over-budget row', () => {
	const result = forecast({
		...project,
		deliveries: [
			{
				date: '2026-11-15',
				material_id: N16,
				location_id: 'loc-roof',
				qty_milli: 1000,
				cost_cents: 185000
			}
		],
		estimates: []
	});
	const roof = result.materials[1].areas.find((a) => a.locationId === 'loc-roof');
	assert.deepEqual([roof.budgetCost, roof.forecastCost, roof.variance], [0, 185000, 185000]);
});
