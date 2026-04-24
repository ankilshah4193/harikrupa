#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import net from 'node:net';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { pipeline, cos_sim } from '@xenova/transformers';
import Groq from 'groq-sdk';
import { createRequire } from 'module';

// File System Setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const pkg = require('./package.json');
const DB_PATH = path.join(__dirname, 'data', 'verse_embeddings.json');
const CONFIG_PATH = path.join(os.homedir(), '.harikrupa.json');

// Helper to title-case a language name (e.g., "gujarati" -> "Gujarati", "SPANISH" -> "Spanish")
const toTitleCase = (str) => {
  if (!str) return str;
  return str
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// Native-script names for common languages. Used to render the section header
// in the user's own script (e.g., "### ગુજરાતી દ્રષ્ટિકોણ" instead of "### Gujarati Perspective").
// If a language isn't in this map, we fall back to the English name and also ask
// the LLM (in the prompt) to use the native script in its own heading.
const NATIVE_LANG_NAMES = {
  'gujarati': 'ગુજરાતી દ્રષ્ટિકોણ',
  'hindi': 'हिंदी दृष्टिकोण',
  'marathi': 'मराठी दृष्टिकोन',
  'bengali': 'বাংলা দৃষ্টিকোণ',
  'tamil': 'தமிழ் பார்வை',
  'telugu': 'తెలుగు దృక్కోణం',
  'kannada': 'ಕನ್ನಡ ದೃಷ್ಟಿಕೋನ',
  'malayalam': 'മലയാളം കാഴ്ചപ്പാട്',
  'punjabi': 'ਪੰਜਾਬੀ ਦ੍ਰਿਸ਼ਟੀਕੋਣ',
  'sanskrit': 'संस्कृत दृष्टिकोणम्',
  'urdu': 'اردو نقطہ نظر',
  'arabic': 'المنظور العربي',
  'spanish': 'Perspectiva en Español',
  'french': 'Perspective Française',
  'german': 'Deutsche Perspektive',
  'italian': 'Prospettiva Italiana',
  'portuguese': 'Perspectiva em Português',
  'russian': 'Русская перспектива',
  'japanese': '日本語の視点',
  'chinese': '中文视角',
  'korean': '한국어 관점',
  'english': 'English Perspective',
};

// Returns the section heading for the preferred language along with a flag
// indicating whether the heading is already in that language's native script.
// - If the language is in NATIVE_LANG_NAMES  -> { heading: "<native script>", isNative: true }
//   (use verbatim; do not re-translate)
// - Otherwise                                -> { heading: "<Lang> Perspective", isNative: false }
//   (caller should ask the LLM to translate the heading into the native script of that language)
const getNativePerspectiveHeading = (language) => {
  const key = (language || '').toLowerCase().trim();
  if (NATIVE_LANG_NAMES[key]) {
    return { heading: NATIVE_LANG_NAMES[key], isNative: true };
  }
  return { heading: `${toTitleCase(language)} Perspective`, isNative: false };
};

// Helper for interactive setup
const ask = (question) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(chalk.cyan(question), ans => {
    rl.close();
    resolve(ans);
  }));
};

