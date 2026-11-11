import { spawnSync } from 'node:child_process';

const commands = {
  install: [[], ['--prefix', 'client'], ['--prefix', 'server']].map((prefix) => [...prefix, 'ci']),
  verify: [
    ['--prefix', 'client', 'run', 'lint'],
    ['--prefix', 'client', 'run', 'test:run'],
    ['--prefix', 'server', 'test'],
    ['--prefix', 'client', 'run', 'build'],
    ['run', 'check:routing'],
    ['run', 'check:api'],
  ],
};

const operation = process.argv[2];
if (!Object.hasOwn(commands, operation)) {
  throw new Error('Expected install or verify operation.');
}

for (const args of commands[operation]) {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(executable, args, {
    stdio: 'inherit',
    // Windows command shims require the command processor; arguments are fixed above.
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
