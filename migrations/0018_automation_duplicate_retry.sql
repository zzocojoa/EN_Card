/* Add rejection history without replacing runs, attempts, cards or references. */
ALTER TABLE automation_runs ADD COLUMN rejected_expressions TEXT NOT NULL DEFAULT '[]'
CHECK(json_valid(rejected_expressions) AND json_type(rejected_expressions)='array' AND json_array_length(rejected_expressions)<=3);
