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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'data', 'verse_embeddings.json');
const CONFIG_PATH = path.join(os.homedir(), '.harikrupa.json');

// Title-case a language name, handling multi-word inputs ("brazilian portuguese" -> "Brazilian Portuguese").
const toTitleCase = (str) => {
  if (!str) return str;
  return str
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// Native-script section headers keyed by lowercase language name. Languages not in this map
// fall back to "<Lang> Perspective" and the LLM is asked to translate the heading itself.
const NATIVE_LANG_NAMES = {
  'gujarati':   'ગુજરાતી દ્રષ્ટિકોણ',
  'hindi':      'हिंदी दृष्टिकोण',
  'marathi':    'मराठी दृष्टिकोन',
  'bengali':    'বাংলা দৃষ্টিকোণ',
  'tamil':      'தமிழ் பார்வை',
  'telugu':     'తెలుగు దృక్కోణం',
  'kannada':    'ಕನ್ನಡ ದೃಷ್ಟಿಕೋನ',
  'malayalam':  'മലയാളം കാഴ്ചപ്പാട്',
  'punjabi':    'ਪੰਜਾਬੀ ਦ੍ਰਿਸ਼ਟੀਕੋਣ',
  'sanskrit':   'संस्कृत दृष्टिकोणम्',
  'urdu':       'اردو نقطہ نظر',
  'arabic':     'المنظور العربي',
  'spanish':    'Perspectiva en Español',
  'french':     'Perspective Française',
  'german':     'Deutsche Perspektive',
  'italian':    'Prospettiva Italiana',
  'portuguese': 'Perspectiva em Português',
  'russian':    'Русская перспектива',
  'japanese':   '日本語の視点',
  'chinese':    '中文视角',
  'korean':     '한국어 관점',
  'english':    'English Perspective',
};

// Returns the section heading for the user's language and whether it's already in native script.
// When isNative is false, the caller asks the LLM to translate the fallback heading.
const getNativePerspectiveHeading = (language) => {
  const key = (language || '').toLowerCase().trim();
  if (NATIVE_LANG_NAMES[key]) {
    return { heading: NATIVE_LANG_NAMES[key], isNative: true };
  }
  return { heading: `${toTitleCase(language)} Perspective`, isNative: false };
};

const ask = (question) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(chalk.cyan(question), ans => {
    rl.close();
    resolve(ans);
  }));
};

