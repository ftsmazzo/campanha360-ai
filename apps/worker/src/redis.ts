import IORedis, { type Redis } from 'ioredis';

/**
 * Conexao Redis dedicada ao worker de disparo (BullMQ). Nao reutiliza a
 * conexao do producer (apps/api) — cada processo mantem a sua.
 */
export function createRedisConnection(): Redis {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL nao configurado: worker de disparo indisponivel');
  }

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  });

  connection.on('error', (error: Error) => {
    // eslint-disable-next-line no-console
    console.error(`[worker] erro de conexao Redis: ${error.message}`);
  });

  return connection;
}
