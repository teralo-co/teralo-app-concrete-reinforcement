// Materials, rates and budget. Only people who manage apps on the project see this screen; the
// server refuses everyone else whatever the screen shows.
import { toast } from '@teralo-co/apps/client';
import { confirmButton, empty, h, send } from './lib.js';

// Budget lines being edited, per material id, until saved.
const budgetDraft = new Map();

const field = (label, input) => h('label', { class: 'field' }, h('span', null, label), input);

function materials(app) {
	const { data, fmt } = app;
	const used = (id) =>
		data.budget.some((b) => b.material_id === id) ||
		data.deliveries.some((d) => d.material_id === id) ||
		data.estimates.some((e) => e.material_id === id);
	const rows = data.forecast.materials.map((m) => {
		const name = h('input', { value: m.name, maxLength: 80, 'aria-label': 'Name' });
		const unit = h('input', { value: m.unit, maxLength: 20, size: 6, 'aria-label': 'Unit' });
		const rates = data.rates
			.filter((r) => r.material_id === m.id)
			.map((r) => `${fmt.money(r.cents)} from ${fmt.date(r.from_date)}`)
			.join('; ');
		return h(
			'tr',
			null,
			h('td', null, name),
			h('td', null, unit),
			h('td', { class: 'num' }, fmt.money(m.rateCents)),
			h('td', null, h('small', null, rates)),
			h(
				'td',
				{ class: 'nowrap' },
				h(
					'button',
					{
						onclick: async () => {
							if (
								await send(`/materials/${m.id}`, 'PATCH', { name: name.value, unit: unit.value })
							) {
								toast('Saved', 'success');
								await app.refresh();
							}
						}
					},
					'Save'
				),
				used(m.id)
					? null
					: confirmButton('Remove', 'Remove it?', async () => {
							if (await send(`/materials/${m.id}`, 'DELETE')) await app.refresh();
						})
			)
		);
	});
	return h(
		'section',
		{ class: 'panel' },
		h('h2', null, 'Materials and rates'),
		rows.length
			? h(
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
								['Name', 'Unit', 'Rate now', 'Rates', ''].map((label, i) =>
									h('th', { scope: 'col', class: i === 2 ? 'num' : '' }, label)
								)
							)
						),
						h('tbody', null, rows)
					)
				)
			: empty(
					'No materials yet. Each bar size or mix is its own material, such as "N16 bar" in t or "40 MPa concrete" in m3.'
				),
		addMaterial(app),
		rows.length ? changeRate(app) : null
	);
}

function addMaterial(app) {
	const name = h('input', { maxLength: 80, required: true });
	const unit = h('input', { maxLength: 20, size: 6, required: true, placeholder: 'm3, t, sheet' });
	const rate = h('input', {
		type: 'number',
		min: '0',
		step: '0.01',
		inputMode: 'decimal',
		required: true
	});
	return actionForm(
		'Add',
		async () => {
			if (
				await send('/materials', 'POST', { name: name.value, unit: unit.value, rate: rate.value })
			) {
				toast(`${name.value.trim()} added`, 'success');
				await app.refresh();
			}
		},
		h('h3', null, 'Add a material'),
		field('Name', name),
		field('Unit', unit),
		field(`Rate per unit (${app.data.project.currency})`, rate)
	);
}

function changeRate(app) {
	const { data } = app;
	const material = h(
		'select',
		{ required: true },
		data.materials.map((m) => h('option', { value: String(m.id) }, m.name))
	);
	const rate = h('input', {
		type: 'number',
		min: '0',
		step: '0.01',
		inputMode: 'decimal',
		required: true
	});
	const from = h('input', { type: 'date', value: data.today });
	return actionForm(
		'Save rate',
		async () => {
			const saved = await send('/rates', 'POST', {
				materialId: Number(material.value),
				rate: rate.value,
				from: from.value
			});
			if (saved) {
				toast('Rate saved', 'success');
				await app.refresh();
			}
		},
		h('h3', null, 'Change a rate'),
		h(
			'p',
			{ class: 'muted' },
			'Deliveries keep the rate they were entered at. Leave the date empty to set the rate from the start.'
		),
		field('Material', material),
		field(`New rate (${data.project.currency})`, rate),
		field('Applies from', from)
	);
}

/**
 * A form whose button does the work. Teralo sandboxes an app's frame without allow-forms, so the
 * browser drops a form's submission before its submit event fires: the button checks the fields
 * and runs the action itself, and Enter in a field presses it.
 */
