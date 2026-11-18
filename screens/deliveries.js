// A day's dockets in one go, then the deliveries already entered.
import { toast } from '@teralo-co/apps/client';
import { areaName, confirmButton, empty, h, send } from './lib.js';

const BLANK_ROWS = 5;
const SHOWN = 100;

// The rows being typed survive Teralo re-rendering the screen (a theme change, Back).
let draft = null;
const blank = (date) => ({ date, materialId: '', locationId: '', qty: '', docket: '', note: '' });
const isBlank = (row) => !row.materialId && !row.qty && !row.docket && !row.note;

function entryRow(app, row, i) {
	const { data } = app;
	const set = (field) => (event) => {
		row[field] = event.target.value;
	};
	const byArea = () =>
		data.forecast.materials.find((m) => m.id === Number(row.materialId))?.byArea ?? false;
	const unit = h('span', { class: 'unit' });
	const anyArea = h('option', { value: '' });
	const area = h(
		'select',
		{ 'aria-label': `Row ${i + 1} area`, onchange: set('locationId') },
		anyArea,
		app.locations.map((l) => h('option', { value: l.id }, l.name))
	);
	area.value = row.locationId;
	// Materials budgeted by area need one; for the rest the area is only a record of where it went.
	const fit = () => {
		const material = data.materials.find((m) => m.id === Number(row.materialId));
		unit.textContent = material?.unit ?? '';
		area.required = byArea();
		anyArea.textContent = byArea() ? 'Choose the area' : '-';
	};
	const material = h(
		'select',
		{
			'aria-label': `Row ${i + 1} material`,
			onchange: (event) => {
				row.materialId = event.target.value;
				fit();
			}
		},
		h('option', { value: '' }, 'Choose'),
		data.materials.map((m) => h('option', { value: String(m.id) }, m.name))
	);
	material.value = row.materialId;
	fit();
	return h(
		'tr',
		null,
		h(
			'td',
			null,
			h('input', {
				type: 'date',
				value: row.date,
				max: data.today,
				'aria-label': `Row ${i + 1} date`,
				onchange: set('date')
			})
		),
		h('td', null, material),
		data.locations.length ? h('td', null, area) : null,
		h(
			'td',
			{ class: 'qty' },
			h('input', {
				type: 'number',
				min: '0',
				step: 'any',
				inputMode: 'decimal',
				value: row.qty,
				'aria-label': `Row ${i + 1} quantity`,
				oninput: set('qty')
			}),
			unit
		),
		h(
			'td',
			null,
			h('input', {
				value: row.docket,
				maxLength: 50,
				'aria-label': `Row ${i + 1} docket`,
				oninput: set('docket')
			})
		),
		h(
			'td',
			null,
			h('input', {
				value: row.note,
				maxLength: 500,
				'aria-label': `Row ${i + 1} note`,
				oninput: set('note')
			})
		)
	);
}

function entry(app) {
	const { data } = app;
	draft ??= Array.from({ length: BLANK_ROWS }, () => blank(data.today));
	const body = h('tbody');
	const draw = () => body.replaceChildren(...draft.map((row, i) => entryRow(app, row, i)));
	draw();

	const save = h(
		'button',
		{
			class: 'primary',
			onclick: async () => {
				const rows = draft.filter((row) => !isBlank(row));
				if (rows.length === 0) return toast('Nothing to save yet', 'info');
				// Drop the blank rows first, so "Row 3" in a refusal is the third row on screen.
				draft = [
					...rows,
					...Array.from({ length: Math.max(0, BLANK_ROWS - rows.length) }, () =>
						blank(rows.at(-1).date)
					)
				];
				draw();
				save.disabled = true;
				const saved = await send('/deliveries', 'POST', {
					rows: rows.map((row) => ({ ...row, materialId: Number(row.materialId) }))
				});
				save.disabled = false;
				if (!saved) return;
				toast(`${rows.length} ${rows.length === 1 ? 'delivery' : 'deliveries'} saved`, 'success');
				draft = Array.from({ length: BLANK_ROWS }, () => blank(rows.at(-1).date));
				await app.refresh();
			}
		},
		'Save deliveries'
	);
	const more = h(
		'button',
		{
			onclick: () => {
				const date = draft.at(-1)?.date ?? data.today;
				draft.push(...Array.from({ length: BLANK_ROWS }, () => blank(date)));
				draw();
			}
		},
		'More rows'
	);
	const headings = [
		'Date',
		'Material',
		data.locations.length ? 'Area' : null,
		'Quantity',
		'Docket',
		'Note'
	];
	return h(
		'section',
		{ class: 'panel' },
		h('h2', null, 'Enter deliveries'),
		h(
			'div',
			{ class: 'scroll' },
			h(
				'table',
				{ class: 'entry' },
				h(
					'thead',
					null,
					h(
						'tr',
						null,
						headings.filter(Boolean).map((label) => h('th', { scope: 'col' }, label))
					)
				),
				body
			)
		),
		h('p', { class: 'actions' }, save, more)
	);
}

function list(app) {
	const { data, fmt } = app;
	const materials = new Map(data.materials.map((m) => [m.id, m]));
	const latest = data.deliveries.slice(-SHOWN).reverse();
	if (latest.length === 0) return empty('No deliveries entered yet.');
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
					['Date', 'Material', 'Area', 'Quantity', 'Rate', 'Cost', 'Docket', 'Note', ''].map(
						(label, i) =>
							h('th', { scope: 'col', class: [3, 4, 5].includes(i) ? 'num' : '' }, label)
					)
				)
			),
			h(
				'tbody',
				null,
				latest.map((d) => {
					const m = materials.get(d.material_id);
					return h(
						'tr',
						null,
						h('td', null, fmt.date(d.date)),
						h('td', null, m.name),
						h('td', null, areaName(app, d.location_id, '')),
						h('td', { class: 'num' }, fmt.qty(d.qty_milli, m.unit)),
						h('td', { class: 'num' }, fmt.money(d.rate_cents)),
						h('td', { class: 'num' }, fmt.money(d.cost_cents)),
						h('td', null, d.docket),
						h('td', null, d.note),
						h(
							'td',
							null,
							confirmButton('Remove', 'Remove it?', async () => {
								if (await send(`/deliveries/${d.id}`, 'DELETE')) {
									toast('Delivery removed', 'success');
									await app.refresh();
								}
							})
						)
					);
				})
			)
		),
		data.deliveries.length > SHOWN
			? h(
					'p',
					{ class: 'muted' },
					`The latest ${SHOWN}. Export deliveries on the Overview for all of them.`
				)
			: null
	);
}

export default function deliveries(app) {
	if (app.data.materials.length === 0) {
		return h(
			'section',
			null,
			h('h1', null, 'Deliveries'),
			empty('Deliveries can be entered once the materials are set up.')
		);
	}
	return h(
		'section',
		null,
		h('h1', null, 'Deliveries'),
		entry(app),
		h('h2', null, 'Entered'),
		list(app)
	);
}
