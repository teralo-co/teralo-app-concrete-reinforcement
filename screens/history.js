// Every change, newest first: who, when and what.
import { api } from '@teralo-co/apps/client';
import { areaName, empty, h } from './lib.js';

function describe(app, entry) {
	const { fmt, data } = app;
	const before = entry.before ? JSON.parse(entry.before) : null;
	const after = entry.after ? JSON.parse(entry.after) : null;
	const unitOf = (id) => data.materials.find((m) => m.id === id)?.unit ?? '';
	const nameOf = (id) => data.materials.find((m) => m.id === id)?.name ?? 'a removed material';
	switch (entry.what) {
		case 'material':
			if (entry.action === 'added')
				return `Added ${after.name} (${after.unit}) at ${fmt.money(after.rateCents)} per ${after.unit}`;
			if (entry.action === 'changed')
				return `Renamed ${before.name} (${before.unit}) to ${after.name} (${after.unit})`;
			return `Removed ${before.name}`;
		case 'rate':
			return (
				`${after.material}: ${fmt.money(after.cents)} per ${unitOf(entry.record_id)} from ${fmt.date(after.from)}` +
				(before ? ` (was ${fmt.money(before.cents)})` : '')
			);
		case 'budget': {
			const unit = unitOf(entry.record_id);
			const lines = after.lines.map(
				(l) => `${fmt.qty(l.qty, unit)}${l.locationId ? ` in ${areaName(app, l.locationId)}` : ''}`
			);
			return `${after.material}: budget set to ${lines.join(', ') || 'nothing'}`;
		}
		case 'delivery': {
			const d = after ?? before;
			const materialId = d.materialId ?? d.material_id;
			const qty = fmt.qty(d.qty ?? d.qty_milli, unitOf(materialId));
			const where = areaName(app, d.locationId ?? d.location_id, '');
			const text = `${qty} of ${d.material ?? nameOf(materialId)} on ${fmt.date(d.date)}${where ? ` to ${where}` : ''}${d.docket ? `, docket ${d.docket}` : ''}`;
			return entry.action === 'added' ? `Delivery: ${text}` : `Removed delivery: ${text}`;
		}
		case 'estimate': {
			const unit = unitOf(after.materialId);
			const where = after.locationId ? ` in ${areaName(app, after.locationId)}` : '';
			return (
				`${after.material}${where}: ${fmt.qty(after.qty, unit)} still to come as at ${fmt.date(after.asOf)}` +
				(before ? ` (was ${fmt.qty(before.qty_milli, unit)} as at ${fmt.date(before.as_of)})` : '')
			);
		}
	}
	return `${entry.action} ${entry.what}`;
}

export default function history(app) {
	const holder = h('div', null, h('p', { class: 'muted' }, 'Loading...'));
	api('/history')
		.then((response) => (response.ok ? response.json() : Promise.reject(response)))
		.then((entries) => {
			if (entries.length === 0) return holder.replaceChildren(empty('Nothing has changed yet.'));
			holder.replaceChildren(
				h(
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
								['When', 'Who', 'What'].map((label) => h('th', { scope: 'col' }, label))
							)
						),
						h(
							'tbody',
							null,
							entries.map((entry) =>
								h(
									'tr',
									null,
									h('td', { class: 'nowrap' }, app.fmt.at(entry.at)),
									h('td', null, entry.person_name),
									h('td', null, describe(app, entry))
								)
							)
						)
					)
				),
				entries.length === 500 ? h('p', { class: 'muted' }, 'The latest 500 changes.') : null
			);
		})
		.catch(() => holder.replaceChildren(empty('The history could not be loaded.')));
	return h('section', null, h('h1', null, 'History'), holder);
}
