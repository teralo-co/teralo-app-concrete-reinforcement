// Runs in Teralo's plugin host, once per request. `teralo` reads Teralo data with the person's
// own permissions; `db` is this app's database for the project it is open on.
//
// Who may do what: anyone who can open the app enters deliveries and remaining estimates; only
// people who hold Teralo's "Apps: manage" on the project (`person.canManage`) change materials,
// rates and budget. Every change is written to change_log in the same transaction.
import { defineApp } from '@teralo-co/apps/server';
import {
	forecast,
	costOf,
	isByArea,
	isDate,
	parseMoney,
	parseQuantity,
	rateOn,
	todayIn
} from './forecast.js';

const MAX_ROWS = 200;
const MANAGERS_ONLY =
	'Only people who manage apps on this project can change materials, rates and budget';

class Refusal extends Error {
	constructor(message, status = 400) {
		super(message);
		this.status = status;
	}
}
const refuse = (message, status) => {
	throw new Refusal(message, status);
};

function text(value, max, label, required = true) {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	if (required && !trimmed) refuse(`${label} is required`);
	if (trimmed.length > max) refuse(`${label} is longer than ${max} characters`);
	return trimmed;
}

const readJson = (request) => request.json().catch(() => refuse('Send a JSON body'));

function rowsOf(body, label) {
	const rows = body?.[label];
	if (!Array.isArray(rows) || rows.length === 0) refuse('Nothing to save');
	if (rows.length > MAX_ROWS) refuse(`At most ${MAX_ROWS} rows at a time`);
	return rows;
}

async function load(db) {
	const [materials, rates, budget, deliveries, estimates] = await db.batch([
		{ sql: 'SELECT id, name, unit FROM material ORDER BY sort, id' },
		{ sql: 'SELECT material_id, cents, from_date FROM rate ORDER BY material_id, from_date' },
		{ sql: 'SELECT material_id, location_id, qty_milli, rate_cents, cost_cents FROM budget' },
		{
			sql: `SELECT id, date, material_id, location_id, qty_milli, rate_cents, cost_cents, docket, note
				FROM delivery WHERE removed_at IS NULL ORDER BY date, id`
		},
		{ sql: 'SELECT material_id, location_id, qty_milli, as_of FROM estimate' }
	]);
	return { materials, rates, budget, deliveries, estimates };
}

const materialOf = (data, id) =>
	data.materials.find((material) => material.id === id) ?? refuse('No such material', 404);

/** Who is writing, and today on the project's clock. */
async function writer(teralo, { manage = false } = {}) {
	const [project, person] = await Promise.all([teralo.project(), teralo.person()]);
	if (manage && !person.canManage) refuse(MANAGERS_ONLY, 403);
	return { person, today: todayIn(project.timeZone), at: new Date().toISOString() };
}

/**
 * A change_log row. `recordId` is the material the change concerns (the delivery, for a
 * delivery), or SQL naming a row the same transaction has just inserted.
 */
function log(w, what, action, recordId, before, after) {
	const record = typeof recordId === 'number' ? '?' : recordId;
	return {
		sql: `INSERT INTO change_log (at, person_id, person_name, what, action, record_id, before, after)
			VALUES (?, ?, ?, ?, ?, ${record}, ?, ?)`,
		params: [
			w.at,
			w.person.id,
			w.person.name,
			what,
			action,
			...(typeof recordId === 'number' ? [recordId] : []),
			before === null ? null : JSON.stringify(before),
			after === null ? null : JSON.stringify(after)
		]
	};
}

async function locationIds(teralo) {
	return new Set((await teralo.locations()).map((location) => location.id));
}

function locationOf(value, known, label) {
	const id = typeof value === 'string' ? value : '';
	if (id && !known.has(id)) refuse(`${label}: that location is not on this project`);
	return id;
}

async function summary(teralo, db) {
	const [project, person, locations, data] = await Promise.all([
		teralo.project(),
		teralo.person(),
		teralo.locations(),
		load(db)
	]);
	const today = todayIn(project.timeZone);
	return { project, person, locations, today, ...data, forecast: forecast({ ...data, today }) };
}

async function addMaterial(teralo, db, body) {
	const w = await writer(teralo, { manage: true });
	const name = text(body.name, 80, 'Name');
	const unit = text(body.unit, 20, 'Unit');
	const cents = parseMoney(body.rate) ?? refuse('The rate must be an amount, such as 285.50');
	if (await db.one('SELECT id FROM material WHERE lower(name) = lower(?)', [name])) {
		refuse(`There is already a material called ${name}`, 409);
	}
	// In one transaction the new material is the highest id.
	const added = '(SELECT max(id) FROM material)';
	await db.batch([
		{
			sql: 'INSERT INTO material (name, unit, sort) VALUES (?, ?, (SELECT coalesce(max(sort), 0) + 1 FROM material))',
			params: [name, unit]
		},
		{
			sql: `INSERT INTO rate (material_id, cents, from_date) VALUES (${added}, ?, '')`,
			params: [cents]
		},
		log(w, 'material', 'added', added, null, { name, unit, rateCents: cents })
	]);
}

