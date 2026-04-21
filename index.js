#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import dns from 'dns';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { pipeline, cos_sim } from '@xenova/transformers';
import Groq from 'groq-sdk';

// File System Setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'data', 'verse_embeddings.json');
const CONFIG_PATH = path.join(os.homedir(), '.harikrupa.json');

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

// Helper to check internet connection
const isOnline = () => {
  return new Promise((resolve) => {
    dns.lookup('google.com', (err) => {
      resolve(!(err && err.code === 'ENOTFOUND'));
    });
  });
};

program
  .version('4.0.1')
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
      config.PREFERRED_LANGUAGE = options.lang.trim();
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
        config.PREFERRED_LANGUAGE = userLang.trim() || 'English';
      }

      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
      console.log(chalk.green("\n✅ Setup Complete! All settings saved."));
      console.log(chalk.white("Now try: ") + chalk.cyan('harikrupa -t "I feel overwhelmed"') + "\n");
      return;
    }

    // --- 5. INPUT VALIDATION & HELP MENU ---
    const isRandomMode = cmd === 'random';

    // If they didn't provide a topic AND they didn't type "random", show the help menu
    if (!options.topic && !isRandomMode) {
      console.log(chalk.yellow.bold('\n🕉️  Harikrupa - Ancient wisdom for the modern era'));
      console.log(chalk.white('\nUsage: ') + chalk.cyan('harikrupa -t "Your question here"'));
      console.log(chalk.white.dim('Example: harikrupa -t "I feel anxious about my career"'));

      console.log(chalk.white('\n🎲 Verse of the Day:'));
      console.log(chalk.white('  harikrupa random            ') + chalk.white.dim('-> Get a random grounding verse'));

      console.log(chalk.white('\n⚙️  Settings:'));
      console.log(chalk.white('  harikrupa --lang "Spanish"  ') + chalk.white.dim('-> Change output language'));
      console.log(chalk.white('  harikrupa --key "gsk_"      ') + chalk.white.dim('-> Update your API key'));

      console.log(chalk.cyan.bold('\n🔑 API Key Info:'));
      console.log(chalk.white('Harikrupa uses Groq for lightning-fast AI translations.'));
      console.log(chalk.white('You can get a ') + chalk.green.bold('100% FREE') + chalk.white(' API key with ') + chalk.yellow.bold('no credit card required') + chalk.white('.'));
      console.log(chalk.white('Get it here: ') + chalk.blue.underline('https://console.groq.com/keys\n'));
      return;
    }

    const prefLang = config.PREFERRED_LANGUAGE || 'English';

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

      const gold = chalk.hex('#FFD700').bold;
      const subTitleColor = chalk.cyanBright.bold;
      const bodyText = chalk.white.dim;

      // --- OFFLINE FALLBACK CHECK ---
      const online = await isOnline();
      if (!online) {
        console.log(chalk.yellow('⚠️  No Internet Connection Detected.'));
        console.log(bodyText('Harikrupa is running in Offline Mode. AI mentor commentary is disabled, but here is your guiding verse:\n'));

        console.log(gold(`Wisdom from Srimad Bhagavad Gita: Chapter ${bestMatch.chapter}, Verse ${bestMatch.verse}`));
        console.log(chalk.white("--------------------------------------------------"));
        console.log(subTitleColor("Sanskrit:"));
        console.log(bodyText(bestMatch.sanskrit_verse));

        const localLangKey = prefLang.toLowerCase();
        const excludedKeys = ['chapter', 'verse', 'sanskrit_verse', 'embedding'];
        const availableLangs = Object.keys(bestMatch)
          .filter(key => !excludedKeys.includes(key))
          .map(lang => lang.charAt(0).toUpperCase() + lang.slice(1));

        if (localLangKey !== 'english') {
          console.log(subTitleColor(`\n${prefLang}:`));
          if (bestMatch[localLangKey]) {
            console.log(bodyText(bestMatch[localLangKey]));
          } else {
            console.log(chalk.yellow(`⚠️ Offline Translation Unavailable`));
            console.log(bodyText(`Your local database currently only has pre-downloaded translations for: ${availableLangs.join(', ')}.`));
            console.log(bodyText(`(Please connect to the internet so the AI can dynamically translate this into ${prefLang})`));
          }
        }

        console.log(subTitleColor("\nEnglish:"));
        console.log(bodyText(bestMatch.english));
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

      const systemPrompt = `
      You are a wise mentor and Bhagavad Gita expert.

      User Input: ${simulatedUserInput}
      Most Relevant Verse: Chapter ${bestMatch.chapter}, Verse ${bestMatch.verse}
      Sanskrit Original: ${bestMatch.sanskrit_verse}

      YOUR TASK:
      Divide your response into two exact sections: "### English Perspective" and "### ${prefLang} Perspective". 

      Under "### English Perspective":
      **Sanskrit Verse:** [Provide original Sanskrit]
      **Transliteration (IAST):** [Provide phonetic text]
      **Translation (English):** [Provide ONLY the English translation]
      ${empathyInstructions}
      **Connection:** [Explain the cosmic narrative from the Gita in a detailed 2-3 line paragraph]
      **Practical Wisdom:** [Provide a modern mental hack or vibe shift in a detailed 2-3 line paragraph]
      **Next Action:** [Provide a high-energy practical step or reflection in a detailed 2-3 line paragraph]

      Under "### ${prefLang} Perspective":
      Translate ALL the subheaders themselves into ${prefLang} (e.g., **Verso en Sánscrito:**, **Empatía:**, etc.).
      1. Provide the Sanskrit under the translated Sanskrit subheader.
      2. Provide the Transliteration under the translated Transliteration subheader.
      3. Provide ONLY the ${prefLang} translation of the verse under the translated Translation subheader.
      4. Provide the fully translated commentary sections under their respective translated subheaders.

      STRICT RULES:
      - Do not cross translations (no English verse translation in the ${prefLang} section, and vice versa).
      - Ensure EVERY subheader is wrapped in double asterisks like **This**.
      - DO NOT use em-dashes (—) anywhere in your response. Use commas, colons, or periods instead.
      - Keep the language simple and avoid complex vocabulary.
      `;

      const chatCompletion = await groq.chat.completions.create({
        messages: [{ role: 'system', content: systemPrompt }],
        model: 'openai/gpt-oss-120b',
        temperature: 0.5,
      });

      // --- 8. FINAL OUTPUT ---
      console.log(gold(`Wisdom from Srimad Bhagavad Gita: Chapter ${bestMatch.chapter}, Verse ${bestMatch.verse}`));
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