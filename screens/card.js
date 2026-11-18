// The project dashboard card: forecast against budget, and the materials furthest over.
import { openPage } from '@teralo-co/apps/client';
import { empty, h } from './lib.js';

export default function card(app) {
	const { data, fmt } = app;
	const f = data.forecast;
	if (data.materials.length === 0) {
		return h(
			'div',
			{ class: 'card' },
			empty('No materials set up yet.'),
			h('button', { onclick: () => openPage('/') }, 'Open')
		);
	}
	const over = f.materials
		.filter((m) => m.variance > 0)
		.sort((a, b) => b.variance - a.variance)
		.slice(0, 3);
	return h(
		'div',
		{ class: 'card' },
		h('p', { class: 'muted' }, 'Forecast final cost'),
		h('p', { class: 'big' }, fmt.money(f.forecastCost)),
		h(
			'p',
			null,
			`Budget ${fmt.money(f.budgetCost)}, `,
			h('span', { class: f.variance > 0 ? 'over' : '' }, fmt.variance(f.variance))
		),
		over.length
			? h(
					'ul',
					null,
					over.map((m) =>
						h('li', null, m.name, ' ', h('span', { class: 'over' }, fmt.variance(m.variance)))
					)
				)
			: h('p', { class: 'muted' }, 'No material is forecast over budget.'),
		h('button', { onclick: () => openPage('/') }, 'Open tracker')
	);
}
