const MarkdownEngine = require('../markdown.js');

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
check('h1', MarkdownEngine.toHtml('# Title'), '<h1>Title</h1>');
check('h6 max', MarkdownEngine.toHtml('###### Deep'), '<h6>Deep</h6>');
check('h7 not heading', MarkdownEngine.toHtml('####### No'), /^<p>/.test(MarkdownEngine.toHtml('####### No')) ? '<p>####### No</p>' : '');

// --- bold/italic/strike
includes('bold', MarkdownEngine.toHtml('**bold**'), '<strong>bold</strong>');
includes('bold underscore', MarkdownEngine.toHtml('__bold__'), '<strong>bold</strong>');
includes('italic', MarkdownEngine.toHtml('*it*'), '<em>it</em>');
includes('strike', MarkdownEngine.toHtml('~~gone~~'), '<del>gone</del>');
includes('nested bold+italic', MarkdownEngine.toHtml('**bold *both***'), '<strong>bold <em>both</em></strong>');
includes('code stops bold', MarkdownEngine.toHtml('`**a**`'), '<code>**a**</code>');

// --- lists
includes('ul', MarkdownEngine.toHtml('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
includes('ul star', MarkdownEngine.toHtml('* one'), '<ul><li>one</li></ul>');
includes('ol', MarkdownEngine.toHtml('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>');
includes('ol paren', MarkdownEngine.toHtml('1) one'), '<ol><li>one</li></ol>');

// --- quote / rule
includes('quote', MarkdownEngine.toHtml('> quoted'), '<blockquote><p>quoted</p></blockquote>');
includes('hr', MarkdownEngine.toHtml('---'), '<hr>');

// --- nested lists
check('nested ul', MarkdownEngine.toHtml('- a\n  - b\n- c'),
  '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
check('nested ol in ul', MarkdownEngine.toHtml('- a\n  1. one\n  2. two\n- c'),
  '<ul><li>a<ol><li>one</li><li>two</li></ol></li><li>c</li></ul>');
check('deep nest', MarkdownEngine.toHtml('- a\n  - b\n    - c'),
  '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>');
check('dedent resumes parent', MarkdownEngine.toHtml('- a\n  - b\n- c'),
  '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
check('ordered start attr', MarkdownEngine.toHtml('3. a\n4. b'),
  '<ol start="3"><li>a</li><li>b</li></ol>');
check('different kind breaks list', MarkdownEngine.toHtml('1. a\n- b'),
  '<ol><li>a</li></ol>\n<ul><li>b</li></ul>');
check('empty item', MarkdownEngine.toHtml('- a\n-\n- c'),
  '<ul><li>a</li><li></li><li>c</li></ul>');
check('continuation paragraph', MarkdownEngine.toHtml('- a\n  more text'),
  '<ul><li>a<p>more text</p></li></ul>');

// --- spoiler
includes('spoiler', MarkdownEngine.toHtml('>!secret!<'), 'secret');

// --- link
includes('link', MarkdownEngine.toHtml('[label](https://x.com)'), 'href="https://%22x.com%22"'.replace(/%22/g,''));
includes('link label', MarkdownEngine.toHtml('[label](https://x.com)'), '>label</a>');

// --- tables
const t = MarkdownEngine.toHtml('| a | b |\n| --- | :---: |\n| 1 | 2 |');
includes('table tag', t, '<table');
includes('table th', t, '<th>a</th>');
includes('table align', t, 'text-align:center');
includes('table td', t, '<td>1</td>');
includes("table rows", t, '>2</td>');

const t2 = MarkdownEngine.toHtml('| h |\n| --- |\n| a \\| b |');
includes('escaped pipe', t2, 'a | b');

const t3 = MarkdownEngine.toHtml('| h1 | h2 |\n| --- | --- |\n| only-one-cell |');
includes('short row ok', t3, '<td>only-one-cell</td><td></td>');

const t4 = MarkdownEngine.toHtml('| **bold** | `code` |\n| --- | --- |\n| *it* | ~~s~~ |');
includes('inline in cells', t4, '<strong>bold</strong>');
includes('code in cells', t4, '<code>code</code>');
includes('strike in cells', t4, '<del>s</del>');

// table not confused with paragraph pipes
check('pipe paragraph', MarkdownEngine.toHtml('a | b'), '<p>a | b</p>');

// --- code span
includes('code span', MarkdownEngine.toHtml('use `foo()` now'), '<code>foo()</code>');

// --- raw text mode
const txt = MarkdownEngine.toText('| a | b |\n| --- | --- |\n| 1 | 2 |');
includes('text table border', txt, '┌');
includes('text table cell', txt, 'a');
const txt2 = MarkdownEngine.toText('- one\n- two');
includes('text bullet', txt2, '• one');
const txt3 = MarkdownEngine.toText('**bold**');
includes('unicode bold', txt3, '𝗯𝗼𝗹𝗱');

// --- underline via <u>
includes('underline', MarkdownEngine.toHtml('<u>under</u>'), '<u>under</u>');
includes('underline nested', MarkdownEngine.toHtml('**<u>b</u>**'), '<strong><u>b</u></strong>');
check('normalize keeps u', MarkdownEngine.normalize('<u>x</u>\r\n'), '<u>x</u>\n');

// --- spoiler
includes('spoiler inline', MarkdownEngine.toHtml('a >!secret!< b'), '<span class="badge text-bg-secondary"');
includes('spoiler after hr', MarkdownEngine.toHtml('---\n\n>!secret!<'), '<span class="badge text-bg-secondary"');
check('spoiler not quote', MarkdownEngine.toHtml('>!secret!<'), '<p><span class="badge text-bg-secondary" title="Spoiler (renders as &gt;!…!&lt; on Reddit)">secret</span></p>');

// --- auto-link no infinite recursion
includes('autolink', MarkdownEngine.toHtml('see https://example.com now'), 'href="https://example.com"');

// --- unicode text mode table
const txtT = MarkdownEngine.toText('| Part | Price |\n| --- | --- |\n| CPU | $300 |');
includes('text table header', txtT, 'Part');
includes('text table money', txtT, '$300');

// --- table round-trip (shared with the table builder)
const tP = MarkdownEngine.parseTableLines(['| Name | Qty |', '| :-- | --: |', '| apple | 2 |']);
check('parseTableLines header', JSON.stringify(tP && tP.header), '["Name","Qty"]');
check('parseTableLines align', JSON.stringify(tP && tP.align), '["left","right"]');
check('parseTableLines rows', JSON.stringify(tP && tP.rows), '[["apple","2"]]');
check('parseTableLines rejects non-table', MarkdownEngine.parseTableLines(['hello', 'world']), null);
const tM = MarkdownEngine.toTableMarkdown({ header: ['A', 'B'], align: ['center', null], rows: [['x \| y', 'z']] });
check('toTableMarkdown line 1', tM.split('\n')[0], '| A | B |');
check('toTableMarkdown align center', tM.split('\n')[1], '| :--: | -- |');
includes('toTableMarkdown escapes pipes', tM, 'x \\| y');
const tP2 = MarkdownEngine.parseTableLines(tM.split('\n'));
check('table round-trip', tP2 && tP2.rows[0][0] === 'x \| y', true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