async function editMaterial(teralo, db, id, body) {
	const w = await writer(teralo, { manage: true });
	const material = materialOf(await load(db), id);
	const name = text(body.name, 80, 'Name');
	const unit = text(body.unit, 20, 'Unit');
	const clash = await db.one('SELECT id FROM material WHERE lower(name) = lower(?) AND id <> ?', [
		name,
		id
	]);
	if (clash) refuse(`There is already a material called ${name}`, 409);
	await db.batch([
		{ sql: 'UPDATE material SET name = ?, unit = ? WHERE id = ?', params: [name, unit, id] },
		log(w, 'material', 'changed', id, material, { id, name, unit })
	]);
}

async function removeMaterial(teralo, db, id) {
	const w = await writer(teralo, { manage: true });
	const material = materialOf(await load(db), id);
	const used = await db.one(
		`SELECT (SELECT count(*) FROM delivery WHERE material_id = ?)
			+ (SELECT count(*) FROM budget WHERE material_id = ?)
			+ (SELECT count(*) FROM estimate WHERE material_id = ?) AS n`,
		[id, id, id]
	);
	if (used.n > 0)
		refuse(`${material.name} has a budget, deliveries or estimates, so it stays`, 409);
	await db.batch([
		{ sql: 'DELETE FROM rate WHERE material_id = ?', params: [id] },
		{ sql: 'DELETE FROM material WHERE id = ?', params: [id] },
		log(w, 'material', 'removed', id, material, null)
	]);
}

async function setRate(teralo, db, body) {
	const w = await writer(teralo, { manage: true });
	const data = await load(db);
	const material = materialOf(data, body.materialId);
	const cents = parseMoney(body.rate) ?? refuse('The rate must be an amount, such as 285.50');
	const from = typeof body.from === 'string' ? body.from : '';
	if (from && !isDate(from)) refuse('The date the rate applies from is not a date');
	const before = data.rates.find((r) => r.material_id === material.id && r.from_date === from);
	await db.batch([
		{
			sql: `INSERT INTO rate (material_id, cents, from_date) VALUES (?, ?, ?)
				ON CONFLICT (material_id, from_date) DO UPDATE SET cents = excluded.cents`,
			params: [material.id, cents, from]
		},
		log(w, 'rate', before ? 'changed' : 'added', material.id, before ?? null, {
			material: material.name,
			cents,
			from
		})
	]);
}

async function setBudget(teralo, db, id, body) {
	const w = await writer(teralo, { manage: true });
	const data = await load(db);
	const material = materialOf(data, id);
	if (!Array.isArray(body.lines) || body.lines.length > MAX_ROWS) {
		refuse(`Send up to ${MAX_ROWS} budget lines`);
	}
	const known = body.lines.some((line) => line?.locationId) ? await locationIds(teralo) : new Set();
	const seen = new Set();
	const rateCents = rateOn(data.rates, id, w.today) ?? refuse(`${material.name} has no rate`);
	const lines = body.lines.map((line, i) => {
		const label = `Line ${i + 1}`;
		const locationId = locationOf(line?.locationId, known, label);
		if (seen.has(locationId)) refuse(`${label}: that area is listed twice`);
		seen.add(locationId);
		const qty = parseQuantity(line?.qty) ?? refuse(`${label}: the quantity must be a number`);
		return { locationId, qty, rateCents, costCents: costOf(qty, rateCents) };
	});
	if (seen.has('') && seen.size > 1) {
		refuse('Budget a material for the whole project or by area, not both');
	}
	const before = data.budget.filter((line) => line.material_id === id);
	await db.batch([
		{ sql: 'DELETE FROM budget WHERE material_id = ?', params: [id] },
		...lines.map((line) => ({
			sql: 'INSERT INTO budget (material_id, location_id, qty_milli, rate_cents, cost_cents) VALUES (?, ?, ?, ?, ?)',
			params: [id, line.locationId, line.qty, line.rateCents, line.costCents]
		})),
		log(w, 'budget', 'changed', id, before, { material: material.name, lines })
	]);
}

