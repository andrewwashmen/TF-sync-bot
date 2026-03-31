import 'dotenv/config';
import { App } from '@slack/bolt';
import Fastify from 'fastify';
import pino from 'pino';
import { config } from './config.js';
import { getDb, closeDb } from './db/client.js';
import { registerSyncCommand, registerVerifyCommand, registerAutoVerify } from './slack/commands.js';
import { AsanaClient } from './asana/client.js';

const logger = pino({ level: config.server.logLevel });

async function main(): Promise<void> {
  logger.info('Starting Slack-Asana Sync Service...');

  const db = getDb(config.db.path);
  logger.info({ dbPath: config.db.path }, 'Database initialized');

  const asanaClient = new AsanaClient(config.asana.accessToken, logger);

  // Fastify for health check
  const fastify = Fastify({ logger: false });

  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  const fastifyPort = config.server.port;
  await fastify.listen({ port: fastifyPort, host: config.server.host });
  logger.info({ port: fastifyPort }, 'Fastify server started (health check)');

  // Slack Bolt app — Socket Mode (no public URL needed)
  const app = new App({
    token: config.slack.botToken,
    signingSecret: config.slack.signingSecret,
    appToken: config.slack.appToken,
    socketMode: true,
  });

  const commandDeps = {
    db,
    asanaClient,
    slackBotToken: config.slack.botToken,
    asanaWorkspaceGid: config.asana.workspaceGid,
    asanaProjectGid: config.asana.projectGid,
    logger,
  };

  registerSyncCommand(app, commandDeps);
  registerVerifyCommand(app, commandDeps);
  registerAutoVerify(app, commandDeps);

  await app.start();
  logger.info('Slack Bolt started in Socket Mode');
  logger.info('Slack-Asana Sync Service is running');

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down...');
    try {
      await app.stop();
    } finally {
      try {
        await fastify.close();
      } finally {
        closeDb();
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start service');
  process.exit(1);
});
