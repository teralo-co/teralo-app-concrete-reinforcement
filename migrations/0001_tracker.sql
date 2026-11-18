-- Runs once on each project's own database, the first time the app is used there.
-- Quantities are thousandths of the material's unit (12.5 m3 = 12500); money is hundredths of
-- the project's currency (cents). Dates are YYYY-MM-DD on the project's clock. location_id is a
-- Teralo location id, or '' for none (the whole project).

CREATE TABLE material (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	unit TEXT NOT NULL,
	sort INTEGER NOT NULL
);

-- A rate applies from from_date until the next one; a material's first rate has from_date ''.
CREATE TABLE rate (
	id INTEGER PRIMARY KEY,
	material_id INTEGER NOT NULL REFERENCES material (id),
	cents INTEGER NOT NULL,
	from_date TEXT NOT NULL,
	UNIQUE (material_id, from_date)
);

-- Budget cost is fixed at the rate in force when the line was set.
CREATE TABLE budget (
	id INTEGER PRIMARY KEY,
	material_id INTEGER NOT NULL REFERENCES material (id),
	location_id TEXT NOT NULL,
	qty_milli INTEGER NOT NULL,
	rate_cents INTEGER NOT NULL,
	cost_cents INTEGER NOT NULL,
	UNIQUE (material_id, location_id)
);

-- A delivery keeps the rate and cost it was entered at, whatever the rates do later.
CREATE TABLE delivery (
	id INTEGER PRIMARY KEY,
	date TEXT NOT NULL,
	material_id INTEGER NOT NULL REFERENCES material (id),
	location_id TEXT NOT NULL,
	qty_milli INTEGER NOT NULL,
	rate_cents INTEGER NOT NULL,
	cost_cents INTEGER NOT NULL,
	docket TEXT NOT NULL,
	note TEXT NOT NULL,
	removed_at TEXT
);
CREATE INDEX delivery_material_date ON delivery (material_id, date);

-- What is still to come, as at the end of as_of. The latest per material and area counts.
CREATE TABLE estimate (
	id INTEGER PRIMARY KEY,
	material_id INTEGER NOT NULL REFERENCES material (id),
	location_id TEXT NOT NULL,
	qty_milli INTEGER NOT NULL,
	as_of TEXT NOT NULL,
	UNIQUE (material_id, location_id)
);

-- Every change: who, when, and the record before and after (JSON).
CREATE TABLE change_log (
	id INTEGER PRIMARY KEY,
	at TEXT NOT NULL,
	person_id TEXT NOT NULL,
	person_name TEXT NOT NULL,
	what TEXT NOT NULL,
	action TEXT NOT NULL,
	record_id INTEGER,
	before TEXT,
	after TEXT
);
