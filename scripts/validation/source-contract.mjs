import ts from 'typescript';

// Parse declarations only. Candidate source is never imported or evaluated.
export const sourceFile = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
export function exportedConstant(source, name, label) {
  const matches = source.statements.filter(statement => ts.isVariableStatement(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))
    .flatMap(statement => statement.declarationList.declarations.filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name)
      .map(declaration => ({ declaration, constant: Boolean(statement.declarationList.flags & ts.NodeFlags.Const) })));
  if (!matches.length) return null;
  if (matches.length !== 1 || !matches[0].constant || !matches[0].declaration.initializer) throw Error(`Unsupported ${label} contract declaration`);
  return matches[0].declaration.initializer;
}
export function stringContract(source, name, allowed, label) {
  const value = exportedConstant(source, name, label);
  if (!value) return 'legacy';
  if (!ts.isStringLiteral(value) || !allowed.includes(value.text)) throw Error(`Unsupported ${label} contract declaration`);
  return value.text;
}
export function currentModelContract(text) {
  const fail = () => { throw Error('Unsupported current computer model contract declaration'); };
  const value = exportedConstant(sourceFile('computer-play.ts', text), 'CURRENT_COMPUTER_MODEL', 'current computer model');
  if (!value || !ts.isCallExpression(value) || !ts.isPropertyAccessExpression(value.expression)
      || !ts.isIdentifier(value.expression.expression) || value.expression.expression.text !== 'Object' || value.expression.name.text !== 'freeze'
      || value.arguments.length !== 1 || !ts.isObjectLiteralExpression(value.arguments[0])) return fail();
  const model = {};
  for (const property of value.arguments[0].properties) {
    if (!ts.isPropertyAssignment(property) || (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))) return fail();
    const key = property.name.text, literal = property.initializer;
    if (Object.hasOwn(model, key) || !['id','sha256','bytes','checkpoint','url','experimental'].includes(key)) return fail();
    if (ts.isStringLiteral(literal)) model[key] = literal.text;
    else if (ts.isNumericLiteral(literal)) model[key] = Number(literal.text);
    else if (literal.kind === ts.SyntaxKind.TrueKeyword || literal.kind === ts.SyntaxKind.FalseKeyword) model[key] = literal.kind === ts.SyntaxKind.TrueKeyword;
    else return fail();
  }
  if (['id','sha256','checkpoint','url'].some(key => typeof model[key] !== 'string') || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(model.id ?? '') || !/^[a-f0-9]{64}$/.test(model.sha256 ?? '')
      || !/^[a-f0-9]{64}$/.test(model.checkpoint ?? '') || !Number.isSafeInteger(model.bytes) || model.bytes <= 0
      || model.url !== `/computer/models/${model.id}.onnx` || typeof model.experimental !== 'boolean') return fail();
  return Object.freeze(model);
}
