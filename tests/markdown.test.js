const RedditMD = require('../markdown.js');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) pass++; else {
    fail++;
    console.log('FAIL:', name);
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual  :', JSON.stringify(actual));
  }
}
function includes(name, haystack, needle) {
  const ok = haystack.includes(needle);
  if (ok) pass++; else { fail++; console.log('FAIL:', name, '→ missing', JSON.stringify(needle), 'in', JSON.stringify(haystack)); }
}

// --- headings
check('h1', RedditMD.toHtml('# Title'), '<h1>Title</h1>');
check('h6 max', RedditMD.toHtml('###### Deep'), '<h6>Deep</h6>');
check('h7 not heading', RedditMD.toHtml('####### No'), /^<p>/.test(RedditMD.toHtml('####### No')) ? '<p>####### No</p>' : '');

// --- bold/italic/strike
includes('bold', RedditMD.toHtml('**bold**'), '<strong>bold</strong>');
includes('bold underscore', RedditMD.toHtml('__bold__'), '<strong>bold</strong>');
includes('italic', RedditMD.toHtml('*it*'), '<em>it</em>');
includes('strike', RedditMD.toHtml('~~gone~~'), '<del>gone</del>');
includes('nested bold+italic', RedditMD.toHtml('**bold *both***'), '<strong>bold <em>both</em></strong>');
includes('code stops bold', RedditMD.toHtml('`**a**`'), '<code>**a**</code>');

// --- lists
includes('ul', RedditMD.toHtml('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
includes('ul star', RedditMD.toHtml('* one'), '<ul><li>one</li></ul>');
includes('ol', RedditMD.toHtml('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>');
includes('ol paren', RedditMD.toHtml('1) one'), '<ol><li>one</li></ol>');

// --- quote / rule
includes('quote', RedditMD.toHtml('> quoted'), '<blockquote><p>quoted</p></blockquote>');
includes('hr', RedditMD.toHtml('---'), '<hr>');

// --- spoiler
includes('spoiler', RedditMD.toHtml('>!secret!<'), 'secret');

// --- link
includes('link', RedditMD.toHtml('[label](https://x.com)'), 'href="https://%22x.com%22"'.replace(/%22/g,''));
includes('link label', RedditMD.toHtml('[label](https://x.com)'), '>label</a>');

// --- tables
const t = RedditMD.toHtml('| a | b |\n| --- | :---: |\n| 1 | 2 |');
includes('table tag', t, '<table');
includes('table th', t, '<th>a</th>');
includes('table align', t, 'text-align:center');
includes('table td', t, '<td>1</td>');
includes("table rows", t, '>2</td>');

const t2 = RedditMD.toHtml('| h |\n| --- |\n| a \\| b |');
includes('escaped pipe', t2, 'a | b');

const t3 = RedditMD.toHtml('| h1 | h2 |\n| --- | --- |\n| only-one-cell |');
includes('short row ok', t3, '<td>only-one-cell</td><td></td>');

const t4 = RedditMD.toHtml('| **bold** | `code` |\n| --- | --- |\n| *it* | ~~s~~ |');
includes('inline in cells', t4, '<strong>bold</strong>');
includes('code in cells', t4, '<code>code</code>');
includes('strike in cells', t4, '<del>s</del>');

// table not confused with paragraph pipes
check('pipe paragraph', RedditMD.toHtml('a | b'), '<p>a | b</p>');

// --- code span
includes('code span', RedditMD.toHtml('use `foo()` now'), '<code>foo()</code>');

// --- raw text mode
const txt = RedditMD.toText('| a | b |\n| --- | --- |\n| 1 | 2 |');
includes('text table border', txt, '┌');
includes('text table cell', txt, 'a');
const txt2 = RedditMD.toText('- one\n- two');
includes('text bullet', txt2, '• one');
const txt3 = RedditMD.toText('**bold**');
includes('unicode bold', txt3, '𝗯𝗼𝗹𝗱');

// --- underline via <u>
includes('underline', RedditMD.toHtml('<u>under</u>'), '<u>under</u>');
includes('underline nested', RedditMD.toHtml('**<u>b</u>**'), '<strong><u>b</u></strong>');
check('normalize keeps u', RedditMD.normalize('<u>x</u>\r\n'), '<u>x</u>\n');

// --- spoiler
includes('spoiler inline', RedditMD.toHtml('a >!secret!< b'), '<span class="badge text-bg-secondary"');
includes('spoiler after hr', RedditMD.toHtml('---\n\n>!secret!<'), '<span class="badge text-bg-secondary"');
check('spoiler not quote', RedditMD.toHtml('>!secret!<'), '<p><span class="badge text-bg-secondary" title="Spoiler (renders as &gt;!…!&lt; on Reddit)">secret</span></p>');

// --- auto-link no infinite recursion
includes('autolink', RedditMD.toHtml('see https://example.com now'), 'href="https://example.com"');

// --- unicode text mode table
const txtT = RedditMD.toText('| Part | Price |\n| --- | --- |\n| CPU | $300 |');
includes('text table header', txtT, 'Part');
includes('text table money', txtT, '$300');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
