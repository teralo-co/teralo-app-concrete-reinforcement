// The forecast: totals, the table per material and area, the chart, and the CSV exports.
import { saveFile } from '@teralo-co/apps/client';
import {
	Chart,
	Legend,
	LinearScale,
	LineController,
	LineElement,
	PointElement,
	Tooltip
} from 'chart.js';
import { areaName, csv, empty, h } from './lib.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend);

let chart = null;
let chosen = null;

const tile = (label, value, tone) =>
	h('div', { class: 'tile' }, h('p', null, label), h('strong', { class: tone ?? '' }, value));

const tone = (variance) => (variance > 0 ? 'over' : variance < 0 ? 'under' : '');

function remainingCell(app, row, unit) {
	const { fmt } = app;
	const how =
		row.how ??
		(row.suggested
			? 'budget less delivered'
			: `estimated ${fmt.date(row.estimatedOn)}` +
				(row.deliveredSinceEstimate
					? `, less ${fmt.qty(row.deliveredSinceEstimate, unit)} since`
					: ''));
	return h('td', { class: 'num' }, fmt.qty(row.remainingQty, unit), h('small', null, how));
}

/** A material budgeted for the whole project is its one area; with nothing yet, all zero. */
const whole = (m) => m.areas[0] ?? { ...m, suggested: true };

function table(app) {
	const { fmt } = app;
	const line = (row, unit, first, cls) =>
		h(
			'tr',
			{ class: cls },
			first,
			h('td', { class: 'num' }, fmt.qty(row.budgetQty, unit)),
			h('td', { class: 'num' }, fmt.qty(row.deliveredQty, unit)),
			remainingCell(app, row, unit),
			h('td', { class: 'num' }, fmt.money(row.budgetCost)),
			h('td', { class: 'num' }, fmt.money(row.deliveredCost)),
			h('td', { class: 'num' }, fmt.money(row.forecastCost)),
			h('td', { class: `num ${tone(row.variance)}` }, fmt.variance(row.variance))
		);
	const f = app.data.forecast;
	const body = f.materials.flatMap((m) => {
		const rows = [
			line(
				m.byArea ? { ...m, how: 'total of the areas' } : whole(m),
				m.unit,
				h(
					'th',
					{ scope: 'row' },
					m.name,
					h('small', null, `${fmt.money(m.rateCents)} per ${m.unit} now`)
				),
				'material'
			)
		];
		if (m.byArea) {
			for (const area of m.areas) {
				rows.push(
					line(
						area,
						m.unit,
						h('td', { class: 'area' }, areaName(app, area.locationId, 'No area')),
						'area'
					)
				);
			}
		}
		return rows;
	});
	return h(
		'div',
		{ class: 'scroll' },
		h(
			'table',
			null,
			h(
				'thead',
				null,
				h(
					'tr',
					null,
					[
						'Material',
						'Budget',
						'Delivered',
						'Remaining',
						'Budget cost',
						'Delivered cost',
						'Forecast final cost',
						'Variance'
					].map((label, i) => h('th', { scope: 'col', class: i ? 'num' : '' }, label))
				)
			),
			h('tbody', null, body),
			h(
				'tfoot',
				null,
				h(
					'tr',
					null,
					h('th', { scope: 'row', colSpan: 4 }, 'Project'),
					h('td', { class: 'num' }, fmt.money(f.budgetCost)),
					h('td', { class: 'num' }, fmt.money(f.deliveredCost)),
					h('td', { class: 'num' }, fmt.money(f.forecastCost)),
					h('td', { class: `num ${tone(f.variance)}` }, fmt.variance(f.variance))
				)
			)
		)
	);
}

