/**
 * Load .env before anything reads process.env.
 *
 * Uses Node's built-in loader (20.6+) rather than a dependency. Import this
 * first in any entry point — module side effects run in import order, and the
 * llm config module reads env at import time.
 *
 * Two files, in Next.js's precedence order:
 *
 *   .env.local   machine-local and pulled from Vercel (`vercel env pull`).
 *                Holds the Redis credentials. Never committed.
 *   .env         the checked-in-shaped defaults.
 *
 * `.env.local` is loaded FIRST on purpose. Node's loader does not overwrite a
 * variable that is already set, so first-loaded wins — which is the opposite of
 * the intuition, and exactly the kind of thing that silently leaves scripts
 * talking to the wrong store while Next.js talks to the right one.
 */
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // A missing file is fine — real environment variables may already be set,
    // which is the normal case on Vercel.
  }
}

export {};
