#!/usr/bin/env node
/* eslint-disable no-console -- this is a CLI; stdout is its interface */
import { attach, type AttachOptions } from './attach';
import { startDashboard } from './dashboard';
import { serveMcp } from './mcp';
import { parseTarget, type ServiceTarget } from './targets';

const HELP = `nodeui - attach the NodeUI developer console to any Node app

Usage:
  nodeui attach [options] -- <command...>   run a command with the console attached
  nodeui dashboard [options] <name=url>...  one page for several running consoles
  nodeui mcp <name=url>...                  MCP server (stdio) so AI agents can read a console

attach options:
  --path <prefix>      console path (default /nodeui)
  --token <secret>     require an access token
  --persist <file>     keep a journal that survives restarts
  --otlp <url>         export spans to an OTLP/HTTP collector
  --bodies             capture request/response bodies
  --force              attach even when NODE_ENV=production

dashboard options:
  --port <n>           port to listen on (default 4000, loopback only)

mcp: read-only tools over stdio; add it to an MCP client as
  { "command": "npx", "args": ["@singhak/nodeui-cli", "mcp", "http://127.0.0.1:3000"] }

Examples:
  npx @singhak/nodeui-cli attach -- node server.js
  npx @singhak/nodeui-cli attach -- npm run dev
  npx @singhak/nodeui-cli dashboard api=http://127.0.0.1:3000 worker=http://127.0.0.1:3001
`;

interface Parsed {
  flags: Record<string, string | true>;
  positional: string[];
  rest: string[];
}

const VALUE_FLAGS = new Set(['path', 'token', 'persist', 'otlp', 'port']);

export function parseArgs(argv: string[]): Parsed {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  let rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--') {
      rest = argv.slice(i + 1);
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = arg.slice(2, eq === -1 ? undefined : eq);
      if (eq !== -1) flags[name] = arg.slice(eq + 1);
      else if (VALUE_FLAGS.has(name)) {
        const value = argv[++i];
        if (value === undefined) throw new Error(`--${name} needs a value`);
        flags[name] = value;
      } else flags[name] = true;
    } else positional.push(arg);
  }
  return { flags, positional, rest };
}

function str(flags: Parsed['flags'], name: string): string | undefined {
  const v = flags[name];
  return typeof v === 'string' ? v : undefined;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    return command ? 0 : 1;
  }
  const { flags, positional, rest } = parseArgs(args);

  if (command === 'attach') {
    const command2 = rest.length > 0 ? rest : positional;
    const options: AttachOptions = {
      path: str(flags, 'path'),
      token: str(flags, 'token'),
      persist: str(flags, 'persist'),
      otlp: str(flags, 'otlp'),
      bodies: flags.bodies === true,
      force: flags.force === true,
    };
    return attach(command2, options);
  }

  if (command === 'dashboard') {
    const services: ServiceTarget[] = positional.map(parseTarget);
    if (services.length === 0)
      throw new Error('give at least one service, e.g. api=http://127.0.0.1:3000');
    const port = str(flags, 'port');
    const dashboard = await startDashboard({ services, port: port ? Number(port) : undefined });
    console.log(`[nodeui] dashboard: http://127.0.0.1:${dashboard.port}/`);
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
    await dashboard.close();
    return 0;
  }

  if (command === 'mcp') {
    const services: ServiceTarget[] = positional.map(parseTarget);
    if (services.length === 0)
      throw new Error('give at least one console URL, e.g. http://127.0.0.1:3000');
    await serveMcp({ services }).done;
    return 0;
  }

  console.error(`unknown command "${command}"\n\n${HELP}`);
  return 1;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(`nodeui: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
