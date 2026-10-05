/* Keep existing runs, child references and daily settings intact. Old records are one-card days. */
ALTER TABLE automation_runs ADD COLUMN item_index INTEGER NOT NULL DEFAULT 1 CHECK(item_index BETWEEN 1 AND 5);
ALTER TABLE automation_runs ADD COLUMN item_count INTEGER NOT NULL DEFAULT 1 CHECK(item_count BETWEEN 1 AND 5 AND item_index<=item_count AND (kind!='trial' OR (item_index=1 AND item_count=1)));
DROP INDEX automation_daily_once;
CREATE UNIQUE INDEX automation_daily_item ON automation_runs(day,item_index) WHERE kind='daily';
DROP INDEX automation_history;
CREATE INDEX automation_history ON automation_runs(day DESC,due_at DESC,item_index);
/* The first item freezes the day's quantity/version. Resaving cannot top up a consumed day. */
CREATE TRIGGER automation_item_batch BEFORE INSERT ON automation_runs WHEN NEW.kind='daily' AND NEW.item_index>1 AND NOT EXISTS(
  SELECT 1 FROM automation_runs r WHERE r.kind='daily' AND r.day=NEW.day AND r.item_index=1
  AND r.item_count=NEW.item_count AND r.config_version=NEW.config_version AND r.due_at=NEW.due_at AND r.settings=NEW.settings
) BEGIN SELECT RAISE(ABORT,'automation_batch_mismatch'); END;
CREATE TRIGGER automation_item_identity BEFORE UPDATE OF day,kind,item_index,item_count,config_version,settings,due_at ON automation_runs
WHEN NEW.day!=OLD.day OR NEW.kind!=OLD.kind OR NEW.item_index!=OLD.item_index OR NEW.item_count!=OLD.item_count
OR NEW.config_version!=OLD.config_version OR NEW.settings!=OLD.settings OR NEW.due_at!=OLD.due_at
BEGIN SELECT RAISE(ABORT,'automation_item_immutable'); END;
