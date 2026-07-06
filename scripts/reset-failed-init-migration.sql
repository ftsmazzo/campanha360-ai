-- Execute uma vez no Postgres do EasyPanel se a API entrar em loop com erro P3009.
-- A migration init falhou na primeira tentativa (BOM invalido no SQL) e ficou marcada como failed.

DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260706120000_init'
  AND finished_at IS NULL;
