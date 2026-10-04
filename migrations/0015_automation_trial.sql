/* Preserve every run id and child reference; day remains the actual KST date. */
ALTER TABLE automation_runs RENAME COLUMN day TO dedupe_key;
ALTER TABLE automation_runs ADD COLUMN day TEXT NOT NULL DEFAULT '';
UPDATE automation_runs SET day=dedupe_key;
ALTER TABLE automation_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'daily' CHECK(kind IN ('daily','trial'));
ALTER TABLE automation_runs ADD COLUMN not_before INTEGER NOT NULL DEFAULT 0 CHECK(not_before>=0);
CREATE UNIQUE INDEX automation_daily_once ON automation_runs(day) WHERE kind='daily';
CREATE UNIQUE INDEX automation_trial_once ON automation_runs(day) WHERE kind='trial';
CREATE INDEX automation_history ON automation_runs(day DESC,due_at DESC);
