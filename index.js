#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import dns from 'dns';
import { fileURLToPath } from 'url';
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

const isOnline = () => {
  return new Promise((resolve) => {
    dns.lookup('google.com', (err) => {
      resolve(!(err && err.code === 'ENOTFOUND'));
    });
  });
};

program
  .version('3.0.3')
  .description('Ancient wisdom for the modern era (English + Preferred Language).')
  .option('-t, --topic <query>', 'Ask your life question in English')
  .option('--lang <language>', 'Change your preferred language preference')
  .option('--set-key <key>', 'Update your Groq API key manually')
  .action(async (options) => {
    
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

    // --- 3. SET API KEY MANUALLY ---
    if (options.setKey) {
      config.GROQ_API_KEY = options.setKey.trim();
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
      console.log(chalk.green(`\n✅ API Key updated successfully.\n`));
      return;
    }

    // --- 4. ONBOARDING WIZARD ---
    if (!config.GROQ_API_KEY || !config.PREFERRED_LANGUAGE) {
      console.log(chalk.green.bold("\n🌟 Welcome to Harikrupa Setup Wizard"));
      console.log(chalk.white("Let's get you connected to the Gita in 2 quick steps.\n"));

      if (!config.GROQ_API_KEY) {
        console.log(chalk.yellow("Step 1: Get your free API key from Groq"));
        console.log(chalk.white("Visit: ") + chalk.blue.underline("https://console.groq.com/keys\n"));
        const userKey = await ask("Paste your API key here: ");
        config.GROQ_API_KEY = userKey.trim();
      }

      if (!config.PREFERRED_LANGUAGE) {
        const userLang = await ask("Step 2: What is your preferred language for the answers? (e.g., Gujarati, Hindi, Spanish): ");
        config.PREFERRED_LANGUAGE = userLang.trim() || 'English';
      }

      if (config.GROQ_API_KEY.startsWith('gsk_')) {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
        console.log(chalk.green("\n✅ Setup Complete! All settings saved."));
        console.log(chalk.white("Now try: ") + chalk.yellow('harikrupa -t "I feel overwhelmed"') + "\n");
        return;
      } else {
        console.log(chalk.red("\n❌ Invalid API key format. Please run 'harikrupa' again to restart setup.\n"));
        return;
      }
    }

    // --- 5. INPUT VALIDATION ---
    if (!options.topic) {
      console.log(chalk.yellow('\nUsage: harikrupa -t "Your question in English"'));
      console.log(chalk.white.dim('Try: harikrupa --lang "Gujarati" to change languages.\n'));
      return;
    }

    // --- PRE-FLIGHT INTERNET CHECK ---
    const online = await isOnline();
    if (!online) {
      console.log(chalk.red('\n❌ No Internet Connection.'));
      console.log(chalk.white('Harikrupa needs the internet to connect with the AI mentor. Please check your Wi-Fi and try again.\n'));
      return; // Exit immediately before loading heavy local models
    }

    console.log(chalk.blue(`\nReflecting on your situation in English & ${config.PREFERRED_LANGUAGE}...\n`));

    try {
      // --- 6. LOCAL SEMANTIC SEARCH ---
      if (!fs.existsSync(DB_PATH)) {
        throw new Error("Local database missing. Ensure 'data/verse_embeddings.json' exists.");
      }

      // Initialize local embedding model
      const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      const queryOutput = await extractor(options.topic, { pooling: 'mean', normalize: true });
      const queryVector = queryOutput.tolist()[0];

      const verses = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

      let bestMatch = null;
      let highestScore = -1;

      for (const verse of verses) {
        const score = cos_sim(queryVector, verse.embedding);
        if (score > highestScore) {
          highestScore = score;
          bestMatch = verse;
        }
      }

      // --- THRESHOLD & FALLBACK LOGIC ---
      // Log the score if you want to debug in the future: console.log(`Confidence Score: ${highestScore}`);
      const MIN_THRESHOLD = 0.25; 

      if (highestScore < MIN_THRESHOLD) {
        // If the score is too low, it's likely a greeting or vague statement.
        // Fallback to Chapter 18, Verse 66 (a universal verse of devotion and peace).
        bestMatch = verses.find(v => String(v.chapter) === "18" && String(v.verse) === "66") || verses[0];
      }

      if (!bestMatch) throw new Error("Could not find a relevant verse.");

      // --- 7. GROQ BILINGUAL MENTOR PROMPT ---
      const groq = new Groq({ apiKey: config.GROQ_API_KEY });
      
      const systemPrompt = `
      You are a wise mentor and Bhagavad Gita expert. Your goal is to guide someone through a tough time using the Gita's wisdom.
      
      User Question (English): "${options.topic}"
      Most Relevant Verse: Chapter ${bestMatch.chapter}, Verse ${bestMatch.verse}
      Sanskrit Original: ${bestMatch.sanskrit_verse}
      
      YOUR TASK:
      1. Analyze the user input. If it is a greeting or devotional phrase (like "Jai Shree Ram", "Hello"), acknowledge it respectfully with warmth and shared devotion. If the user shares a struggle or life problem, acknowledge their situation with genuine empathy. Do not invent a struggle if the user hasn't mentioned one. (1-Line Limit)
      2. Connect the context. If the user shared a struggle, briefly explain the historical or cosmic narrative from the Gita that mirrors their problem. If it was a greeting or general statement, briefly explain how this specific verse reflects the spirit of their input or the path of devotion and duty. (1-Line Limit)
      3. Provide the original Sanskrit verse from the Srimad Bhagavad Gita. Include the phonetic transliteration (IAST) and translation in ${config.PREFERRED_LANGUAGE} so the user can connect with the sound and vibration of the words, keeping the "source of truth" at the center of the answer.
      4. Explain in exactly 2-3 lines why this specific wisdom is practical for the modern day. Reframe deep philosophy into a "vibe shift", mental hack, or grounding thought that the user can apply today. Frame sentences properly. (2-3 Lines Limit)
      5. Provide 2-3 lines of instruction on a physical or mental action the user can perform next. Ensure the tone is high-energy, optimistic, and focused on practical alignment (whether it is an action to solve a problem or a reflective practice for devotion). Frame sentences properly. (2-3 Lines Limit)
      
      STRICT RULES:
      - DO NOT use em-dashes (—) anywhere in your response. Use commas, colons, or periods instead.
      - Keep the language simple. Avoid complex vocabulary.
      - You must provide the entire response twice: First in English, then in ${config.PREFERRED_LANGUAGE}.
      - Use Markdown headers like "### English Perspective" and "### ${config.PREFERRED_LANGUAGE} Perspective".
      `;

      const chatCompletion = await groq.chat.completions.create({
        messages: [{ role: 'system', content: systemPrompt }],
        model: 'openai/gpt-oss-120b', 
        temperature: 0.5,
      });

      // --- 8. FINAL OUTPUT ---
      console.log(chalk.yellow.bold(`Wisdom from Srimad Bhagavad Gita: Chapter ${bestMatch.chapter}, Verse ${bestMatch.verse}`));
      console.log(chalk.white("--------------------------------------------------\n"));
      console.log(chalk.white(chatCompletion.choices[0]?.message?.content));
      console.log(chalk.white("\n--------------------------------------------------\n"));

    } catch (error) {
      console.log(chalk.red('\n❌ System Error:'));
      console.error(chalk.white(error.message));
      
      if (error.message.includes('401')) {
        console.log(chalk.yellow("\nTip: Your API key is invalid. Run 'harikrupa --set-key' to update it."));
      } else if (error.message.includes('fetch')) {
        console.log(chalk.yellow("\nTip: Check your internet connection. We need it to talk to Groq."));
      }
    }
  });

program.parse(process.argv);