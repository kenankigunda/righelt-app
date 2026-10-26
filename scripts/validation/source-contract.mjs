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

// Inspect the actual history-row template, never candidate code execution or comments.
export function historyUndoLabelContract(text) {
 const source=sourceFile('app.js',text),rows=[],matches=[];
 const findRows=node=>{
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='revertButton')rows.push(node);
  ts.forEachChild(node,findRows);
 };
 findRows(source);
 const fail=()=>{throw Error('Unsupported history undo row label contract');};
 if(rows.length!==1||!rows[0].initializer)return fail();
 const visit=node=>{
  if(ts.isTemplateExpression(node)&&node.head.text.includes('data-action="revert-to-move"'))matches.push(node);
  else if(ts.isNoSubstitutionTemplateLiteral(node)&&node.text.includes('data-action="revert-to-move"'))matches.push(node);
  ts.forEachChild(node,visit);
 };
 visit(rows[0].initializer);
 if(matches.length!==1)return fail();
 const template=matches[0],expressions=ts.isTemplateExpression(template)?template.templateSpans.map(span=>span.expression):[];
 const rendered=ts.isTemplateExpression(template)?template.head.text+template.templateSpans.map((span,index)=>`__EXPR_${index}__${span.literal.text}`).join(''):template.text;
 const button=rendered.match(/^<button\b[^>]*data-action="revert-to-move"[^>]*>(.*?)<\/button>$/s);
 if(!button)return fail();
 let label=button[1];
 const icon=label.match(/^__EXPR_(\d+)__/);
 if(icon){
  const expression=expressions[Number(icon[1])];
  if(!expression||!ts.isCallExpression(expression)||!ts.isIdentifier(expression.expression)||expression.expression.text!=='icon'||expression.arguments.length!==1||!ts.isStringLiteral(expression.arguments[0])||expression.arguments[0].text!=='back')return fail();
  label=label.slice(icon[0].length);
 }
 if(!['Undo back to this move','Undo before this move'].includes(label))return fail();
 return label;
}
