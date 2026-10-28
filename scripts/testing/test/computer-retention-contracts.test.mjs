// Pure metadata/closure contracts only. Never import the acceptance driver.
import '../computer-model-retention/test-manifest.mjs';
import '../computer-model-retention/test-browser-contracts.mjs';
import '../computer-model-retention/test-numeric-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

test('retention contract import surface excludes driver, browser and model execution',async()=>{
  const localImports={
    'test-manifest.mjs':['./manifest.mjs','./state-fixture.mjs'],
    'test-browser-contracts.mjs':['./browser-flows.mjs'],
    'test-numeric-source.mjs':['./manifest.mjs'],
    'manifest.mjs':[],
    'state-fixture.mjs':['./manifest.mjs'],
    'browser-flows.mjs':['./state-fixture.mjs'],
  };
  for(const [name,expected]of Object.entries(localImports)) {
    const source=await readFile(new URL(`../computer-model-retention/${name}`,import.meta.url),'utf8');
    const ast=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    assert.equal(ast.parseDiagnostics.length,0,`${name} must remain valid source`);
    const actual=[];
    const visit=node=>{
      if(ts.isImportDeclaration(node)) {
        assert.ok(ts.isStringLiteral(node.moduleSpecifier),'Static literal imports only');
        const specifier=node.moduleSpecifier.text;
        if(!specifier.startsWith('node:'))actual.push(specifier);
      }
      if(ts.isCallExpression(node)) {
        assert.notEqual(node.expression.kind,ts.SyntaxKind.ImportKeyword,'No dynamic package/model imports in pure contracts');
        assert.ok(!(ts.isIdentifier(node.expression)&&['require','eval','Function'].includes(node.expression.text)),'No runtime loader/evaluator in pure contracts');
      }
      ts.forEachChild(node,visit);
    };
    visit(ast);assert.deepEqual(actual.sort(),[...expected].sort(),`${name} crossed the reviewed dependency boundary`);
    if(!name.startsWith('test-'))for(const statement of ast.statements) {
      if(ts.isImportDeclaration(statement)||ts.isFunctionDeclaration(statement))continue;
      assert.ok(ts.isVariableStatement(statement),`${name} has import-time executable statements`);
      for(const declaration of statement.declarationList.declarations) {
        const value=declaration.initializer;
        const frozenMetadata=value&&ts.isCallExpression(value)&&ts.isPropertyAccessExpression(value.expression)&&
          ts.isIdentifier(value.expression.expression)&&value.expression.expression.text==='Object'&&value.expression.name.text==='freeze'&&
          value.arguments.length===1&&ts.isObjectLiteralExpression(value.arguments[0])&&
          value.arguments[0].properties.every(property=>ts.isPropertyAssignment(property)&&ts.isStringLiteral(property.initializer));
        assert.ok(value&&(ts.isArrowFunction(value)||ts.isStringLiteral(value)||frozenMetadata),`${name} initializes runtime work on import`);
      }
    }
  }
});
