// Stage 0: every string-bearing expression in a JS source, with its context.
// A root is a string literal, a template literal, or a '+' chain that has a string leaf. Placeholders are opaque
// tokens (\u0001N\u0002) so that nothing inside an expression can be mistaken for markup.
import * as acorn from 'acorn';
import fs from 'node:fs';

export const PH = '\u0001';
export const PE = '\u0002';

function parseJs(src) {
  const opts = { ecmaVersion: 'latest', locations: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowHashBang: true };
  try { return acorn.parse(src, { ...opts, sourceType: 'script' }); }
  catch (e1) {
    try { return acorn.parse(src, { ...opts, sourceType: 'module' }); }
    catch (e2) { e1.message = 'parse failed: ' + e1.message; throw e1; }
  }
}

const isStr = (n) => n && n.type === 'Literal' && typeof n.value === 'string';
const isTpl = (n) => n && n.type === 'TemplateLiteral';

function chainLeaves(n, out) {
  if (n.type === 'BinaryExpression' && n.operator === '+') { chainLeaves(n.left, out); chainLeaves(n.right, out); }
  else out.push(n);
  return out;
}
const hasStringLeaf = (n) => chainLeaves(n, []).some((l) => isStr(l) || isTpl(l));
const srcOf = (src, n, max = 60) => src.slice(n.start, n.end).replace(/\s+/g, ' ').slice(0, max);