function actionForm(label, run, ...children) {
	const button = h('button', { type: 'button', class: 'primary' }, label);
	const form = h(
		'form',
		{
			class: 'inline',
			onkeydown: (event) => {
				if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
					event.preventDefault();
					button.click();
				}
			}
		},
		...children,
		button
	);
	button.addEventListener('click', async () => {
		if (button.disabled || !form.reportValidity()) return;
		button.disabled = true;
		try {
			await run();
		} finally {
			button.disabled = false;
		}
	});
	return form;
}

function budgetEditor(app, m) {
	const { data, fmt } = app;
	if (!budgetDraft.has(m.id)) {
		budgetDraft.set(
			m.id,
			data.budget
				.filter((b) => b.material_id === m.id)
				.map((b) => ({ locationId: b.location_id, qty: String(b.qty_milli / 1000) }))
		);
	}
	const lines = budgetDraft.get(m.id);
	const body = h('tbody');
	const draw = () =>
		body.replaceChildren(
			...lines.map((line, i) => {
				const area = h(
					'select',
					{
						'aria-label': `${m.name} line ${i + 1} area`,
						onchange: (event) => (line.locationId = event.target.value)
					},
					h('option', { value: '' }, 'Whole project'),
					app.locations.map((l) => h('option', { value: l.id }, l.name))
				);
				area.value = line.locationId;
				return h(
					'tr',
					null,
					h('td', null, area),
					h(
						'td',
						{ class: 'qty' },
						h('input', {
							type: 'number',
							min: '0',
							step: 'any',
							inputMode: 'decimal',
							value: line.qty,
							'aria-label': `${m.name} line ${i + 1} quantity`,
							oninput: (event) => (line.qty = event.target.value)
						}),
						h('span', { class: 'unit' }, m.unit)
					),
					h(
						'td',
						null,
						h(
							'button',
							{
								class: 'link',
								onclick: () => {
									lines.splice(i, 1);
									draw();
								}
							},
							'Remove'
						)
					)
				);
			})
		);
	draw();
	const set = data.budget.filter((b) => b.material_id === m.id);
	return h(
		'div',
		{ class: 'budget' },
		h('h3', null, m.name),
		set.length
			? h(
					'p',
					{ class: 'muted' },
					`Now ${fmt.qty(m.budgetQty, m.unit)}, ${fmt.money(m.budgetCost)}` +
						(set.length > 1 || set[0].location_id
							? ` across ${set.length} ${set.length === 1 ? 'area' : 'areas'}`
							: ' for the whole project') +
						'.'
				)
			: h('p', { class: 'muted' }, 'No budget yet.'),
		h('table', { class: 'entry' }, body),
		h(
			'p',
			{ class: 'actions' },
			data.locations.length
				? h(
						'button',
						{
							onclick: () => {
								lines.push({ locationId: '', qty: '' });
								draw();
							}
						},
						'Add a line'
					)
				: lines.length === 0
					? h(
							'button',
							{
								onclick: () => {
									lines.push({ locationId: '', qty: '' });
									draw();
								}
							},
							'Add the quantity'
						)
					: null,
			h(
				'button',
				{
					class: 'primary',
					onclick: async () => {
						if (await send(`/budget/${m.id}`, 'PUT', { lines })) {
							budgetDraft.delete(m.id);
							toast(
								`Budget for ${m.name} saved at ${fmt.money(m.rateCents)} per ${m.unit}`,
								'success'
							);
							await app.refresh();
						}
					}
				},
				'Save budget'
			)
		)
	);
}

function budget(app) {
	const { data } = app;
	if (data.materials.length === 0) return null;
	return h(
		'section',
		{ class: 'panel' },
		h('h2', null, 'Budget'),
		h(
			'p',
			{ class: 'muted' },
			'A quantity for the whole project, or split by area. Budget cost is the quantity at the rate in force when you save it.'
		),
		data.forecast.materials.map((m) => budgetEditor(app, m))
	);
}

export default function setup(app) {
	if (!app.data.person.canManage) {
		return h(
			'section',
			null,
			h('h1', null, 'Setup'),
			empty('Only people who manage apps on this project can change materials, rates and budget.')
		);
	}
	return h('section', null, h('h1', null, 'Setup'), materials(app), budget(app));
}
