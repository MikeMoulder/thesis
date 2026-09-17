/**
 * Point Telegram at a deployment, or look at where it is currently pointed.
 *
 *   npm run tg:webhook                                   show current state
 *   npm run tg:webhook -- https://your-app.vercel.app    set it
 *   npm run tg:webhook -- --delete                       unhook the bot
 *
 * A bot has exactly ONE webhook. Setting it here takes delivery away from
 * wherever it was pointed before, which matters because a preview deployment
 * and production are different URLs and only one of them can be receiving.
 * That is the most common way this gets confusing: the bot works, the code
 * works, and the messages are going to a deployment nobody is looking at.
 */
import '../env';

import { deleteWebhook, getWebhookInfo, setWebhook } from '../telegram/client';

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(18)} ${value}`);
}

async function show(): Promise<void> {
  const info = await getWebhookInfo();
  if (!info.ok) {
    console.log(`\n  x could not read webhook info: ${info.error}\n`);
    process.exit(1);
  }
  console.log('\nwebhook');
  line('url', info.value.url || 'NOT SET');
  line('pending', String(info.value.pending_update_count));
  if (info.value.last_error_message) {
    const when = info.value.last_error_date
      ? new Date(info.value.last_error_date * 1000).toISOString()
      : 'unknown';
    line('last error', `${info.value.last_error_message} (${when})`);
  }
  console.log();
}

async function main(): Promise<void> {
  const arg = process.argv[2];

  if (!arg) {
    await show();
    console.log('  Pass a deployment URL to point the bot at it.\n');
    return;
  }

  if (arg === '--delete') {
    const gone = await deleteWebhook();
    if (!gone.ok) {
      console.log(`\n  x could not delete the webhook: ${gone.error}\n`);
      process.exit(1);
    }
    console.log('\n  OK  Webhook deleted. The bot now receives nothing.\n');
    return;
  }

  const secret = process.env.TG_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.log(
      '\n  x TG_WEBHOOK_SECRET is not set.\n' +
        '    It is the only thing separating real Telegram traffic from anyone\n' +
        '    who guesses the webhook path. Generate one with:\n' +
        "      node -e \"console.log(require('crypto').randomBytes(24).toString('base64url'))\"\n",
    );
    process.exit(1);
  }

  let base: URL;
  try {
    base = new URL(arg);
  } catch {
    console.log(`\n  x "${arg}" is not a URL.\n`);
    process.exit(1);
  }

  if (base.protocol !== 'https:') {
    // Telegram refuses plain HTTP outright, and the error it returns does not
    // say so clearly.
    console.log('\n  x Telegram only delivers to https. A localhost URL will not work.\n');
    process.exit(1);
  }

  const url = `${base.origin}/api/telegram/webhook`;
  const set = await setWebhook(url, secret);

  if (!set.ok) {
    console.log(`\n  x Telegram refused the webhook: ${set.error}\n`);
    process.exit(1);
  }

  console.log(`\n  OK  Webhook set to ${url}`);
  console.log('      Telegram will present TG_WEBHOOK_SECRET on every update.\n');
  console.log(
    '  ! The SAME secret must be set on the deployment, or every update is\n' +
      '    rejected with 401 and the bot appears to ignore everyone.\n',
  );

  await show();
}

main().catch((error) => {
  console.error(`\ntg:webhook failed: ${(error as Error).message}\n`);
  process.exit(1);
});