// Helper to open URLs cross-platform
const openBrowser = (url) => {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${command} ${url}`, () => { });
};

const GROQ_KEYS_URL = 'https://console.groq.com/keys';

// Interactive "press ENTER → open browser → paste key → validate" flow.
// Shared by the onboarding wizard and `harikrupa --key` (invoked with no value).
// Returns the cleaned key on success, or null if the user typed an invalid key.
const promptForGroqKey = async () => {
  console.log(chalk.yellow.bold("Get your FREE API key from Groq (no credit card required!)"));
  console.log(chalk.white("Key page: ") + chalk.blue.underline(GROQ_KEYS_URL) + "\n");

  let userKey = await ask(chalk.white("Press ENTER to open it in your browser (or paste the key directly): "));

  if (userKey.trim() === '') {
    openBrowser(GROQ_KEYS_URL);
    userKey = await ask(chalk.cyan("\nPaste your API key here (starts with 'gsk_'): "));
  }

  const cleanKey = userKey.trim();
  if (!cleanKey.startsWith('gsk_')) {
    console.log(chalk.red('\n❌ That does not look like a valid Groq API key (expected it to start with "gsk_").'));
    console.log(chalk.white('Generate a new one at: ') + chalk.blue.underline(GROQ_KEYS_URL));
    console.log(chalk.white('Then run: ') + chalk.cyan('harikrupa --key "your_new_key_here"') + '\n');
    return null;
  }
  return cleanKey;
};

// Classifies an error and prints tailored, actionable guidance.
// Always sets process.exitCode = 1 so the shell knows the command failed.
//
// Categories:
//   auth     → Groq rejected the key (401/403, "Invalid API Key", etc.)
//   rate     → Groq rate-limited us (429)
//   network  → DNS / fetch / ECONN... (can't reach Groq)
//   db       → Local embedding DB missing, corrupt, or empty
//   model    → @xenova/transformers failed (usually first-run download issues)
//   empty    → Groq returned an empty response body
//   unknown  → everything else
const classifyError = (error) => {
  const msg = (error?.message || String(error)).toLowerCase();
  const status = error?.status ?? error?.response?.status;

  if (status === 401 || status === 403 || msg.includes('invalid api key') || msg.includes('unauthorized')) return 'auth';
  if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) return 'rate';
  if (msg.includes('enotfound') || msg.includes('econnrefused') || msg.includes('econnreset') ||
    msg.includes('etimedout') || msg.includes('fetch failed') || msg.includes('network')) return 'network';
  if (msg.includes('local database') || msg.includes('verse_embeddings') ||
    msg.includes('unexpected token') && msg.includes('json')) return 'db';
  if (msg.includes('xenova') || msg.includes('transformers') || msg.includes('onnxruntime') ||
    msg.includes('model') && msg.includes('download')) return 'model';
  if (msg.includes('empty response') || msg.includes('no content')) return 'empty';
  return 'unknown';
};

// Errors for which we can still deliver the verse locally (just without AI commentary).
// For these, we print a warning, render the verse, and exit cleanly (exit code 0).
// For everything else, we bail out via reportError with a non-zero exit code.
const VERSE_RECOVERABLE = new Set(['auth', 'rate', 'network', 'empty']);

const reportError = (error, { verbose = false } = {}) => {
  process.exitCode = 1;
  const category = classifyError(error);

  // Ordered so related guidance reads together: headline → explanation → fix.
  switch (category) {
    case 'auth':
      console.log(chalk.red('\n❌ Your Groq API key was rejected.'));
      console.log(chalk.white('The key is likely invalid, expired, or has been revoked.\n'));
      console.log(chalk.yellow.bold('What to do:'));
      console.log(chalk.white('  1. Generate a new free key: ') + chalk.blue.underline(GROQ_KEYS_URL));
      console.log(chalk.white('  2. Save it: ') + chalk.cyan('harikrupa --key "gsk_..."'));
      console.log(chalk.white('     ') + chalk.dim('…or just run ') + chalk.cyan('harikrupa --key') + chalk.dim(' and we will walk you through it.\n'));
      break;

    case 'rate':
      console.log(chalk.red('\n❌ Groq is rate-limiting this key right now.'));
      console.log(chalk.white('You have sent a lot of requests in a short window. Wait a minute and try again.\n'));
      console.log(chalk.dim('If this keeps happening, check your usage at ') + chalk.blue.underline('https://console.groq.com/settings/limits\n'));
      break;

    case 'network':
      console.log(chalk.red('\n❌ Cannot reach Groq.'));
      console.log(chalk.white('Looks like a network issue. A few things to check:\n'));
      console.log(chalk.white('  • Internet connection is live'));
      console.log(chalk.white('  • No VPN / corporate firewall blocking ') + chalk.dim('api.groq.com'));
      console.log(chalk.white('  • ') + chalk.dim('https://status.groq.com') + chalk.white(' is green'));
      console.log(chalk.dim('\nTip: Harikrupa also works offline — you will get the verse, just without the AI commentary.\n'));
      break;

    case 'db':
      console.log(chalk.red('\n❌ Local verse database is missing or corrupt.'));
      console.log(chalk.white('This file ships with the package, so something went wrong during install.\n'));
      console.log(chalk.yellow.bold('Fix it by reinstalling:'));
      console.log(chalk.cyan('  npm uninstall -g harikrupa'));
      console.log(chalk.cyan('  npm install -g harikrupa\n'));
      console.log(chalk.dim('If the problem continues, please open an issue: ') + chalk.blue.underline('https://github.com/ankilshah4193/harikrupa/issues') + '\n');
      break;

    case 'model':
      console.log(chalk.red('\n❌ The local AI model failed to load.'));
      console.log(chalk.white('On first run, Harikrupa downloads a tiny (~25 MB) embedding model to your cache.\n'));
      console.log(chalk.yellow.bold('What to try:'));
      console.log(chalk.white('  • Make sure you have an internet connection for the initial download'));
      console.log(chalk.white('  • Clear the cache and retry: ') + chalk.cyan('rm -rf ~/.cache/huggingface'));
      console.log(chalk.white('  • Or use: ') + chalk.cyan('harikrupa random') + chalk.dim(' — it skips the model entirely.\n'));
      break;

    case 'empty':
      console.log(chalk.red('\n❌ Groq returned an empty response.'));
      console.log(chalk.white('This is unusual — usually a transient hiccup on their end. Try again in a moment.\n'));
      break;

    default:
      console.log(chalk.red('\n❌ Something went wrong:'));
      console.log(chalk.white('  ' + (error?.message || String(error))) + '\n');
      console.log(chalk.dim('If this keeps happening, please open an issue with the message above:'));
      console.log(chalk.dim('  ') + chalk.blue.underline('https://github.com/ankilshah4193/harikrupa/issues') + '\n');
      break;
  }

  if (verbose && error?.stack) {
    console.log(chalk.dim('\n--- stack trace ---'));
    console.log(chalk.dim(error.stack));
  }
};

// Helper to check internet connection.
// Uses a TCP probe to Cloudflare DNS (1.1.1.1:53) rather than a DNS hostname lookup:
//   - Works in regions where Google is blocked.
//   - TCP reachability is a stronger signal than DNS resolution (which can return
//     cached results even when actually offline).
//   - No external dependencies, uses Node's built-in `net` module.
// Capped at 1500ms so a flaky network doesn't stall the CLI.
const isOnline = (timeoutMs = 1500) => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(53, '1.1.1.1');
  });
};

// Shared renderer for the "verse only" path.
// Called in three scenarios:
//   1. User is offline (no network at all).
//   2. Groq call failed with a recoverable error (rate limit, auth, transient network, empty response).
//   3. User ran `harikrupa random` and we skipped the Groq call for brevity (future use).
//
// The `reason` parameter controls the warning banner so the user knows why AI commentary
// is disabled this time. The verse itself is always shown from the local database.
const renderVerseOnly = (matchedVerse, prefLang, reason = 'offline') => {
  const gold = chalk.hex('#FFD700').bold;
  const subTitleColor = chalk.cyanBright.bold;
  const bodyText = chalk.white.dim;

  // Banner message for each reason. Keep these short, friendly, and honest.
  const banners = {
    offline: '⚠️  No Internet Connection Detected.',
    rate: '⚠️  Groq is rate-limiting this key right now.',
    auth: '⚠️  Groq rejected the API key.',
    network: '⚠️  Cannot reach Groq right now.',
    empty: '⚠️  Groq returned an empty response.',
  };
  const explanations = {
    offline: 'Harikrupa is running in Offline Mode. AI mentor commentary is disabled, but here is your guiding verse:',
    rate: 'AI mentor commentary is disabled for this request. Here is your guiding verse from the local database:',
    auth: 'AI mentor commentary is disabled until the key is updated. Here is your guiding verse from the local database:',
    network: 'AI mentor commentary is disabled for this request. Here is your guiding verse from the local database:',
    empty: 'AI mentor commentary is unavailable for this request. Here is your guiding verse from the local database:',
  };

  console.log(chalk.yellow(banners[reason] || banners.offline));
  console.log(bodyText((explanations[reason] || explanations.offline) + '\n'));

  console.log(gold(`Wisdom from Srimad Bhagavad Gita: Chapter ${matchedVerse.chapter}, Verse ${matchedVerse.verse}`));
  console.log(chalk.white("--------------------------------------------------"));
  console.log(subTitleColor("Sanskrit Verse:"));
  console.log(bodyText(matchedVerse.sanskrit_verse));

  const localLangKey = prefLang.toLowerCase();
  // `matchedVerse` no longer carries the embedding, so we only need to exclude metadata keys.
  const excludedKeys = ['chapter', 'verse', 'sanskrit_verse'];
  const availableLangs = Object.keys(matchedVerse)
    .filter(key => !excludedKeys.includes(key))
    .map(toTitleCase);

  if (localLangKey !== 'english') {
    console.log(subTitleColor(`\n${prefLang} Meaning:`));
    if (matchedVerse[localLangKey]) {
      console.log(bodyText(matchedVerse[localLangKey]));
    } else {
      console.log(chalk.yellow(`⚠️ Local Translation Unavailable for ${prefLang}`));
      console.log(bodyText(`The local database currently has pre-downloaded translations for: ${availableLangs.join(', ')}.`));
      console.log(bodyText(`(Once AI commentary is available again, the verse will be dynamically translated into ${prefLang}.)`));
    }
  }

  console.log(subTitleColor("\nEnglish Meaning:"));
  console.log(bodyText(matchedVerse.english));
  console.log(chalk.white("--------------------------------------------------"));

  // Tailored fix-it hint at the bottom so the user knows exactly what to do next.
  const hints = {
    rate: `\nFix: wait a minute and try again. Check usage at ${chalk.blue.underline('https://console.groq.com/settings/limits')}\n`,
    auth: `\nFix: run ${chalk.cyan('harikrupa --key')} to set a new free Groq API key (no credit card needed).\n`,
    network: `\nFix: check your connection, VPN, or firewall. You can always try again in a moment.\n`,
    empty: `\nFix: try again in a moment — this is usually a transient hiccup on Groq's end.\n`,
    offline: '\n',
  };
  console.log(chalk.dim(hints[reason] || hints.offline));
};

