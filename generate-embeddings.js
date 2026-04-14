import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from '@xenova/transformers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VERSES_DIR = path.join(__dirname, 'data', 'verses');
const OUTPUT_FILE = path.join(__dirname, 'data', 'verse_embeddings.json');

async function generateEmbeddings() {
  console.log('Loading AI Model...');
  // We use the same lightweight feature-extraction model
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  const files = fs.readdirSync(VERSES_DIR).filter(file => file.endsWith('.json'));
  const processedVerses = [];

  console.log(`Found ${files.length} verses. Generating embeddings... This might take a minute.`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const rawData = fs.readFileSync(path.join(VERSES_DIR, file), 'utf8');
    const verseData = JSON.parse(rawData);

    // We generate the mathematical vector based on the English translation.
    // You could also combine English + Hindi here if you wanted the search to be multilingual!
    const output = await extractor(verseData.english, { pooling: 'mean', normalize: true });
    const vector = output.tolist()[0];

    // Store the original verse data PLUS its new vector
    processedVerses.push({
      ...verseData,
      embedding: vector
    });

    // Simple progress indicator
    if ((i + 1) % 50 === 0) {
      console.log(`Processed ${i + 1}/${files.length} verses...`);
    }
  }

  // Save the massive array to a single JSON file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(processedVerses));
  console.log(`\nSuccess! Saved all embeddings to ${OUTPUT_FILE}`);
}

generateEmbeddings().catch(console.error);