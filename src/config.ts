function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requiredPort(name: string, defaultValue: string): number {
  const raw = process.env[name] ?? defaultValue;
  const port = parseInt(raw, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${name}: "${raw}" — must be a number between 1 and 65535`);
  }
  return port;
}

export const config = {
  slack: {
    botToken: required('SLACK_BOT_TOKEN'),
    signingSecret: required('SLACK_SIGNING_SECRET'),
    appToken: required('SLACK_APP_TOKEN'),
  },
  asana: {
    accessToken: required('ASANA_ACCESS_TOKEN'),
    workspaceGid: required('ASANA_WORKSPACE_GID'),
    projectGid: required('ASANA_PROJECT_GID'),
  },
  server: {
    port: requiredPort('PORT', '3000'),
    host: process.env.HOST ?? '0.0.0.0',
    logLevel: process.env.LOG_LEVEL ?? 'info',
  },
  autoVerify: {
    /** Channel IDs to auto-verify (comma-separated). Leave empty to disable. */
    channelIds: (process.env.AUTO_VERIFY_CHANNELS ?? '').split(',').filter(Boolean),
    /** Delay in seconds before auto-verify runs (gives Zapier time to post to Asana). */
    delaySec: parseInt(process.env.AUTO_VERIFY_DELAY_SEC ?? '60', 10),
  },
  db: {
    path: process.env.DATABASE_PATH ?? './data/sync.db',
  },
} as const;