export function rawStrings(src, file, lineOffset = 0) {
  const ast = parseJs(src);
  const out = [];
  const fnStack = [];

  function renderRoot(node) {
    const phs = [];
    const ph = (n) => { phs.push(srcOf(src, n)); return PH + (phs.length - 1) + PE; };
    const renderTpl = (n) => {
      let s = '';
      for (let i = 0; i < n.quasis.length; i++) {
        s += n.quasis[i].value.cooked ?? n.quasis[i].value.raw;
        if (i < n.expressions.length) s += ph(n.expressions[i]);
      }
      return s;
    };
    let text;
    if (isStr(node)) text = node.value;
    else if (isTpl(node)) text = renderTpl(node);
    else { text = ''; for (const l of chainLeaves(node, [])) text += isStr(l) ? l.value : isTpl(l) ? renderTpl(l) : ph(l); }
    return { text, phs };
  }

  // context of a root: climb through wrappers (conditional branches, logical operands, sequence, '+' placeholders)
  function context(anc, node) {
    // anc: array of ancestors, nearest last
    let child = node;
    let i = anc.length - 1;
    const c = {};
    const wrap = [];
    while (i >= 0) {
      const p = anc[i];
      if (p.type === 'ConditionalExpression' && (p.consequent === child || p.alternate === child)) { wrap.push('?:'); child = p; i--; continue; }
      if (p.type === 'LogicalExpression') { wrap.push('||'); child = p; i--; continue; }
      if (p.type === 'BinaryExpression' && p.operator === '+') { wrap.push('+'); child = p; i--; continue; }
      if (p.type === 'TemplateLiteral') { wrap.push('${}'); child = p; i--; continue; }
      if (p.type === 'SequenceExpression' && p.expressions[p.expressions.length - 1] === child) { child = p; i--; continue; }
      if (p.type === 'ParenthesizedExpression') { child = p; i--; continue; }
      break;
    }
    if (wrap.length) c.wrap = wrap.join('');
    const p = anc[i];
    if (!p) { c.t = 'root'; return c; }
    c.t = p.type;
    if (p.type === 'CallExpression' || p.type === 'NewExpression') {
      const idx = p.arguments.indexOf(child);
      if (idx >= 0) { c.callee = srcOf(src, p.callee, 50); c.argIdx = idx; c.argc = p.arguments.length; }
      else if (p.callee === child) c.t = 'Callee';
    } else if (p.type === 'Property') {
      c.key = p.key.type === 'Identifier' ? p.key.name : String(p.key.value);
      c.isKey = p.key === child;
    } else if (p.type === 'AssignmentExpression') {
      c.target = srcOf(src, p.left, 50); c.op = p.operator; c.onLeft = p.left === child;
    } else if (p.type === 'VariableDeclarator') {
      c.target = srcOf(src, p.id, 40);
    } else if (p.type === 'BinaryExpression') {
      c.op = p.operator;
    } else if (p.type === 'SwitchCase') { c.op = 'case'; }
    else if (p.type === 'MemberExpression') { c.prop = p.computed ? '[]' : p.property.name; c.isObject = p.object === child; }
    else if (p.type === 'ArrayExpression') {
      // the array's own context
      const gp = anc[i - 1];
      c.arrLen = p.elements.length;
      if (gp) {
        if (gp.type === 'VariableDeclarator') c.arrTarget = srcOf(src, gp.id, 40);
        else if (gp.type === 'Property') c.arrKey = gp.key.type === 'Identifier' ? gp.key.name : String(gp.key.value);
        else if (gp.type === 'CallExpression') { c.arrCallee = srcOf(src, gp.callee, 50); c.arrArgIdx = gp.arguments.indexOf(p); }
        else if (gp.type === 'AssignmentExpression') c.arrTarget = srcOf(src, gp.left, 40);
        else if (gp.type === 'MemberExpression') c.arrProp = gp.computed ? '[]' : gp.property.name;
        else c.arrParent = gp.type;
      }
    }
    return c;
  }

  const anc = [];
  function walk(node, key) {
    if (!node || typeof node.type !== 'string') return;
    const parent = anc[anc.length - 1];
    let pushedFn = false;
    if (/Function/.test(node.type)) {
      let name = node.id && node.id.name;
      if (!name && parent) {
        if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') name = parent.id.name;
        else if (parent.type === 'AssignmentExpression') name = srcOf(src, parent.left, 40);
        else if (parent.type === 'Property') name = parent.key.name || String(parent.key.value);
      }
      fnStack.push(name || '(anon)'); pushedFn = true;
    }
    const inChain = parent && parent.type === 'BinaryExpression' && parent.operator === '+' && hasStringLeaf(parent);
    const isRoot = (isStr(node) || isTpl(node) || (node.type === 'BinaryExpression' && node.operator === '+' && hasStringLeaf(node))) && !inChain;
    if (isRoot) {
      const skip = (parent && parent.type === 'Property' && parent.key === node && !parent.computed)
        || (parent && parent.type === 'ExpressionStatement' && parent.directive)
        || (parent && (parent.type === 'ImportDeclaration' || parent.type === 'ExportAllDeclaration' || parent.type === 'ExportNamedDeclaration') && parent.source === node)
        || (parent && parent.type === 'MemberExpression' && parent.computed && parent.property === node)
        || (parent && parent.type === 'MethodDefinition');
      if (!skip) {
        const { text, phs } = renderRoot(node);
        out.push({
          file, line: node.loc.start.line + lineOffset,
          fn: fnStack.filter((x) => x !== '(anon)').slice(-2).join(' > '),
          ctx: context(anc, node), text, phs, kind: isStr(node) ? 'lit' : isTpl(node) ? 'tpl' : 'cat',
        });
      }
    }
    // descend: for string roots only into their expression parts (placeholders / template expressions)
    anc.push(node);
    if (isRoot && isStr(node)) { /* nothing inside */ }
    else if (node.type === 'BinaryExpression' && node.operator === '+' && hasStringLeaf(node)) {
      // chain: visit non-string leaves (they may hold nested strings) and template expressions
      for (const l of chainLeaves(node, [])) {
        if (isStr(l)) continue;
        if (isTpl(l)) { anc.push(l); for (const e of l.expressions) walk(e, 'expressions'); anc.pop(); }
        else walk(l, 'leaf');
      }
    } else if (isTpl(node)) {
      for (const e of node.expressions) walk(e, 'expressions');
    } else {
      for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'loc' || k === 'start' || k === 'end') continue;
        const v = node[k];
        if (Array.isArray(v)) v.forEach((c) => walk(c, k));
        else if (v && typeof v.type === 'string') walk(v, k);
      }
    }
    anc.pop();
    if (pushedFn) fnStack.pop();
  }
  walk(ast, undefined);
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('raw.mjs') && process.argv[2]) {
  const file = process.argv[2];
  const src = fs.readFileSync(file, 'utf8');
  const recs = rawStrings(src, file);
  console.log(recs.length);
  for (const r of recs.slice(0, 40)) console.log(r.line, JSON.stringify(r.ctx), JSON.stringify(r.text.replace(/[\u0001\u0002]/g, '|')).slice(0, 120));
}
