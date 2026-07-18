import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { GameStore } from './db.js';
import { buildServer } from './server.js';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const config = loadConfig();
const store = new GameStore(config.DATABASE_PATH);
const app = await buildServer(config, store);

await app.listen({ port: config.SERVER_PORT, host: '0.0.0.0' });
app.log.info({ port: config.SERVER_PORT }, 'pachinko server ready');

const close = async () => {
  await app.close();
  store.close();
};

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
