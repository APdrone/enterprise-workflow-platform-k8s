-- Initialize separate databases for services
CREATE DATABASE workflow_db;
CREATE DATABASE audit_db;
CREATE DATABASE pact_db;

-- Connect to workflow_db and setup initial schema if needed
\c workflow_db;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Connect to audit_db
\c audit_db;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
