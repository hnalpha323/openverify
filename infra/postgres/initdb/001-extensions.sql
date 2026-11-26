-- Runs once, when the postgres-data volume is first initialised (docker-entrypoint-initdb.d).
-- Database migrations must still create the extensions they need, because Testcontainers
-- and production databases never run this script.
CREATE EXTENSION IF NOT EXISTS vector;
