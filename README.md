# Harikrupa

**🙏 Ancient wisdom dynamically tailored to modern developer burnout.**

[![npm version](https://img.shields.io/npm/v/harikrupa.svg)](https://www.npmjs.com/package/harikrupa)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Harikrupa is a lightweight, high-performance CLI tool designed to help developers navigate burnout, stress, and life's complex decisions. It utilizes a Hybrid RAG (Retrieval-Augmented Generation) Architecture: performing zero-latency semantic search locally, followed by high-speed inference via the Groq API to provide a customized, bilingual response.

Named from the Sanskrit Hari (a name for the Divine, often associated with Lord Krishna) and Kripa (grace) .. literally "the grace of the Divine" .. this CLI brings a small moment of that grace into your terminal, one verse at a time.

---

## 🌟 Core Features

* **🧠 Smart Semantic Search:** Uses a local vector database to find the perfect matching Bhagavad Gita verse for your specific situation.
* **🎲 Verse of the Day:** Use the `random` command for a quick grounding thought without needing to ask a specific question.
* **🌍 Bilingual Perspective:** Get structured wisdom in English and your preferred language side-by-side. Built-in native-script headings for 20+ languages (Gujarati → `ગુજરાતી દ્રષ્ટિકોણ`, Hindi → `हिंदी दृष्टिकोण`, Japanese → `日本語の視点`, Spanish → `Perspectiva en Español`, French → `Perspective en Français`, Punjabi → `ਪੰਜਾਬੀ ਦ੍ਰਿਸ਼ਟੀਕੋਣ`, etc.); any other language is translated dynamically by the AI.
* **🎨 Aesthetic UI:** Fully color-coded terminal output with Gold perspectives, Cyan subheaders, and dimmed body text for better focus.
* **📴 Always-Available Verse:** The verse always reaches you. Offline, rate-limited, or any API issue, Harikrupa falls back to the local database so you never walk away empty-handed.
* **💸 100% Free AI:** Uses Groq's LPU technology for near-instant answers. No credit card or subscription required.
* **🩹 Clear Error Messages:** When something goes wrong (expired key, rate limit, network issue, corrupt install), Harikrupa tells you exactly what happened and the one command that will fix it.

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

## 💸 Cost Model

Harikrupa is free to use end to end.

You bring your own free Groq API key, generated in about 30 seconds with no credit card. Groq's free tier is generous, and for the low volume a personal wellness tool generates, most users will never hit a limit. If you ever do, Harikrupa falls back to the local database and still delivers the verse with Sanskrit and pre-downloaded translations. The AI commentary is the only part that is temporarily disabled, and you will see a plain-English message pointing you to your Groq usage page.

The verse database is bundled locally with the package: the original Sanskrit verse plus its meaning in 8 languages (Sanskrit, English, Hindi, Gujarati, Punjabi, Tamil, Telugu, Kannada). No network, no API, no limits for that part.

I do not proxy or host any LLM inference. Your API key lives locally in `~/.harikrupa.json` on your machine. I never see or touch it.

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
* **Update API Key (interactive):** `harikrupa --key` — press ENTER to open the Groq console in your browser, then paste the key back.
* **Help Menu:** `harikrupa` (with no arguments) — also shows your currently configured language and whether your key is set.

---

## 🏢 Corporate / Org Laptop Users

Harikrupa requires outbound network access to three external services. Before installing, confirm these are reachable on your network:

| Service | Domain | Purpose |
|---|---|---|
| npm registry | `registry.npmjs.org` | Package install |
| Hugging Face | `huggingface.co` | One-time model download (~25 MB) |
| Groq API | `api.groq.com` | AI-guided response |

If any of these are blocked by your IT or firewall policy, here are your options:

**Option 1 — npm Proxy Config**
If your org routes traffic through a proxy:
```bash
npm config set proxy http://your-corporate-proxy:8080
npm config set https-proxy http://your-corporate-proxy:8080
npm install -g harikrupa
```

**Option 2 — Personal Machine or Hotspot**
Run harikrupa on a personal device, or tether your org laptop to a personal hotspot for the install and model download. Once installed, the verse always reaches you from the local database, even if Groq is unreachable.

> 💡 Even when the AI commentary is unavailable for any reason (offline, rate limit, blocked firewall), Harikrupa always falls back to the local database and still delivers the Sanskrit verse and pre-downloaded translations.

---

## 🔧 Troubleshooting

Harikrupa prints targeted, actionable guidance whenever something goes wrong. You'll see a short diagnosis and the exact command that fixes it. The most common situations:

* **"Your Groq API key was rejected."** — Your key is expired, revoked, or mistyped. The tool still shows you the matched verse from the local database. Run `harikrupa --key` to set a new one and restore AI commentary.
* **"Groq is rate-limiting this key right now."** — Too many requests in a short window. The tool still shows you the verse from the local database. Wait a minute and retry for the AI commentary; you can check your usage at [console.groq.com/settings/limits](https://console.groq.com/settings/limits).
* **"Cannot reach Groq."** — Network issue. Harikrupa still delivers the verse from the local database, just without AI commentary.
* **"Local verse database is missing or corrupt."** — Something went wrong during install. Reinstall with `npm uninstall -g harikrupa && npm install -g harikrupa`.
* **"The local AI model failed to load."** — On first run Harikrupa downloads a tiny (~25 MB) embedding model. Make sure you have internet, or run `harikrupa random` which skips the model entirely.

### Verbose mode

If you're filing a bug report or want to see the underlying stack trace, prefix the command with `DEBUG=harikrupa`:

```bash
DEBUG=harikrupa harikrupa -t "your question"
```

### Still stuck?

Please [open an issue](https://github.com/ankilshah4193/harikrupa/issues) with the error message and, if possible, the output of the verbose run above.

---

## 🏗️ Architecture

Harikrupa operates on a unique "relay" system:
1. **Local Extraction:** Your query is converted into a vector locally using `@xenova/transformers`.
2. **Local Matching:** It finds the best verse match in your local database using Cosine Similarity.
3. **Cloud Inference:** Only the selected verse and query are sent to Groq for mentor commentary, ensuring maximum speed and privacy.
4. **Graceful Fallback:** If Groq is unreachable, rate-limited, or the key is rejected, Harikrupa falls back to the local database and still delivers the verse with Sanskrit and pre-downloaded translations.

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.
