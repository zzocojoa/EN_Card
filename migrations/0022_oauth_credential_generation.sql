/* Bind one-use OAuth permissions to the connection that existed at issuance.
   Existing sessions remain valid; legacy OAuth for an existing owner requires a fresh flow. */
ALTER TABLE auth_state ADD COLUMN credential_version INTEGER CHECK(credential_version IS NULL OR credential_version >= 1);
