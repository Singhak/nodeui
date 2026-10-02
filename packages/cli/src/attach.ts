import { spawn } from 'node:child_process';
import { join } from 'node:path';

export interface AttachOptions {
  path?: string;
  token?: string;
  persist?: string;
  otlp?: string;
  bodies?: boolean;
  /** Force-enable even when NODE_ENV=production. */
  force?: boolean;
}

/** `node --require` accepts quoted paths; forward slashes avoid backslash escapes on Windows. */
export function preloadPath(): string {
  return join(__dirname, 'preload.cjs').replace(/\\/g, '/');
}

/** Environment for the child process: the preload plus the NODEUI_* settings. */
export function attachEnv(
  base: NodeJS.ProcessEnv,
  options: AttachOptions,
  preload = preloadPath(),
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  env.NODE_OPTIONS = [base.NODE_OPTIONS, `--require "${preload}"`].filter(Boolean).join(' ');
  if (options.path) env.NODEUI_PATH = options.path;
  if (options.token) env.NODEUI_TOKEN = options.token;
  if (options.persist) env.NODEUI_PERSIST_FILE = options.persist;
  if (options.otlp) env.NODEUI_OTLP_ENDPOINT = options.otlp;
  if (options.bodies) env.NODEUI_CAPTURE_BODIES = 'true';
  if (options.force) env.NODEUI_ENABLED = 'true';
  return env;
}

/** Runs `command` with NodeUI preloaded; resolves with the child's exit code. */
export function attach(command: string[], options: AttachOptions): Promise<number> {
  const [cmd, ...args] = command;
  if (!cmd) return Promise.reject(new Error('nothing to run; usage: nodeui attach -- node app.js'));
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      env: attachEnv(process.env, options),
      shell: process.platform === 'win32',
    });
    const onInt = (): void => {
      child.kill('SIGINT');
    };
    const onTerm = (): void => {
      child.kill('SIGTERM');
    };
    const cleanup = (): void => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
    };
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    child.on('error', (err) => {
      cleanup();
      reject(err);
    });
    child.on('exit', (code, signal) => {
      cleanup();
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}