program
  .version(pkg.version)
  .description('Ancient wisdom for the modern era (English + Preferred Language).')
  .argument('[cmd]', 'Run a specific command (e.g., "random")')
  .option('-t, --topic <query>', 'Ask your life question in English')
  .option('--lang <language>', 'Change your preferred language preference')
  .option('--key [key]', 'Update your Groq API key (omit value to open browser)')
  .action(async (cmd, options) => {

    // --- 1. LOAD CONFIGURATION ---
    let config = { GROQ_API_KEY: null, PREFERRED_LANGUAGE: null };
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      } catch (e) {
        // Don't silently swallow: tell the user so they aren't confused when the wizard re-runs.
        console.log(chalk.yellow(`\n⚠️  Your config file appears to be corrupt: ${CONFIG_PATH}`));
        console.log(chalk.white('Resetting it and restarting the setup wizard...\n'));
        config = { GROQ_API_KEY: null, PREFERRED_LANGUAGE: null };
      }
    }

    // --- 2. UPDATE LANGUAGE PREFERENCE ---
    if (options.lang) {
      // Normalize to title case so "gujarati" / "GUJARATI" both become "Gujarati"
      config.PREFERRED_LANGUAGE = toTitleCase(options.lang.trim());
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
      console.log(chalk.green(`\n✅ Language preference updated to: ${config.PREFERRED_LANGUAGE}`));
      console.log(chalk.white("Now run your query to see the change.\n"));
      return;
    }

    // --- 3. SET OR UPDATE API KEY ---
    // `--key gsk_...` supplies a value (options.key is the string).
    // `--key` alone supplies no value (options.key is `true` per Commander's convention).
    // In the latter case, walk the user through the same "open browser → paste" flow the wizard uses.
    if (options.key !== undefined) {
      let cleanKey;

      if (options.key === true || String(options.key).trim() === '') {
        console.log(chalk.green.bold("\n🔑 Update Groq API Key\n"));
        cleanKey = await promptForGroqKey();
        if (!cleanKey) { process.exitCode = 1; return; } // helper already printed guidance
      } else {
        cleanKey = String(options.key).trim();
        if (!cleanKey.startsWith('gsk_')) {
          console.log(chalk.red('\n❌ That does not look like a valid Groq API key.'));
          console.log(chalk.white('Valid keys start with "gsk_". Generate one at: ') + chalk.blue.underline(GROQ_KEYS_URL));
          console.log(chalk.white('Or run ') + chalk.cyan('harikrupa --key') + chalk.white(' with no value to open the browser for you.\n'));
          process.exitCode = 1;
          return;
        }
      }

      config.GROQ_API_KEY = cleanKey;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
      console.log(chalk.green(`\n✅ API key updated successfully.\n`));
      return;
    }

    // --- 4. ONBOARDING WIZARD ---
    if (!config.GROQ_API_KEY || !config.PREFERRED_LANGUAGE) {
      console.log(chalk.green.bold("\n🌟 Welcome to Harikrupa Setup Wizard"));
      console.log(chalk.white("Let's get you connected to the Srimad Bhagavad Gita in 2 quick steps.\n"));

      if (!config.GROQ_API_KEY) {
        console.log(chalk.yellow.bold("Step 1 of 2:"));
        const cleanKey = await promptForGroqKey();
        if (!cleanKey) { process.exitCode = 1; return; } // helper already printed guidance
        config.GROQ_API_KEY = cleanKey;
      }

      if (!config.PREFERRED_LANGUAGE) {
        console.log("");
        const userLang = await ask("Step 2 of 2: What is your preferred language for the answers? (e.g., Gujarati, Hindi, Spanish): ");
        config.PREFERRED_LANGUAGE = toTitleCase(userLang.trim()) || 'English';
      }

      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
      console.log(chalk.green("\n✅ Setup Complete! All settings saved."));
      console.log(chalk.white("Now try: ") + chalk.cyan('harikrupa -t "I feel overwhelmed"') + "\n");
      return;
    }

    // --- 5. INPUT VALIDATION & HELP MENU ---
    const isRandomMode = cmd === 'random';
    // Title-case on load so older configs saved with lowercase still render correctly.
    const prefLang = toTitleCase(config.PREFERRED_LANGUAGE) || 'English';

    // If they didn't provide a topic AND they didn't type "random", show the help menu.
    if (!options.topic && !isRandomMode) {
      const label = chalk.cyan;           // command text
      const hint = chalk.white.dim;      // description text
      const head = chalk.yellow.bold;    // section headers
      const rule = chalk.white.dim('─'.repeat(54));

      // Small helper to keep columns aligned regardless of command length.
      // COL is sized to fit the longest command (~32 chars) plus a 2-space gutter.
      const COL = 34;
      const row = (cmdStr, desc) => '  ' + label(cmdStr.padEnd(COL)) + hint(desc);

      console.log();
      console.log(chalk.yellow.bold('🕉️  Harikrupa') + chalk.white.dim('  ·  Ancient wisdom for the modern era'));
      console.log(rule);

      console.log(head('\nASK'));
      console.log(row('harikrupa -t "<question>"', 'Get guidance for your situation'));
      console.log(row('harikrupa random', 'Draw a random verse of the day'));

      console.log(head('\nSETTINGS'));
      console.log(row('harikrupa --lang "<language>"', 'Change your output language'));
      console.log(row('harikrupa --key "gsk_..."', 'Update your Groq API key'));
      console.log(row('harikrupa --key', '…or set one interactively (opens browser)'));
      console.log(row('harikrupa --version', 'Show the installed version'));

      console.log(head('\nEXAMPLES'));
      console.log(row('harikrupa -t "I feel burnt out"', ''));
      console.log(row('harikrupa -t "afraid of failing"', ''));
      console.log(row('harikrupa --lang "Gujarati"', ''));

      console.log(head('\nCURRENT SETUP'));
      console.log('  ' + hint('Language : ') + chalk.white(prefLang));
      console.log('  ' + hint('API key  : ') + chalk.white(config.GROQ_API_KEY ? 'configured ✓' : 'not set'));

      console.log(chalk.white.dim('\nFree Groq API key (no credit card): ') + chalk.blue.underline('https://console.groq.com/keys'));
      console.log();
      return;
    }

    if (isRandomMode) {
      console.log(chalk.blue(`\nDrawing a random verse of the day in English & ${prefLang}...\n`));
    } else {
      console.log(chalk.blue(`\nReflecting on your situation in English & ${prefLang}...\n`));
    }

    // Reject empty topics early with a clear message — otherwise the embedding pipeline
    // runs on an empty string and produces a meaningless best-match.
    if (!isRandomMode && options.topic !== undefined && options.topic.trim() === '') {
      console.log(chalk.red('\n❌ Your question is empty.'));
      console.log(chalk.white('Try something like: ') + chalk.cyan('harikrupa -t "I feel overwhelmed by this release"') + '\n');
      process.exitCode = 1;
      return;
    }

    try {
      // --- 6. DB LOAD & VERSE SELECTION ---
      if (!fs.existsSync(DB_PATH)) {
        throw new Error("Local database missing at " + DB_PATH);
      }

      let verses;
      try {
        verses = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      } catch (e) {
        throw new Error("Local database file is corrupt (verse_embeddings.json could not be parsed)");
      }
      if (!Array.isArray(verses) || verses.length === 0) {
        throw new Error("Local database is empty — no verses to choose from");
      }

      let bestMatch = null;

      // If 'random', just grab a random array index. Otherwise, do the math!
      if (isRandomMode) {
        const randomIndex = Math.floor(Math.random() * verses.length);
        bestMatch = verses[randomIndex];
      } else {
        const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        const queryOutput = await extractor(options.topic, { pooling: 'mean', normalize: true });
        const queryVector = queryOutput.tolist()[0];

        let highestScore = -1;
        for (const verse of verses) {
          const score = cos_sim(queryVector, verse.embedding);
          if (score > highestScore) {
            highestScore = score;
            bestMatch = verse;
          }
        }

        const MIN_THRESHOLD = 0.25;
        if (highestScore < MIN_THRESHOLD) {
          bestMatch = verses.find(v => String(v.chapter) === "18" && String(v.verse) === "66") || verses[0];
        }
      }

      if (!bestMatch) throw new Error("Could not find a relevant verse.");

      // Strip the 384-dim embedding vector before any downstream use:
      // it's only needed for the similarity math above, and keeping it would
      // pollute any log / JSON.stringify / future prompt-context that includes bestMatch.
      const { embedding: _embedding, ...matchedVerse } = bestMatch;

      const gold = chalk.hex('#FFD700').bold;
      const subTitleColor = chalk.cyanBright.bold;
      const bodyText = chalk.white.dim;

      // --- OFFLINE FALLBACK CHECK ---
      // If we're fully offline, skip Groq entirely and render the verse from local data.
      const online = await isOnline();
      if (!online) {
        renderVerseOnly(matchedVerse, prefLang, 'offline');
        return;
      }

      // --- 7. GROQ BILINGUAL MENTOR PROMPT ---
      // Even though we're online, Groq itself may reject the request (rate limit, auth, etc.).
      // We wrap the call in its own try/catch so we can fall back to the local verse
      // renderer for any *recoverable* failure, while still surfacing unrecoverable
      // failures (like a corrupt DB) to the outer handler.
      const groq = new Groq({ apiKey: config.GROQ_API_KEY });

      // Determine what to tell the AI based on the mode
      const simulatedUserInput = isRandomMode
        ? "I would like a random verse of the day for general grounding and reflection."
        : `"${options.topic}"`;

      const empathyInstructions = isRandomMode
        ? "[Open with 2-3 grounding sentences for the day, written directly to the reader. Do not use a header for this — it should read as the natural opening of the section, not a labeled subheader. Do not reference a specific struggle.]"
        : "[Open with 2-3 sentences acknowledging the reader's specific situation, written directly to them. Do not use a header for this — it should read as the natural opening of the section, not a labeled subheader.]";

      // Resolve the second section's heading.
      // Mapped languages (Gujarati, Hindi, Spanish, ...) come back in native script and are used verbatim.
      // Unmapped languages come back as "<Lang> Perspective" (English fallback) and the LLM is instructed
      // below to translate that heading into the native script of that language.
      const { heading: secondHeading, isNative: headingIsNative } = getNativePerspectiveHeading(prefLang);

      // Heading instruction differs depending on whether we can provide the native-script form ourselves.
      const headingInstruction = headingIsNative
        ? `The second heading "### ${secondHeading}" is already written in the native script of ${prefLang}. Use it EXACTLY as given. Do not translate, romanize, rewrite, or append any English words (including "Perspective") to it.`
        : `The second heading "### ${secondHeading}" is currently in English as a placeholder. Replace it with the equivalent phrase in the native script of ${prefLang} (meaning "${prefLang} Perspective" translated into ${prefLang}'s own script). If ${prefLang} is typically written in Latin script, keep the phrase in ${prefLang} but in Latin script. Use the translated heading consistently in BOTH places where the "${secondHeading}" heading appears below.`;

      const systemPrompt = `
        You are a linguistic scholar, a philosopher, a Hindu spiritual saint, and a Hindu spiritual guru with profound knowledge of the Srimad Bhagavad Gita.
        
        User Input: ${simulatedUserInput}
        Most Relevant Verse: Chapter ${matchedVerse.chapter}, Verse ${matchedVerse.verse}
        Sanskrit Original: ${matchedVerse.sanskrit_verse}
        
        YOUR TASK:
        Divide your response into two exact sections: "### English Perspective" and "### ${secondHeading}".
        ${headingInstruction}
        
        Under "### English Perspective":
        **Sanskrit Verse:** Provide the original Sanskrit verse text.
        **Transliteration (IAST):** Provide the phonetic transliteration in IAST.
        **Translation (English):** Provide ONLY the English translation of the verse — no commentary.
        ${empathyInstructions}
        **Connection:** Place this verse in its context within the Srimad Bhagavad Gita and explain what spiritual question it speaks to. Address the reader as "you." (2-3 sentences)
        **Practical Wisdom:** Translate the verse's teaching into a concrete cognitive reframe the reader can apply today. Address them as "you." (2-3 sentences)
        **Next Action:** Suggest one small, specific thing the reader can do in the next 24 hours that embodies the verse's wisdom. Address them as "you." (2-3 sentences)
        
        Under the second section heading:
        Translate ALL the subheaders themselves into ${prefLang} (e.g., **Verso en Sánscrito:**, **Conexión:**, etc.). Do not add a header for the opening acknowledgment paragraph — it has no header in the English section either.
        1. Provide the Sanskrit under the translated Sanskrit subheader.
        2. Provide the Transliteration under the translated Transliteration subheader.
        3. Provide ONLY the ${prefLang} translation of the verse under the translated Translation subheader.
        4. Provide the fully translated commentary sections under their respective translated subheaders, including the unlabeled opening acknowledgment paragraph.
        
        STRICT RULES:
        - Do not cross translations: no English commentary in the ${prefLang} section, and no ${prefLang} commentary in the English section.
        - Every subheader must be wrapped in double asterisks like **This**.
        - The English heading must stay EXACTLY as "### English Perspective".
        - The opening acknowledgment paragraph MUST NOT have a header. Start the section with the paragraph itself, then move to **Sanskrit Verse:**. Same structure in the second-language section.
        - Do not include any [bracketed instructions] from this prompt in your output.
        - Do not begin Connection, Practical Wisdom, or Next Action with "This verse..." — begin with the spiritual concept itself.
        - Do NOT use em-dashes (—) anywhere in your response. Use commas, colons, or periods instead.
        - Keep the language simple and avoid complex vocabulary.
        `;

      let rawResponse;
      try {
        const chatCompletion = await groq.chat.completions.create({
          messages: [{ role: 'system', content: systemPrompt }],
          model: 'openai/gpt-oss-120b',
          temperature: 0.5,
        });

        rawResponse = (chatCompletion.choices?.[0]?.message?.content || '').trim();
        if (!rawResponse) {
          throw new Error('Groq returned an empty response (no content)');
        }
      } catch (groqError) {
        // If this is a recoverable error (rate limit, auth, transient network, empty), we still
        // deliver the verse from local data rather than leaving the user with nothing. The tool
        // exits cleanly (exit code 0) since the core wisdom was delivered. The banner explains
        // why AI commentary is disabled and the bottom hint tells them how to fix it.
        const category = classifyError(groqError);
        if (VERSE_RECOVERABLE.has(category)) {
          renderVerseOnly(matchedVerse, prefLang, category);
          return;
        }
        // Otherwise, rethrow so the outer handler reports it as a hard failure.
        throw groqError;
      }

      // --- 8. FINAL OUTPUT ---
      console.log(gold(`Wisdom from Srimad Bhagavad Gita: Chapter ${matchedVerse.chapter}, Verse ${matchedVerse.verse}`));
      console.log(chalk.white("--------------------------------------------------\n"));

      let coloredResponse = rawResponse.split('\n').map(line => {
        if (line.match(/^###\s+/)) {
          return gold(line);
        }

        if (line.trim() === '') {
          return line;
        }

        if (line.match(/\*\*(.*?)\*\*/)) {
          let parts = line.split(/(\*\*.*?\*\*)/g);
          return parts.map(part => {
            if (part.startsWith('**') && part.endsWith('**')) {
              const cleanText = part.replace(/\*\*/g, '');
              return subTitleColor(cleanText);
            } else if (part.trim() !== '') {
              return bodyText(part);
            }
            return part;
          }).join('');
        }

        return bodyText(line);
      }).join('\n');

      console.log(coloredResponse);

      console.log(chalk.white("\n--------------------------------------------------\n"));

    } catch (error) {
      // All error classification and actionable guidance lives in reportError.
      // Set DEBUG=harikrupa in the environment to also see the stack trace.
      reportError(error, { verbose: process.env.DEBUG === 'harikrupa' });
    }
  });

program.parse(process.argv);
