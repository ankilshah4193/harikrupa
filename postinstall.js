import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const reset = "\x1b[0m";
const cyan = "\x1b[36m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const bold = "\x1b[1m";
const dim = "\x1b[2m";

console.log("\n");
// Dynamically uses the version from package.json
console.log(green + bold + `  🙏 Harikrupa (v${pkg.version}) installed successfully!` + reset);
console.log(dim + "  Ancient wisdom dynamically tailored to modern developer burnout." + reset);
console.log("\n  " + cyan + bold + "GETTING STARTED" + reset);
console.log("  " + "--------------------------------------------------");
console.log("  " + bold + "1. Setup:   " + reset + "harikrupa" + dim + " (starts the wizard)" + reset);
console.log("  " + bold + "2. Ask:     " + reset + 'harikrupa -t "I feel burnt out"' + reset);
console.log("  " + bold + "3. Ground:  " + reset + "harikrupa random" + dim + " (daily verse)" + reset);
console.log("  " + "--------------------------------------------------");
console.log("\n  " + cyan + bold + "HELPFUL COMMANDS" + reset);
console.log("  " + bold + "--lang" + reset + "       Change your language (e.g., " + yellow + "harikrupa --lang Hindi" + reset + ")");
console.log("  " + bold + "--key" + reset + "        Update your Groq API key manually");
console.log("  " + "--------------------------------------------------\n");