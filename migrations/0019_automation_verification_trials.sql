/* Keep the normal daily trial limit. Explicit operator verification has its own
   immutable dedupe key and settings version; no existing row is rewritten. */
DROP INDEX automation_trial_item;
CREATE UNIQUE INDEX automation_trial_item ON automation_runs(day,item_index)
  WHERE kind='trial' AND dedupe_key NOT GLOB 'verification:*';
CREATE UNIQUE INDEX automation_verification_item ON automation_runs(day,config_version,item_index)
  WHERE kind='trial' AND dedupe_key GLOB 'verification:*';
