// What is still to come, per material (and area, for a material budgeted by area).
import { toast } from '@teralo-co/apps/client';
import { areaName, empty, h, send } from './lib.js';

// Typed figures survive a re-render; keyed "materialId|locationId".
const typed = new Map();
let asOf = null;

export default function remaining(app) {
	const { data, fmt } = app;
	if (data.materials.length === 0) {
		return h(
			'section',
			null,
			h('h1', null, 'Remaining'),
			empty('Estimates can be entered once the materials are set up.')
		);
	}
	asOf ??= data.today;
	const rows = data.forecast.materials.flatMap((m) =>
		(m.areas.length ? m.areas : [{ ...m, locationId: '', suggested: true }]).map((area) => {
			const key = `${m.id}|${area.locationId}`;
			const now = area.suggested
				? 'suggested: budget less delivered'
				: `estimated ${fmt.date(area.estimatedOn)}` +
					(area.deliveredSinceEstimate
						? `, less ${fmt.qty(area.deliveredSinceEstimate, m.unit)} since`
						: '');
			return h(
				'tr',
				null,
				h('th', { scope: 'row' }, m.name),
				h('td', null, m.byArea ? areaName(app, area.locationId, 'No area') : 'Whole project'),
				h('td', { class: 'num' }, fmt.qty(area.budgetQty, m.unit)),
				h('td', { class: 'num' }, fmt.qty(area.deliveredQty, m.unit)),
				h('td', { class: 'num' }, fmt.qty(area.remainingQty, m.unit), h('small', null, now)),
				h(
					'td',
					{ class: 'qty' },
					h('input', {
						type: 'number',
						min: '0',
						step: 'any',
						inputMode: 'decimal',
						placeholder: String(area.remainingQty / 1000),
						value: typed.get(key) ?? '',
						'aria-label': `Still to come: ${m.name} ${m.byArea ? areaName(app, area.locationId, 'no area') : ''}`,
						oninput: (event) => typed.set(key, event.target.value)
					}),
					h('span', { class: 'unit' }, m.unit)
				)
			);
		})
	);

	const save = h(
		'button',
		{
			class: 'primary',
			onclick: async () => {
				const changes = [...typed].filter(([, value]) => value.trim() !== '');
				if (changes.length === 0) return toast('Type what is still to come first', 'info');
				save.disabled = true;
				const saved = await send('/estimates', 'PUT', {
					asOf,
					rows: changes.map(([key, qty]) => {
						const [materialId, locationId] = key.split('|');
						return { materialId: Number(materialId), locationId, qty };
					})
				});
				save.disabled = false;
				if (!saved) return;
				typed.clear();
				toast('Estimates saved', 'success');
				await app.refresh();
			}
		},
		'Save estimates'
	);

	return h(
		'section',
		null,
		h('h1', null, 'Remaining'),
		h(
			'p',
			{ class: 'muted' },
			'Type what is still to come where you have a better figure than the suggestion. Deliveries after the estimate date come off it.'
		),
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
						['Material', 'Area', 'Budget', 'Delivered', 'Remaining now', 'Still to come'].map(
							(label, i) => h('th', { scope: 'col', class: i > 1 && i < 5 ? 'num' : '' }, label)
						)
					)
				),
				h('tbody', null, rows)
			)
		),
		h(
			'p',
			{ class: 'actions' },
			h(
				'label',
				null,
				'Estimate as at ',
				h('input', {
					type: 'date',
					value: asOf,
					max: data.today,
					onchange: (event) => (asOf = event.target.value)
				})
			),
			save
		)
	);
}
