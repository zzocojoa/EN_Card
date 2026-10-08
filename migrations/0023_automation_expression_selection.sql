/* Existing jobs retain their original generation contract. New jobs select first. */
ALTER TABLE automation_runs ADD COLUMN expression_selection INTEGER NOT NULL DEFAULT 0 CHECK(expression_selection IN (0,1));
ALTER TABLE automation_runs ADD COLUMN selected_expression TEXT CHECK(selected_expression IS NULL OR length(trim(selected_expression)) BETWEEN 1 AND 120);
CREATE TABLE automation_expression_candidates (
  expression_key TEXT PRIMARY KEY,
  expression TEXT NOT NULL CHECK(length(trim(expression)) BETWEEN 1 AND 120),
  scope TEXT NOT NULL CHECK(json_valid(scope)),
  created_at INTEGER NOT NULL,
  claim_run_id TEXT UNIQUE REFERENCES automation_runs(id)
);
CREATE INDEX automation_candidate_scope ON automation_expression_candidates(scope,claim_run_id,created_at);
CREATE TABLE automation_expression_rejections (
  run_id TEXT NOT NULL REFERENCES automation_runs(id),
  expression_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(run_id,expression_key)
);
CREATE INDEX automation_rejection_expression ON automation_expression_rejections(expression_key,run_id);
/* Changing a choice and releasing its reservation must be atomic with the run. */
CREATE TRIGGER automation_candidate_change AFTER UPDATE OF selected_expression ON automation_runs
WHEN OLD.selected_expression IS NOT NULL AND (NEW.selected_expression IS NULL OR NEW.selected_expression!=OLD.selected_expression)
BEGIN
  INSERT INTO automation_expression_rejections(run_id,expression_key,created_at)
    SELECT OLD.id,expression_key,NEW.updated_at FROM automation_expression_candidates WHERE claim_run_id=OLD.id
    ON CONFLICT DO NOTHING;
  UPDATE automation_expression_candidates SET claim_run_id=NULL WHERE claim_run_id=OLD.id;
END;
CREATE TRIGGER automation_candidate_end AFTER UPDATE OF status ON automation_runs
WHEN NEW.status IN ('skipped','cancelled') AND NEW.status!=OLD.status
BEGIN
  INSERT INTO automation_expression_rejections(run_id,expression_key,created_at)
    SELECT NEW.id,expression_key,NEW.updated_at FROM automation_expression_candidates WHERE claim_run_id=NEW.id
    ON CONFLICT DO NOTHING;
  UPDATE automation_expression_candidates SET claim_run_id=NULL WHERE claim_run_id=NEW.id;
END;
/* The permanent ledger takes over once a reviewed card is saved. */
CREATE TRIGGER automation_candidate_used AFTER INSERT ON automation_expressions
BEGIN DELETE FROM automation_expression_candidates WHERE expression_key=NEW.expression_key; END;
CREATE INDEX cards_expression_key ON cards(lower(trim(json_extract(content,'$.expression'))));