function chartPanel(app) {
	const { data, fmt } = app;
	if (!data.materials.some((m) => m.id === chosen)) chosen = data.materials[0].id;
	const holder = h('div', { class: 'chart' });
	const day = (ms) => new Date(ms).toISOString().slice(0, 10);

	const draw = () => {
		chart?.destroy();
		chart = null;
		const material = data.forecast.materials.find((m) => m.id === chosen);
		const points = [];
		let total = 0;
		for (const d of data.deliveries) {
			if (d.material_id !== chosen) continue;
			total += d.qty_milli;
			const x = Date.parse(`${d.date}T00:00:00Z`);
			if (points.at(-1)?.x === x) points.at(-1).y = total / 1000;
			else points.push({ x, y: total / 1000 });
		}
		if (points.length === 0) {
			holder.replaceChildren(empty(`No deliveries of ${material.name} yet.`));
			return;
		}
		const canvas = h('canvas', {
			role: 'img',
			'aria-label': `${material.name}: delivered over time against budget and forecast`
		});
		holder.replaceChildren(canvas);
		const start = points[0].x;
		const end = Math.max(points.at(-1).x, Date.parse(`${data.today}T00:00:00Z`));
		const level = (milli) => [
			{ x: start, y: milli / 1000 },
			{ x: end, y: milli / 1000 }
		];
		const css = getComputedStyle(document.documentElement);
		const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
		const text = token('--muted-foreground', 'gray');
		const grid = token('--border', 'lightgray');
		chart = new Chart(canvas, {
			type: 'line',
			data: {
				datasets: [
					{
						label: 'Delivered',
						data: points,
						stepped: true,
						borderColor: token('--chart-1', 'steelblue'),
						backgroundColor: token('--chart-1', 'steelblue'),
						pointRadius: 2
					},
					{
						label: 'Budget',
						data: level(material.budgetQty),
						borderColor: token('--chart-2', 'gray'),
						borderDash: [6, 4],
						pointRadius: 0
					},
					{
						label: 'Forecast',
						data: level(material.deliveredQty + material.remainingQty),
						borderColor: token('--chart-3', 'orange'),
						borderDash: [2, 3],
						pointRadius: 0
					}
				]
			},
			options: {
				animation: false,
				maintainAspectRatio: false,
				scales: {
					x: {
						type: 'linear',
						min: start,
						max: end,
						ticks: { color: text, maxTicksLimit: 6, callback: (value) => fmt.date(day(value)) },
						grid: { color: grid }
					},
					y: {
						beginAtZero: true,
						ticks: { color: text },
						grid: { color: grid },
						title: { display: true, text: material.unit, color: text }
					}
				},
				plugins: {
					legend: { labels: { color: text } },
					tooltip: {
						callbacks: {
							title: (items) => fmt.date(day(items[0].parsed.x)),
							label: (item) =>
								`${item.dataset.label}: ${fmt.qty(Math.round(item.parsed.y * 1000), material.unit)}`
						}
					}
				}
			}
		});
	};

	const select = h(
		'select',
		{
			'aria-label': 'Material to chart',
			onchange: (event) => {
				chosen = Number(event.target.value);
				draw();
			}
		},
		data.materials.map((m) => h('option', { value: String(m.id) }, m.name))
	);
	select.value = String(chosen);
	// Chart.js measures its canvas, so draw once the screen is on the page.
	requestAnimationFrame(draw);
	return h(
		'section',
		{ class: 'panel' },
		h('div', { class: 'panel-head' }, h('h2', null, 'Delivered against budget'), select),
		holder
	);
}

function exportSummary(app) {
	const { data } = app;
	const rows = [
		[
			'Material',
			'Area',
			'Unit',
			'Budget quantity',
			'Budget cost',
			'Delivered quantity',
			'Delivered cost',
			'Remaining quantity',
			'Remaining from',
			'Rate now',
			'Forecast final cost',
			'Variance'
		]
	];
	const add = (m, row, area) =>
		rows.push([
			m.name,
			area,
			m.unit,
			row.budgetQty / 1000,
			row.budgetCost / 100,
			row.deliveredQty / 1000,
			row.deliveredCost / 100,
			row.remainingQty / 1000,
			row.how ?? (row.suggested ? 'budget less delivered' : `estimate of ${row.estimatedOn}`),
			m.rateCents / 100,
			row.forecastCost / 100,
			row.variance / 100
		]);
	for (const m of data.forecast.materials) {
		if (!m.byArea) {
			add(m, whole(m), 'Whole project');
			continue;
		}
		add(m, { ...m, how: 'total of the areas' }, 'All areas');
		for (const area of m.areas) add(m, area, areaName(app, area.locationId, 'No area'));
	}
	saveFile(`materials-forecast-${data.today}.csv`, csv(rows));
}

function exportDeliveries(app) {
	const { data } = app;
	const materials = new Map(data.materials.map((m) => [m.id, m]));
	const rows = [['Date', 'Material', 'Unit', 'Area', 'Quantity', 'Rate', 'Cost', 'Docket', 'Note']];
	for (const d of data.deliveries) {
		const m = materials.get(d.material_id);
		rows.push([
			d.date,
			m.name,
			m.unit,
			areaName(app, d.location_id, ''),
			d.qty_milli / 1000,
			d.rate_cents / 100,
			d.cost_cents / 100,
			d.docket,
			d.note
		]);
	}
	saveFile(`deliveries-${data.today}.csv`, csv(rows));
}

export default function overview(app) {
	const { data, fmt } = app;
	const f = data.forecast;
	if (data.materials.length === 0) {
		return h(
			'section',
			null,
			h('h1', null, 'Overview'),
			empty(
				data.person.canManage
					? 'No materials yet. Add them, their rates and the budget in Setup.'
					: 'No materials yet. Someone who manages apps on this project sets them up.'
			)
		);
	}
	return h(
		'section',
		null,
		h('h1', null, 'Overview'),
		h(
			'div',
			{ class: 'tiles' },
			tile('Budget', fmt.money(f.budgetCost)),
			tile('Delivered to date', fmt.money(f.deliveredCost)),
			tile('Forecast final cost', fmt.money(f.forecastCost)),
			tile('Variance', fmt.variance(f.variance), tone(f.variance))
		),
		table(app),
		chartPanel(app),
		h(
			'p',
			{ class: 'actions' },
			h('button', { onclick: () => exportSummary(app) }, 'Export forecast (CSV)'),
			h('button', { onclick: () => exportDeliveries(app) }, 'Export deliveries (CSV)')
		)
	);
}
