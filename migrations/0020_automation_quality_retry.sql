/* Widen only the content revision constraint, preserving parent IDs and child references. */
CREATE TABLE automation_revision_0020 (id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
INSERT INTO automation_revision_0020 SELECT id,revision FROM automation_runs;
ALTER TABLE automation_runs DROP COLUMN revision;
ALTER TABLE automation_runs ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 3);
UPDATE automation_runs SET revision=(SELECT revision FROM automation_revision_0020 WHERE id=automation_runs.id);
DROP TABLE automation_revision_0020;
