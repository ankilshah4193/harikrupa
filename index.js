#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
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

program
  .version('2.0.9')
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

      if (!bestMatch) throw new Error("Could not find a relevant verse.");

      // --- 7. GROQ BILINGUAL MENTOR PROMPT ---
      const groq = new Groq({ apiKey: config.GROQ_API_KEY });
      
      const systemPrompt = `
      You are a wise mentor and Bhagavad Gita expert. Your goal is to guide someone through a tough time using the Gita's wisdom.
      
      User Question (English): "${options.topic}"
      Most Relevant Verse: Chapter ${bestMatch.chapter}, Verse ${bestMatch.verse}
      Sanskrit Original: ${bestMatch.sanskrit_verse}
      
      YOUR TASK:
      1. Be real. Start by acknowledging the user's struggle with genuine empathy. Use simple and direct language that feels natural to Millennials and Gen Z. Avoid sounding preachy or outdated.
      2. Provide the Sanskrit Original Verse.
      3. Explain in 3 lines why this verse is a total game-changer for their specific problem. Keep the advice practical, relatable, and very easy to understand. Break down the deep philosophy into simple "vibes" or "mindset shifts" that someone today can actually use.
      
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