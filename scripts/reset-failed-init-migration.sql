-- Fallback manual de emergencia. O deploy da API ja recupera P3009 automaticamente.
-- Use somente se o entrypoint nao conseguir resolver sozinho.

DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260706120000_init'
  AND finished_at IS NULL;
