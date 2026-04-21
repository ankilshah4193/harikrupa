# 🙏 Harikrupa

**Ancient wisdom dynamically tailored to modern developer burnout.**

[![npm version](https://badge.fury.io/js/harikrupa.svg)](https://www.npmjs.com/package/harikrupa)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Harikrupa is a lightweight, high-performance CLI tool designed to help developers navigate burnout, stress, and life's complex decisions. It utilizes a **Hybrid RAG (Retrieval-Augmented Generation) Architecture**: performing zero-latency semantic search locally, followed by high-speed inference via the Groq API to provide a customized, bilingual response.

---

## 🌟 Core Features

* **🧠 Smart Semantic Search:** Uses a local vector database to find the perfect matching Bhagavad Gita verse for your specific situation.
* **🎲 Verse of the Day:** Use the `random` command for a quick grounding thought without needing to ask a specific question.
* **🌍 Bilingual Perspective:** Get structured wisdom in English and your preferred language side-by-side. Built-in native-script headings for 20+ languages (Gujarati → `ગુજરાતી દ્રષ્ટિકોણ`, Hindi → `हिंदी दृष्टिकोण`, Japanese → `日本語の視点`, etc.); any other language is translated dynamically by the AI.
* **🎨 Aesthetic UI:** Fully color-coded terminal output with Gold perspectives, Cyan subheaders, and dimmed body text for better focus.
* **📴 Offline-First:** Works anywhere. If you're off-grid, it safely falls back to local translations so your wisdom is never out of reach.
* **💸 100% Free AI:** Uses Groq's LPU technology for near-instant answers. No credit card or subscription required.

---

## 🚀 Installation

```bash
npm install -g harikrupa
```

*Note: Requires Node.js v18.0.0 or higher.*

---

## 🛠️ Frictionless Setup

Just run the tool to start the setup wizard:

```bash
harikrupa
```

**Step 1: Get your Free API Key** The CLI will display the Groq console link. Simply **Press ENTER** to automatically open it in your browser. Copy the key and paste it back into the terminal. No manual URL copying required!

**Step 2: Set your Language** Tell Harikrupa which language you prefer for your bilingual translations.

---

## 📖 Usage

### Ask a Question
Share your current struggle or situation:
```bash
harikrupa -t "I am feeling overwhelmed with this release cycle"
```

### Get a Random Verse
For daily grounding and reflection:
```bash
harikrupa random
```

### Manage Settings
* **Update Language:** `harikrupa --lang "Gujarati"`
* **Update API Key:** `harikrupa --key "gsk_..."`
* **Help Menu:** `harikrupa` (with no arguments)

---

## 🏗️ Architecture

Harikrupa operates on a unique "relay" system:
1. **Local Extraction:** Your query is converted into a vector locally using `@xenova/transformers`.
2. **Local Matching:** It finds the best verse match in your local database using Cosine Similarity.
3. **Cloud Inference:** Only the selected verse and query are sent to Groq for mentor commentary, ensuring maximum speed and privacy.

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.
```