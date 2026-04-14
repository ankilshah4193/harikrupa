// postinstall.js
const reset = "\x1b[0m";
const cyan = "\x1b[36m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const bold = "\x1b[1m";
const dim = "\x1b[2m";

console.log("\n");
console.log(green + bold + "  🙏 Harikrupa (v2.0.7) installed successfully!" + reset);
console.log(dim + "  Ancient wisdom for the modern era." + reset);
console.log("\n  " + cyan + bold + "GETTING STARTED" + reset);
console.log("  " + "--------------------------------------------------");
console.log("  " + bold + "1. Connect:  " + reset + "harikrupa" + dim + " (starts the setup wizard)" + reset);
console.log("  " + bold + "2. Ask:     " + reset + 'harikrupa -t "I feel burnt out"' + reset);
console.log("  " + "--------------------------------------------------");
console.log("\n  " + cyan + bold + "HELPFUL COMMANDS" + reset);
console.log("  " + bold + "--lang" + reset + "       Change your language (e.g., " + yellow + "harikrupa --lang Spanish" + reset + ")");
console.log("  " + bold + "--set-key" + reset + "    Update your Groq API key manually");
console.log("  " + bold + "--version" + reset + "    Check current version");
console.log("\n  " + dim + "Get your free API key at: https://console.groq.com/keys" + reset);
console.log("\n");