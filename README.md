# 🙏 Harikrupa

**Ancient wisdom dynamically tailored to modern developer burnout.**

[![npm version](https://badge.fury.io/js/harikrupa.svg)](https://www.npmjs.com/package/harikrupa)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Harikrupa is a lightweight, high-performance CLI tool designed to help developers navigate burnout, stress, and life's complex decisions. It utilizes a **Hybrid RAG (Retrieval-Augmented Generation) Architecture**: performing zero-latency semantic search locally, followed by high-speed inference via the Groq API to provide a customized, bilingual response.

---

## 🌟 Core Features

* **Offline-First Vector Search:** Utilizes a local vector database and ONNX runtime to find the most relevant Bhagavad Gita verses instantly, without sending your raw queries to a search engine.
* **Ultra-Low Latency Inference:** Integrates with the Groq API to generate responses at blazing speeds.
* **Bilingual Output:** Receive guidance in English alongside your preferred local language (e.g., Gujarati, Hindi, Spanish).
* **Modern Context:** Translates deep philosophical concepts into practical "mental hacks" and actionable steps for today's tech-driven environment.
* **Graceful Degradation:** Built-in network checks ensure the CLI fails fast and gracefully if you lose internet connectivity.

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

Harikrupa splits the workload to optimize for both privacy and speed:

1. **Embedding Extraction:** `@xenova/transformers` (`all-MiniLM-L6-v2`) runs locally to convert your query into a mathematical vector.
2. **Semantic Search:** Cosine similarity is calculated against a local pre-computed JSON database of verse embeddings.
3. **Generation:** The top-matching verse and your query are sent to **Groq** to generate a highly contextual, structured response.
4. **CLI Framework:** Built robustly with `commander` and styled with `chalk`.

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.
```