// What every screen uses: an element builder, the project's formats, and saving to the server.
import { api, toast } from '@teralo-co/apps/client';

/** `h('button', { onclick }, 'Save')`: props after children, so a select's value finds its options. */
export function h(tag, props, ...children) {
	const el = document.createElement(tag);
	el.append(
		...children
			.flat(Infinity)
			.filter((child) => child !== null && child !== undefined && child !== false)
			.map((child) => (child instanceof Node ? child : String(child)))
	);
	for (const [key, value] of Object.entries(props ?? {})) {
		if (value === null || value === undefined || value === false) continue;
		if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
		else if (key === 'class') el.className = value;
		else if (key in el) el[key] = value;
		else el.setAttribute(key, value === true ? '' : value);
	}
	return el;
}

/** Money, quantities and dates in the project's locale, currency and time zone. */
export function formatter({ locale, currency, timeZone }) {
	const money = new Intl.NumberFormat(locale, { style: 'currency', currency });
	const quantity = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
	const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
	const moment = new Intl.DateTimeFormat(locale, {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone
	});
	return {
		money: (cents) => money.format(cents / 100),
		qty: (milli, unit) => `${quantity.format(milli / 1000)}${unit ? ` ${unit}` : ''}`,
		date: (date) => (date ? day.format(new Date(`${date}T00:00:00Z`)) : 'the start'),
		at: (iso) => moment.format(new Date(iso)),
		variance: (cents) =>
			cents === 0
				? 'on budget'
				: `${money.format(Math.abs(cents) / 100)} ${cents > 0 ? 'over' : 'under'}`
	};
}

/** Each location's full name, "Building A > Level 2 > East pour". */
export function locationNames(locations) {
	const byId = new Map(locations.map((location) => [location.id, location]));
	const names = new Map();
	for (const location of locations) {
		const parts = [];
		const seen = new Set(); // Teralo does not stop a cycle in the tree, so never loop on one
		for (let at = location; at && !seen.has(at.id); at = byId.get(at.parentId)) {
			seen.add(at.id);
			parts.unshift(at.name);
		}
		names.set(location.id, parts.join(' > '));
	}
	return names;
}

/** Sends a change; on a refusal shows the server's reason and answers false. */
export async function send(path, method, body) {
	const response = await api(path, {
		method,
		headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (response.ok) return true;
	const { error } = await response.json().catch(() => ({}));
	toast(error ?? 'That did not save', 'error');
	return false;
}

/** Rows to CSV. Text that a spreadsheet would run as a formula gets a leading quote. */
export function csv(rows) {
	const cell = (value) => {
		if (typeof value === 'number') return String(value);
		let text = String(value ?? '');
		if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
		return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
	};
	return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

/** A button that asks for a second click before it acts (the frame cannot open a confirm). */
export function confirmButton(label, confirmLabel, action) {
	const button = h(
		'button',
		{
			class: 'link',
			onclick: async () => {
				if (button.dataset.armed !== 'yes') {
					button.dataset.armed = 'yes';
					button.textContent = confirmLabel;
					return;
				}
				button.disabled = true;
				await action();
				button.disabled = false;
			}
		},
		label
	);
	return button;
}

/** The area a row is for: its full name, or what a blank one means. */
export const areaName = (app, locationId, blank = 'Whole project') =>
	locationId ? (app.names.get(locationId) ?? 'A location no longer on the project') : blank;

export const empty = (message) => h('p', { class: 'empty' }, message);