async function addDeliveries(teralo, db, body) {
	const w = await writer(teralo);
	const data = await load(db);
	const rows = rowsOf(body, 'rows');
	const known = rows.some((row) => row?.locationId) ? await locationIds(teralo) : new Set();
	const deliveries = rows.map((row, i) => {
		const label = `Row ${i + 1}`;
		const material = data.materials.find((m) => m.id === row?.materialId);
		if (!material) refuse(`${label}: choose a material`);
		if (!isDate(row.date)) refuse(`${label}: the date is not a date`);
		if (row.date > w.today) refuse(`${label}: the date is after today`);
		const qty = parseQuantity(row.qty);
		if (!qty) refuse(`${label}: enter the quantity delivered`);
		const locationId = locationOf(row.locationId, known, label);
		if (!locationId && isByArea(data.budget, material.id)) {
			refuse(`${label}: ${material.name} is budgeted by area, so choose the area`);
		}
		const rateCents = rateOn(data.rates, material.id, row.date) ?? refuse(`${label}: no rate`);
		return {
			date: row.date,
			materialId: material.id,
			material: material.name,
			locationId,
			qty,
			rateCents,
			costCents: costOf(qty, rateCents),
			docket: text(row.docket, 50, `${label}: docket`, false),
			note: text(row.note, 500, `${label}: note`, false)
		};
	});
	await db.batch(
		deliveries.flatMap((d) => [
			{
				sql: `INSERT INTO delivery (date, material_id, location_id, qty_milli, rate_cents, cost_cents, docket, note)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				params: [
					d.date,
					d.materialId,
					d.locationId,
					d.qty,
					d.rateCents,
					d.costCents,
					d.docket,
					d.note
				]
			},
			log(w, 'delivery', 'added', 'last_insert_rowid()', null, d)
		])
	);
	return deliveries.length;
}

async function removeDelivery(teralo, db, id) {
	const w = await writer(teralo);
	const delivery = await db.one('SELECT * FROM delivery WHERE id = ? AND removed_at IS NULL', [id]);
	if (!delivery) refuse('That delivery is not there', 404);
	await db.batch([
		{ sql: 'UPDATE delivery SET removed_at = ? WHERE id = ?', params: [w.at, id] },
		log(w, 'delivery', 'removed', id, delivery, null)
	]);
}

async function setEstimates(teralo, db, body) {
	const w = await writer(teralo);
	const data = await load(db);
	const asOf = body.asOf;
	if (!isDate(asOf) || asOf > w.today) refuse('The estimate date must be today or earlier');
	const rows = rowsOf(body, 'rows');
	const known = rows.some((row) => row?.locationId) ? await locationIds(teralo) : new Set();
	const estimates = rows.map((row, i) => {
		const label = `Row ${i + 1}`;
		const material = data.materials.find((m) => m.id === row?.materialId);
		if (!material) refuse(`${label}: choose a material`);
		// A material budgeted for the whole project is estimated as one.
		const locationId = isByArea(data.budget, material.id)
			? locationOf(row.locationId, known, label)
			: '';
		const qty = parseQuantity(row.qty) ?? refuse(`${label}: the quantity must be a number`);
		const before = data.estimates.find(
			(e) => e.material_id === material.id && e.location_id === locationId
		);
		return { materialId: material.id, material: material.name, locationId, qty, before };
	});
	await db.batch(
		estimates.flatMap(({ before, ...e }) => [
			{
				sql: `INSERT INTO estimate (material_id, location_id, qty_milli, as_of) VALUES (?, ?, ?, ?)
					ON CONFLICT (material_id, location_id) DO UPDATE SET qty_milli = excluded.qty_milli, as_of = excluded.as_of`,
				params: [e.materialId, e.locationId, e.qty, asOf]
			},
			log(w, 'estimate', before ? 'changed' : 'added', e.materialId, before ?? null, {
				...e,
				asOf
			})
		])
	);
}

export default defineApp(async ({ request, url, teralo, db }) => {
	const id = Number(url.pathname.match(/\/(\d+)$/)?.[1]);
	const route = `${request.method} ${url.pathname.replace(/\/\d+$/, '/:id')}`;
	const done = (status = 204) => new Response(null, { status });
	try {
		switch (route) {
			case 'GET /summary':
				return Response.json(await summary(teralo, db));
			case 'GET /history':
				return Response.json(await db.all('SELECT * FROM change_log ORDER BY id DESC LIMIT 500'));
			case 'POST /materials':
				await addMaterial(teralo, db, await readJson(request));
				return done(201);
			case 'PATCH /materials/:id':
				await editMaterial(teralo, db, id, await readJson(request));
				return done();
			case 'DELETE /materials/:id':
				await removeMaterial(teralo, db, id);
				return done();
			case 'POST /rates':
				await setRate(teralo, db, await readJson(request));
				return done();
			case 'PUT /budget/:id':
				await setBudget(teralo, db, id, await readJson(request));
				return done();
			case 'POST /deliveries':
				return Response.json(
					{ saved: await addDeliveries(teralo, db, await readJson(request)) },
					{ status: 201 }
				);
			case 'DELETE /deliveries/:id':
				await removeDelivery(teralo, db, id);
				return done();
			case 'PUT /estimates':
				await setEstimates(teralo, db, await readJson(request));
				return done();
		}
		return Response.json({ error: 'Not found' }, { status: 404 });
	} catch (err) {
		if (err instanceof Refusal) {
			return Response.json({ error: err.message }, { status: err.status });
		}
		// The host's own messages (an archived project, a full database) are written for people.
		console.error(err);
		return Response.json(
			{ error: err instanceof Error ? err.message : 'Something went wrong' },
			{ status: 500 }
		);
	}
});
