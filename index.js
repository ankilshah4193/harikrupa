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

// File System Setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'data', 'verse_embeddings.json');
const CONFIG_PATH = path.join(os.homedir(), '.harikrupa.json');

// Helper to title-case a language name (e.g., "gujarati" -> "Gujarati", "SPANISH" -> "Spanish")
// Handles multi-word names too (e.g., "brazilian portuguese" -> "Brazilian Portuguese").
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

program
  .version('4.0.2')
  .description('Ancient wisdom for the modern era (English + Preferred Language).')
  .argument('[cmd]', 'Run a specific command (e.g., "random")') // <--- Added argument support
  .option('-t, --topic <query>', 'Ask your life question in English')
  .option('--lang <language>', 'Change your preferred language preference')
  .option('--key <key>', 'Update your Groq API key manually')
  .action(async (cmd, options) => {

    // --- 1. LOAD CONFIGURATION ---
    let config = { GROQ_API_KEY: null, PREFERRED_LANGUAGE: null };
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      } catch (e) {
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

    // --- 3. SET API KEY MANUALLY & VALIDATE ---
    if (options.key) {
      const newKey = options.key.trim();
      if (!newKey.startsWith('gsk_')) {
        console.log(chalk.red('\n❌ Oops! That does not look like a valid Groq API key.'));
        console.log(chalk.white('Valid keys usually start with "gsk_".'));
        console.log(chalk.white('Please generate a new one at: ') + chalk.blue.underline('https://console.groq.com/keys'));
        console.log(chalk.white('Once you have it, try running this command again:'));
        console.log(chalk.cyan('harikrupa --key "your_new_key_here"\n'));
        return;
      }
      config.GROQ_API_KEY = newKey;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
      console.log(chalk.green(`\n✅ API Key updated successfully.\n`));
      return;
    }

    // --- 4. ONBOARDING WIZARD ---
    if (!config.GROQ_API_KEY || !config.PREFERRED_LANGUAGE) {
      console.log(chalk.green.bold("\n🌟 Welcome to Harikrupa Setup Wizard"));
      console.log(chalk.white("Let's get you connected to the Gita in 2 quick steps.\n"));

      if (!config.GROQ_API_KEY) {
        console.log(chalk.yellow.bold("Step 1: Get your FREE API key from Groq (No credit card required!)"));
        console.log(chalk.white("Get your key at:"));
        console.log(chalk.blue.underline("https://console.groq.com/keys\n"));

        let userKey = await ask(chalk.white("Press ENTER to open in the browser... "));

        if (userKey.trim() === '') {
          openBrowser('https://console.groq.com/keys');
          userKey = await ask(chalk.cyan("\nPaste your API key here (starts with 'gsk_'): "));
        }

        const cleanKey = userKey.trim();

        if (!cleanKey.startsWith('gsk_')) {
          console.log(chalk.red('\n❌ Oops! The API key you entered seems invalid (it should start with "gsk_").'));
          console.log(chalk.white('Don\'t worry! You can generate a new one for free at https://console.groq.com/keys'));
          console.log(chalk.white('Once you have it, just run this command to save it and skip setup:'));
          console.log(chalk.cyan('harikrupa --key "your_new_key_here"\n'));
          return;
        }

        config.GROQ_API_KEY = cleanKey;
      }

      if (!config.PREFERRED_LANGUAGE) {
        console.log("");
        const userLang = await ask("Step 2: What is your preferred language for the answers? (e.g., Gujarati, Hindi, Spanish): ");
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
      const hint  = chalk.white.dim;      // description text
      const head  = chalk.yellow.bold;    // section headers
      const rule  = chalk.white.dim('─'.repeat(54));

      // Small helper to keep columns aligned regardless of command length.
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

    try {
      // --- 6. DB LOAD & VERSE SELECTION ---
      if (!fs.existsSync(DB_PATH)) {
        throw new Error("Local database missing. Ensure 'data/verse_embeddings.json' exists.");
      }

      const verses = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
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
      const online = await isOnline();
      if (!online) {
        console.log(chalk.yellow('⚠️  No Internet Connection Detected.'));
        console.log(bodyText('Harikrupa is running in Offline Mode. AI mentor commentary is disabled, but here is your guiding verse:\n'));

        console.log(gold(`Wisdom from Srimad Bhagavad Gita: Chapter ${matchedVerse.chapter}, Verse ${matchedVerse.verse}`));
        console.log(chalk.white("--------------------------------------------------"));
        console.log(subTitleColor("Sanskrit:"));
        console.log(bodyText(matchedVerse.sanskrit_verse));

        const localLangKey = prefLang.toLowerCase();
        // `matchedVerse` no longer carries the embedding, so we only need to exclude metadata keys.
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

      // --- 7. GROQ BILINGUAL MENTOR PROMPT ---
      const groq = new Groq({ apiKey: config.GROQ_API_KEY });

      // Determine what to tell the AI based on the mode
      const simulatedUserInput = isRandomMode
        ? "I would like a random verse of the day for general grounding and reflection."
        : `"${options.topic}"`;

      const empathyInstructions = isRandomMode
        ? "**Empathy:** [Provide a warm, grounding thought for the day in a detailed 3-line paragraph. Do not reference a specific struggle.]"
        : "**Empathy:** [Acknowledge their specific situation in a detailed 3-line paragraph]";

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

      // --- 8. FINAL OUTPUT ---
      console.log(gold(`Wisdom from Srimad Bhagavad Gita: Chapter ${matchedVerse.chapter}, Verse ${matchedVerse.verse}`));
      console.log(chalk.white("--------------------------------------------------\n"));

      let rawResponse = chatCompletion.choices[0]?.message?.content || "";

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
      console.log(chalk.red('\n❌ System Error:'));
      console.error(chalk.white(error.message));

      if (error.message.includes('401') || error.message.includes('invalid') || error.message.includes('API key')) {
        console.log(chalk.yellow("\n⚠️  It looks like your current Groq API key is invalid or expired."));
        console.log(chalk.white("You can easily generate a new, free key at: ") + chalk.blue.underline("https://console.groq.com/keys"));
        console.log(chalk.white("Then, update it in Harikrupa by running:"));
        console.log(chalk.cyan('harikrupa --key "your_new_key_here"\n'));
      } else if (error.message.includes('fetch') || error.message.includes('network')) {
        console.log(chalk.yellow("\nTip: Check your internet connection. We need it to talk to Groq."));
      }
    }
  });

program.parse(process.argv);