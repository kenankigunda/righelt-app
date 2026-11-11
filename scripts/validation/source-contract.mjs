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
export function historyUndoLabelContract(text,{renderer=false}={}) {
 const parsed=sourceFile(renderer?'history-rendering.js':'app.js',text);
 const source=renderer?historyRowRenderer(parsed):parsed,rows=[],matches=[];
 const findRows=node=>{
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='revertButton')rows.push(node);
  ts.forEachChild(node,findRows);
 };
 findRows(source);
 const fail=()=>{throw Error('Unsupported history undo row label contract');};
 if(!renderer&&(rows.length!==1||!rows[0].initializer))return fail();
 const visit=node=>{
  if(ts.isTemplateExpression(node)&&node.head.text.includes('data-action="revert-to-move"'))matches.push(node);
  else if(ts.isNoSubstitutionTemplateLiteral(node)&&node.text.includes('data-action="revert-to-move"'))matches.push(node);
  ts.forEachChild(node,visit);
 };
 visit(renderer?source:rows[0].initializer);
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


const historyBindingFailure=()=>{throw Error('Unsupported History renderer source binding');};
const withoutParentheses=node=>{while(node&&ts.isParenthesizedExpression(node))node=node.expression;return node;};

/** Recognize the two released producer layouts without evaluating candidate code.
 * A filename alone never selects a new layout. Public imports, construction and
 * calls bind the separate source; private local aliases are intentionally free. */
export function historyUndoLabelSource(text){
 const source=sourceFile('app.js',text);
 const imports=source.statements.filter(node=>ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text==='./history-rendering.js');
 if(!imports.length)return 'app.js';
 if(imports.length!==1)return historyBindingFailure();
 const bindings=imports[0].importClause?.namedBindings;
 if(!bindings||!ts.isNamedImports(bindings))return historyBindingFailure();
 const factories=bindings.elements.filter(specifier=>(specifier.propertyName??specifier.name).text==='createHistoryRendering');
 if(factories.length!==1)return historyBindingFailure();
 const factory=factories[0].name.text,instances=[];
 for(const statement of source.statements)if(ts.isVariableStatement(statement)&&statement.declarationList.flags&ts.NodeFlags.Const){
  for(const declaration of statement.declarationList.declarations){
   const init=withoutParentheses(declaration.initializer);
   if(ts.isIdentifier(declaration.name)&&init&&ts.isCallExpression(init)&&ts.isIdentifier(init.expression)&&init.expression.text===factory)instances.push(declaration);
  }
 }
 if(instances.length!==1)return historyBindingFailure();
 const instanceDeclaration=instances[0],instance=instanceDeclaration.name.text,calls=new Set();let inlineRows=0,invalid=false;
 const receiver=node=>{
  node=withoutParentheses(node);
  while(node&&(ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node)))node=withoutParentheses(node.expression);
  return node&&ts.isIdentifier(node)&&node.text===instance;
 };
 const visit=node=>{
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)){
   if(node.name.text==='revertButton')inlineRows++;
   if([factory,instance].includes(node.name.text)&&node!==instanceDeclaration)invalid=true;
  }
  if((ts.isParameter(node)||ts.isFunctionDeclaration(node))&&node.name&&ts.isIdentifier(node.name)&&[factory,instance].includes(node.name.text))invalid=true;
  if(ts.isBinaryExpression(node)&&node.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&node.operatorToken.kind<=ts.SyntaxKind.LastAssignment&&(receiver(node.left)||ts.isIdentifier(node.left)&&node.left.text===factory))invalid=true;
  if((ts.isPrefixUnaryExpression(node)||ts.isPostfixUnaryExpression(node))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(node.operator)&&receiver(node.operand))invalid=true;
  if(ts.isDeleteExpression(node)&&receiver(node.expression))invalid=true;
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&ts.isIdentifier(node.expression.expression)&&['Object','Reflect'].includes(node.expression.expression.text)&&['assign','defineProperty','defineProperties','set','deleteProperty','setPrototypeOf'].includes(node.expression.name.text)&&receiver(node.arguments[0]))invalid=true;
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text===instance)calls.add(node.expression.name.text);
  ts.forEachChild(node,visit);
 };
 visit(source);
 if(inlineRows||invalid||!calls.has('renderTurnHistory')||!calls.has('renderAdditionalHistory'))return historyBindingFailure();
 return 'history-rendering.js';
}

function historyRowRenderer(source){
 const factories=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='createHistoryRendering'&&node.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword));
 if(factories.length!==1||!factories[0].body)return historyBindingFailure();
 const body=factories[0].body,returns=body.statements.filter(ts.isReturnStatement);
 if(returns.length!==1||!returns[0].expression||!ts.isObjectLiteralExpression(returns[0].expression))return historyBindingFailure();
 if(returns[0].expression.properties.some(node=>!(ts.isShorthandPropertyAssignment(node)||ts.isPropertyAssignment(node))||!ts.isIdentifier(node.name)))return historyBindingFailure();
 const members=returns[0].expression.properties.filter(node=>(ts.isShorthandPropertyAssignment(node)||ts.isPropertyAssignment(node))&&ts.isIdentifier(node.name)&&node.name.text==='renderTurnHistory');
 if(members.length!==1)return historyBindingFailure();
 const target=ts.isShorthandPropertyAssignment(members[0])?members[0].name:members[0].initializer;
 if(!ts.isIdentifier(target))return historyBindingFailure();
 const declarations=body.statements.filter(statement=>ts.isVariableStatement(statement)&&Boolean(statement.declarationList.flags&ts.NodeFlags.Const)).flatMap(statement=>statement.declarationList.declarations.filter(node=>ts.isIdentifier(node.name)&&node.name.text===target.text));
 if(declarations.length!==1||!declarations[0].initializer||!(ts.isArrowFunction(declarations[0].initializer)||ts.isFunctionExpression(declarations[0].initializer)))return historyBindingFailure();
 return declarations[0].initializer;
}
