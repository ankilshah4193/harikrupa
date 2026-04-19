# 🙏 Harikrupa

**Ancient wisdom dynamically tailored to modern developer burnout.**

[![npm version](https://badge.fury.io/js/harikrupa.svg)](https://www.npmjs.com/package/harikrupa)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Harikrupa is a lightweight, high-performance CLI tool designed to help developers navigate burnout, stress, and life's complex decisions. It utilizes a **Hybrid RAG (Retrieval-Augmented Generation) Architecture**: performing zero-latency semantic search locally, followed by high-speed inference via the Groq API to provide a customized, bilingual response.



---

## 🌟 Core Features

* **Offline-First Vector Search:** Utilizes a local vector database and ONNX runtime to find the most relevant Bhagavad Gita verses instantly, without sending your raw queries to a search engine.
* **Graceful Offline Fallback:** If you lose internet connectivity (e.g., on an airplane), Harikrupa won't crash. It seamlessly switches to Offline Mode, using the local vector search to print the raw Sanskrit and English verse directly to your terminal.
* **Smart Language Detection:** When offline, the CLI intelligently reads the local vector database to see if a pre-compiled translation of your preferred language exists. If not, it gracefully lists the available offline languages.
* **Ultra-Low Latency Inference:** When online, Harikrupa integrates with the Groq API to generate highly contextual responses at blazing speeds.
* **Bilingual Output:** Receive dynamic AI guidance in English alongside your preferred local language (e.g., Gujarati, Hindi, Spanish).

---

## 🚀 Installation

Install the package globally via npm to access the CLI from any terminal:

```bash
npm install -g harikrupa
```

*Note: Requires Node.js v18.0.0 or higher.*

---

## 🛠️ Initial Setup

After installation, run the tool without any flags to launch the interactive setup wizard:

```bash
harikrupa
```

The wizard will guide you through:
1. Connecting your free Groq API key (from [console.groq.com](https://console.groq.com/keys)).
2. Setting your preferred language for the translated wisdom.

*(Your API key and preferences are stored securely and locally on your machine at `~/.harikrupa.json`)*

---

## 📖 Usage

Ask any question about life, work, or stress using the `-t` or `--topic` flag:

```bash
harikrupa -t "I am completely burnt out from this release cycle"
```

### Additional Commands

* **Change Language Preference:** ```bash
  harikrupa --lang "Gujarati"
  ```
* **Update API Key Manually:** ```bash
  harikrupa --set-key "gsk_your_new_api_key_here"
  ```
* **Check Version:** ```bash
  harikrupa --version
  ```

---

## 🏗️ Architecture & Tech Stack

Harikrupa operates in a two-step "relay" to optimize for privacy, speed, and reliability:

### Step 1: Always Local (Semantic Search)
* **Embedding Extraction:** `@xenova/transformers` (`all-MiniLM-L6-v2`) runs entirely on your local machine to convert your query into a mathematical vector.
* **Vector Matching:** Cosine similarity is calculated against a local pre-computed JSON database of verse embeddings to find the perfect matching verse.

### Step 2: The Network Split
* **If Online:** The top-matching verse and your query are sent to **Groq** to generate a highly contextual, structured AI mentor response in your preferred language.
* **If Offline:** The CLI detects the network drop and safely bypasses the AI generation. It dynamically queries the local database for available translations and prints the raw matching verse directly to your terminal.

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.
```