const openBrowser = (url) => {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${command} ${url}`, () => { });
};

const GROQ_KEYS_URL = 'https://console.groq.com/keys';

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

const reportError = (error, { verbose = false } = {}) => {
  process.exitCode = 1;
  const category = classifyError(error);

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

// TCP probe to Cloudflare DNS (1.1.1.1:53). More reliable than a hostname lookup,
// which can return cached results while actually offline, and works in regions where
// other endpoints are blocked. Capped at 1500ms so a flaky network doesn't stall the CLI.
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

program
  .version('4.0.5')
  .description('Ancient wisdom for the modern era (English + Preferred Language).')
  .argument('[cmd]', 'Run a specific command (e.g., "random")')
  .option('-t, --topic <query>', 'Ask your life question in English')
  .option('--lang <language>', 'Change your preferred language preference')
  .option('--key [key]', 'Update your Groq API key (omit value to open browser)')
  .action(async (cmd, options) => {

    let config = { GROQ_API_KEY: null, PREFERRED_LANGUAGE: null };
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      } catch (e) {
        // Surface corruption so the user isn't confused when the wizard re-runs.
        console.log(chalk.yellow(`\n⚠️  Your config file appears to be corrupt: ${CONFIG_PATH}`));
        console.log(chalk.white('Resetting it and restarting the setup wizard...\n'));
        config = { GROQ_API_KEY: null, PREFERRED_LANGUAGE: null };
      }
    }

    if (options.lang) {
      // Normalize so "gujarati" / "GUJARATI" both become "Gujarati".
      config.PREFERRED_LANGUAGE = toTitleCase(options.lang.trim());
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
      console.log(chalk.green(`\n✅ Language preference updated to: ${config.PREFERRED_LANGUAGE}`));
      console.log(chalk.white("Now run your query to see the change.\n"));
      return;
    }

    // `--key gsk_...` gives options.key a string; bare `--key` gives `true` (Commander's convention).
    // The latter triggers the same browser-assisted flow the onboarding wizard uses.
    if (options.key !== undefined) {
      let cleanKey;

      if (options.key === true || String(options.key).trim() === '') {
        console.log(chalk.green.bold("\n🔑 Update Groq API Key\n"));
        cleanKey = await promptForGroqKey();
        if (!cleanKey) { process.exitCode = 1; return; }
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

    if (!config.GROQ_API_KEY || !config.PREFERRED_LANGUAGE) {
      console.log(chalk.green.bold("\n🌟 Welcome to Harikrupa Setup Wizard"));
      console.log(chalk.white("Let's get you connected to the Gita in 2 quick steps.\n"));

      if (!config.GROQ_API_KEY) {
        console.log(chalk.yellow.bold("Step 1 of 2:"));
        const cleanKey = await promptForGroqKey();
        if (!cleanKey) { process.exitCode = 1; return; }
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

    const isRandomMode = cmd === 'random';
    // Re-apply title-case so older configs saved with lowercase still render correctly.
    const prefLang = toTitleCase(config.PREFERRED_LANGUAGE) || 'English';

    if (!options.topic && !isRandomMode) {
      const label = chalk.cyan;
      const hint  = chalk.white.dim;
      const head  = chalk.yellow.bold;
      const rule  = chalk.white.dim('─'.repeat(54));

      // COL is sized to fit the longest command (~32 chars) plus a 2-space gutter.
      const COL = 34;
      const row = (cmdStr, desc) => '  ' + label(cmdStr.padEnd(COL)) + hint(desc);

      console.log();
      console.log(chalk.yellow.bold('🕉️  Harikrupa') + chalk.white.dim('  ·  Ancient wisdom for the modern era'));
      console.log(rule);

      console.log(head('\nASK'));
      console.log(row('harikrupa -t "<question>"',  'Get guidance for your situation'));
      console.log(row('harikrupa random',           'Draw a random verse of the day'));

      console.log(head('\nSETTINGS'));
      console.log(row('harikrupa --lang "<language>"',  'Change your output language'));
      console.log(row('harikrupa --key "gsk_..."',  'Update your Groq API key'));
      console.log(row('harikrupa --key',            '…or set one interactively (opens browser)'));
      console.log(row('harikrupa --version',        'Show the installed version'));

      console.log(head('\nEXAMPLES'));
      console.log(row('harikrupa -t "I feel burnt out"', ''));
      console.log(row('harikrupa -t "afraid of failing"', ''));
      console.log(row('harikrupa --lang "Gujarati"',     ''));

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

    // Otherwise the embedding pipeline runs on an empty string and returns a meaningless match.
    if (!isRandomMode && options.topic !== undefined && options.topic.trim() === '') {
      console.log(chalk.red('\n❌ Your question is empty.'));
      console.log(chalk.white('Try something like: ') + chalk.cyan('harikrupa -t "I feel overwhelmed by this release"') + '\n');
      process.exitCode = 1;
      return;
    }

    try {
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

      // Strip the 384-dim embedding vector so it doesn't pollute logs or future prompt context.
      const { embedding: _embedding, ...matchedVerse } = bestMatch;

      const gold = chalk.hex('#FFD700').bold;
      const subTitleColor = chalk.cyanBright.bold;
      const bodyText = chalk.white.dim;

      const online = await isOnline();
      if (!online) {
        console.log(chalk.yellow('⚠️  No Internet Connection Detected.'));
        console.log(bodyText('Harikrupa is running in Offline Mode. AI mentor commentary is disabled, but here is your guiding verse:\n'));

        console.log(gold(`Wisdom from Srimad Bhagavad Gita: Chapter ${matchedVerse.chapter}, Verse ${matchedVerse.verse}`));
        console.log(chalk.white("--------------------------------------------------"));
        console.log(subTitleColor("Sanskrit:"));
        console.log(bodyText(matchedVerse.sanskrit_verse));

        const localLangKey = prefLang.toLowerCase();
        const excludedKeys = ['chapter', 'verse', 'sanskrit_verse'];
        const availableLangs = Object.keys(matchedVerse)
          .filter(key => !excludedKeys.includes(key))
          .map(toTitleCase);

        if (localLangKey !== 'english') {
          console.log(subTitleColor(`\n${prefLang}:`));
          if (matchedVerse[localLangKey]) {
            console.log(bodyText(matchedVerse[localLangKey]));
          } else {
            console.log(chalk.yellow(`⚠️ Offline Translation Unavailable`));
            console.log(bodyText(`Your local database currently only has pre-downloaded translations for: ${availableLangs.join(', ')}.`));
            console.log(bodyText(`(Please connect to the internet so the AI can dynamically translate this into ${prefLang})`));
          }
        }

        console.log(subTitleColor("\nEnglish:"));
        console.log(bodyText(matchedVerse.english));
        console.log(chalk.white("--------------------------------------------------\n"));
        return;
      }

      const groq = new Groq({ apiKey: config.GROQ_API_KEY });

      const simulatedUserInput = isRandomMode
        ? "I would like a random verse of the day for general grounding and reflection."
        : `"${options.topic}"`;

      const empathyInstructions = isRandomMode
        ? "**Empathy:** [Provide a warm, grounding thought for the day in a detailed 3-line paragraph. Do not reference a specific struggle.]"
        : "**Empathy:** [Acknowledge their specific situation in a detailed 3-line paragraph]";

      // Mapped languages come back in native script (use verbatim); unmapped ones come back as
      // "<Lang> Perspective" and the LLM is instructed below to translate the heading itself.
      const { heading: secondHeading, isNative: headingIsNative } = getNativePerspectiveHeading(prefLang);

      const headingInstruction = headingIsNative
        ? `The second heading "### ${secondHeading}" is already written in the native script of ${prefLang}. Use it EXACTLY as given. Do not translate, romanize, rewrite, or append any English words (including "Perspective") to it.`
        : `The second heading "### ${secondHeading}" is currently in English as a placeholder. Replace it with the equivalent phrase in the native script of ${prefLang} (meaning "${prefLang} Perspective" translated into ${prefLang}'s own script). If ${prefLang} is typically written in Latin script, keep the phrase in ${prefLang} but in Latin script. Use the translated heading consistently in BOTH places where the "${secondHeading}" heading appears below.`;

      const systemPrompt = `
      You are a wise mentor and Bhagavad Gita expert.

      User Input: ${simulatedUserInput}
      Most Relevant Verse: Chapter ${matchedVerse.chapter}, Verse ${matchedVerse.verse}
      Sanskrit Original: ${matchedVerse.sanskrit_verse}

      YOUR TASK:
      Divide your response into two exact sections: "### English Perspective" and "### ${secondHeading}".
      ${headingInstruction}

      Under "### English Perspective":
      **Sanskrit Verse:** [Provide original Sanskrit]
      **Transliteration (IAST):** [Provide phonetic text]
      **Translation (English):** [Provide ONLY the English translation]
      ${empathyInstructions}
      **Connection:** [Explain the cosmic narrative from the Gita in a detailed 2-3 line paragraph]
      **Practical Wisdom:** [Provide a modern mental hack or vibe shift in a detailed 2-3 line paragraph]
      **Next Action:** [Provide a high-energy practical step or reflection in a detailed 2-3 line paragraph]

      Under the second section heading:
      Translate ALL the subheaders themselves into ${prefLang} (e.g., **Verso en Sánscrito:**, **Empatía:**, etc.).
      1. Provide the Sanskrit under the translated Sanskrit subheader.
      2. Provide the Transliteration under the translated Transliteration subheader.
      3. Provide ONLY the ${prefLang} translation of the verse under the translated Translation subheader.
      4. Provide the fully translated commentary sections under their respective translated subheaders.

      STRICT RULES:
      - Do not cross translations (no English verse translation in the ${prefLang} section, and vice versa).
      - Ensure EVERY subheader is wrapped in double asterisks like **This**.
      - The English heading must stay EXACTLY as "### English Perspective".
      - DO NOT use em-dashes (—) anywhere in your response. Use commas, colons, or periods instead.
      - Keep the language simple and avoid complex vocabulary.
      `;

      const chatCompletion = await groq.chat.completions.create({
        messages: [{ role: 'system', content: systemPrompt }],
        model: 'openai/gpt-oss-120b',
        temperature: 0.5,
      });

      const rawResponse = (chatCompletion.choices?.[0]?.message?.content || '').trim();
      if (!rawResponse) {
        throw new Error('Groq returned an empty response (no content)');
      }

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
      // Set DEBUG=harikrupa in the environment to also see the stack trace.
      reportError(error, { verbose: process.env.DEBUG === 'harikrupa' });
    }
  });

program.parse(process.argv);