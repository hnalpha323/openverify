-- One file per kind and verification: a re-upload replaces the earlier file in the same
-- transaction (`replaceVerificationFile`), so the API never writes two. Fails if a database
-- already holds duplicates from before this fix; remove the older duplicate rows first.
CREATE UNIQUE INDEX "files_environment_id_verification_id_kind_key" ON "files" USING btree ("environment_id","verification_id","kind");