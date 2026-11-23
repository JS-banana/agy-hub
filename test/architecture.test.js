import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

test('the renderer, input normalization and config rules cannot import host adapters', () => {
  const root = fileURLToPath(new URL('../src', import.meta.url));
  const visited = new Set();
  const builtins = new Set(['node:path', 'node:url', 'node:util']);
  function check(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier)) {
        const name = specifier.text;
        if (name.startsWith('.')) check(resolve(dirname(file), name));
        else assert.ok(builtins.has(name), `${file} imports host adapter ${name}`);
      }
      if (ts.isCallExpression(node)) {
        assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, `${file} dynamically imports a dependency`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  for (const entry of ['render.js', 'state.js', 'config-schema.js']) check(resolve(root, entry));
});
