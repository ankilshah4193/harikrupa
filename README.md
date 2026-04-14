# 🙏 Harikrupa

**Ancient wisdom for the modern era.**

Harikrupa is a CLI tool designed to help developers and creators navigate burnout, stress, and life's big questions. It uses a hybrid approach: local semantic search to find the perfect verse from the Bhagavad Gita, and the Groq API to provide a bilingual, mentor-style response tailored specifically to your situation.

---

## 🌟 Features

* **Offline First Search:** Uses a local vector database to find the most relevant Gita verses instantly.
* **Bilingual Wisdom:** Get your answers in English and your preferred language (Gujarati, Hindi, Spanish, Chinese, Arabic, etc.).
* **Modern Voice:** No preachy or outdated language. Just real advice for Millennials, Gen Z, and Gen Alpha.
* **Privacy Minded:** Your API keys and preferences stay on your local machine.

---

## 🚀 Installation

Install the package globally via npm:

```bash
npm install -g harikrupa
```

---

## 🛠️ Setup

After installation, simply run the tool to start the setup wizard:

```bash
harikrupa
```

The wizard will guide you through:
1.  Getting your free Groq API key from [console.groq.com](https://console.groq.com/keys).
2.  Selecting your preferred language for the wisdom.

---

## 📖 Usage

Ask any question about life, work, or stress using the `-t` or `--topic` flag:

```bash
harikrupa -t "I am burnt out writing this code"
```

### Other Commands

* **Change Language:** `harikrupa --lang "Spanish"`
* **Update API Key:** `harikrupa --set-key "your_new_key"`

---

## 🛠️ Technical Stack

* **Vector Search:** Powered by `@xenova/transformers` (local execution).
* **LLM Integration:** High-speed responses via **Groq SDK** (openai/gpt-oss-120b).
* **CLI Framework:** Built with `commander` and `chalk`.

---

## 📄 License

MIT © Ankil Shah
