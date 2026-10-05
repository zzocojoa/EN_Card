/* Replace only the quantity column constraint. Keep parent IDs and every child reference. */
CREATE TABLE automation_quantity_0017 (id TEXT PRIMARY KEY, item_index INTEGER NOT NULL, item_count INTEGER NOT NULL);
INSERT INTO automation_quantity_0017 SELECT id,item_index,item_count FROM automation_runs;
DROP TRIGGER automation_item_batch;
DROP TRIGGER automation_item_identity;
DROP INDEX automation_daily_item;
UPDATE automation_runs SET item_index=1;
ALTER TABLE automation_runs DROP COLUMN item_count;
ALTER TABLE automation_runs ADD COLUMN item_count INTEGER NOT NULL DEFAULT 1 CHECK(item_count BETWEEN 1 AND 5 AND item_index<=item_count);
UPDATE automation_runs SET item_index=(SELECT item_index FROM automation_quantity_0017 WHERE id=automation_runs.id),item_count=(SELECT item_count FROM automation_quantity_0017 WHERE id=automation_runs.id);
DROP TABLE automation_quantity_0017;
DROP INDEX automation_trial_once;
CREATE UNIQUE INDEX automation_daily_item ON automation_runs(day,item_index) WHERE kind='daily';
CREATE UNIQUE INDEX automation_trial_item ON automation_runs(day,item_index) WHERE kind='trial';
CREATE TRIGGER automation_item_batch BEFORE INSERT ON automation_runs WHEN NEW.item_index>1 AND NOT EXISTS(
  SELECT 1 FROM automation_runs r WHERE r.kind=NEW.kind AND r.day=NEW.day AND r.item_index=1
  AND r.item_count=NEW.item_count AND r.config_version=NEW.config_version AND r.due_at=NEW.due_at AND r.settings=NEW.settings
  AND r.not_before=NEW.not_before AND r.deadline=NEW.deadline
) BEGIN SELECT RAISE(ABORT,'automation_batch_mismatch'); END;
CREATE TRIGGER automation_item_identity BEFORE UPDATE OF day,kind,item_index,item_count,config_version,settings,due_at,not_before,deadline ON automation_runs
WHEN NEW.day!=OLD.day OR NEW.kind!=OLD.kind OR NEW.item_index!=OLD.item_index OR NEW.item_count!=OLD.item_count
OR NEW.config_version!=OLD.config_version OR NEW.settings!=OLD.settings OR NEW.due_at!=OLD.due_at
OR NEW.not_before!=OLD.not_before OR NEW.deadline!=OLD.deadline
BEGIN SELECT RAISE(ABORT,'automation_item_immutable'); END;
