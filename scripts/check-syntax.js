const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const scriptRegex = /<script(?:\s+type="module")?>([\s\S]*?)<\/script>/gi;
let match;
let count = 0;

while ((match = scriptRegex.exec(html)) !== null) {
  count++;
  const code = match[1];
  if (code.includes('import ') || code.includes('export ')) {
    console.log(`Script ${count} is ES Module`);
    continue;
  }
  try {
    new vm.Script(code);
    console.log(`Script ${count} syntax OK`);
  } catch (err) {
    console.error(`Script ${count} syntax error:`, err);
    process.exit(1);
  }
}
console.log('All inline scripts parsed without syntax errors!');
