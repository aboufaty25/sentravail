const fs = require('fs');
const path = require('path');

// The CSP forbids inline event handlers (script-src-attr 'none'): use Alpine (@click, @submit…) instead.
test('no inline event handlers in views', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (p.endsWith('.ejs')) {
        const text = fs.readFileSync(p, 'utf8');
        const m = text.match(/(?:\s|%>|["'])on(?:click|submit|change|input|load|error|keydown|keyup|focus|blur)\s*=/gi);
        if (m) offenders.push(`${path.relative(process.cwd(), p)}: ${m.join(', ')}`);
      }
    }
  };
  walk(path.join(__dirname, '../src/views'));
  expect(offenders).toEqual([]);
});
