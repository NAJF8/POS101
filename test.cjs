const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, 'dist', 'assets');
const files = fs.readdirSync(assetsDir);
const jsFile = files.find(f => f.endsWith('.js'));
const bundleContent = fs.readFileSync(path.join(assetsDir, jsFile), 'utf8');

const html = `
<!DOCTYPE html>
<html>
<body>
  <div id="root"></div>
  <script>${bundleContent}</script>
</body>
</html>
`;

const dom = new JSDOM(html, { 
  runScripts: 'dangerously', 
  url: 'http://localhost/POS101/' 
});

dom.window.onerror = (msg, url, line, col, err) => {
  console.log('REACT RUNTIME ERROR:', msg);
  console.log(err?.stack);
};

setTimeout(() => {
  const root = dom.window.document.getElementById('root');
  if (root.innerHTML.length > 50) {
    console.log('RENDER SUCCESS');
  } else {
    console.log('RENDER FAILED. HTML:', root.innerHTML);
  }
}, 2000);
