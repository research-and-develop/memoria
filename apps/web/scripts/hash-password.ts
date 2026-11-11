/**
 * Make the admin password hash for the ADMIN_PASSWORD_HASH secret.
 *
 *   npm run admin:hash-password                 prompts twice (nothing is echoed)
 *   npm run admin:hash-password -- --generate   makes a strong password and prints both
 *   npm run admin:hash-password -- --iterations 20000
 *
 * Then: cd apps/web && npx wrangler secret put ADMIN_PASSWORD_HASH  (paste the hash)
 * The password never leaves this machine; only the hash goes to Cloudflare.
 */
import { generatePassword } from '@/lib/auth/generatePassword';
import { DEFAULT_ITERATIONS, MAX_ITERATIONS, hashPassword } from '@/lib/auth/password';

const MIN_LENGTH = 16;

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('Run this in a terminal (it reads the password without echoing it), or use --generate.'));
      return;
    }
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          // Leave the terminal as we found it: a raw-mode shell echoes nothing.
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const iterationsArg = args.indexOf('--iterations');
  const iterations = iterationsArg >= 0 ? Number(args[iterationsArg + 1]) : DEFAULT_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < 1_000 || iterations > MAX_ITERATIONS) {
    throw new Error(`--iterations must be an integer 1000–${MAX_ITERATIONS}`);
  }
  let password: string;
  if (args.includes('--generate')) {
    password = generatePassword();
    console.log(`\nPassword (store it in a password manager, it is shown only now):\n\n  ${password}\n`);
  } else {
    password = await promptHidden('New admin password: ');
    if (password.length < MIN_LENGTH) throw new Error(`Use at least ${MIN_LENGTH} characters (or --generate).`);
    if ((await promptHidden('Repeat it: ')) !== password) throw new Error('The two passwords differ.');
  }
  const hash = await hashPassword(password, iterations);
  console.log(`ADMIN_PASSWORD_HASH (paste into \`npx wrangler secret put ADMIN_PASSWORD_HASH\`, or .dev.vars locally):\n\n${hash}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
