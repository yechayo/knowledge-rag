-- Initialize pgvector extension for RAG search
CREATE EXTENSION IF NOT EXISTS vector;

-- Note: This script runs once during database container initialization.
-- If the database already exists, it won't run again.
