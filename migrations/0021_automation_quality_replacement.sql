/* Preserve all parent IDs, revisions, attempts and expression references. */
CREATE TABLE automation_revision_0021 (id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
INSERT INTO automation_revision_0021 SELECT id,revision FROM automation_runs;
ALTER TABLE automation_runs DROP COLUMN revision;
ALTER TABLE automation_runs ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 4);
UPDATE automation_runs SET revision=(SELECT revision FROM automation_revision_0021 WHERE id=automation_runs.id);
DROP TABLE automation_revision_0021;
/* Private failed-candidate evidence, retained when replacement content advances. */
ALTER TABLE automation_runs ADD COLUMN replacement_origin TEXT
CHECK(replacement_origin IS NULL OR (json_valid(replacement_origin) AND json_type(replacement_origin)='object'));
