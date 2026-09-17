/**
 * Prove the Telegram credential is real and see what the bot looks like.
 *
 *   npm run tg:check
 *   npm run tg:check -- 123456789     also sends a test message to that chat
 *
 * Like memory:check, this one DOES hit the network on purpose. The self-tests
 * prove the logic; this proves the credential. A bot token that was revoked,
 * or pasted with a trailing newline, fails in exactly the same silent way as
 * a working one that nobody has bound a chat to yet.
 *
 * Prints the bot's identity and webhook state, never the token.
 */
import '../env';

import { botToken, getMe, getWebhookInfo, sendMessage, esc } from '../telegram/client';

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(20)} ${value}`);
}

function rule(label = ''): void {
  console.log(label ? `\n-- ${label} ${'-'.repeat(Math.max(0, 56 - label.length))}` : '-'.repeat(60));
}

async function main(): Promise<void> {
  console.log('\ntelegram');

  const token = botToken();
  line('TG_BOT_TOKEN', token ? 'set' : 'MISSING');

  if (!token) {
    console.log(
      '\n  x No token. Talk to @BotFather, send /newbot, and put the token in\n' +
        '    .env as TG_BOT_TOKEN. Nothing below can run without it.\n',
    );
    process.exit(1);
  }

  // A token pasted out of a chat window picks up whitespace surprisingly
  // often, and the resulting 404 says nothing about why.
  const shaped = /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token);
  line('shape', shaped ? 'looks like a bot token' : 'DOES NOT look like a bot token');

  const me = await getMe();
  if (!me.ok) {
    console.log(`\n  x Telegram rejected the token: ${me.error}`);
    console.log('    401 means it is wrong or was revoked. Ask @BotFather for it again.\n');
    process.exit(1);
  }

  rule('identity');
  line('id', String(me.value.id));
  line('username', `@${me.value.username ?? 'none'}`);
  line('name', me.value.first_name);

  rule('webhook');
  const hook = await getWebhookInfo();
  if (!hook.ok) {
    console.log(`  could not read webhook info: ${hook.error}`);
  } else if (!hook.value.url) {
    line('url', 'NOT SET');
    console.log(
      '\n  ! The bot has no webhook, so nothing anyone sends it will reach this\n' +
        '    app. Run: npm run tg:webhook -- https://your-deployment.vercel.app\n',
    );
  } else {
    line('url', hook.value.url);
    line('pending', String(hook.value.pending_update_count));
    if (hook.value.last_error_message) {
      const when = hook.value.last_error_date
        ? new Date(hook.value.last_error_date * 1000).toISOString()
        : 'unknown time';
      line('last error', `${hook.value.last_error_message} (${when})`);
      console.log(
        '\n  ! Telegram is failing to deliver to that URL. Usually the deployment\n' +
          '    moved, or Vercel Deployment Protection is on and returns a redirect.\n',
      );
    }
  }

  const chatId = process.argv[2];
  if (chatId) {
    rule('test send');
    const id = Number(chatId);
    if (!Number.isFinite(id)) {
      console.log(`  x "${chatId}" is not a chat id. It is a number, not a @username.\n`);
      process.exit(1);
    }
    const sent = await sendMessage(
      id,
      `<b>THESIS</b>\nCredential check at ${esc(new Date().toISOString())}.\nIf you can read this, delivery works.`,
      { silent: true },
    );
    if (!sent.ok) {
      console.log(`  x send failed: ${sent.error}`);
      console.log(
        '    403 means that chat has not started the bot. Open the bot in\n' +
          '    Telegram and press Start first.\n',
      );
      process.exit(1);
    }
    line('delivered', `message ${sent.value.message_id} to chat ${id}`);
  }

  console.log('\n  OK  The token is live and Telegram answers to it.\n');
}

main().catch((error) => {
  console.error(`\ntg:check failed: ${(error as Error).message}\n`);
  process.exit(1);
});
