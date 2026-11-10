import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import ts from 'typescript';

const sourceExtension=/\.(?:[cm]?[jt]sx?|py|sh|ya?ml|css|html)$/i;
const testFile=/(?:\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?)$/;
const fsModule=value=>/^(?:node:)?fs(?:\/promises)?$/.test(value);
const textValue=node=>node&&(ts.isStringLiteralLike(node)?node.text:null);

// Inspect syntax only. Never load or execute a candidate test or source fragment.
export function inspectModule(file,source) {
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const readers=new Set(),namespaces=new Set(),bindings=new Map(),assigned=new Set(),dependencies=[];
 const visit=node=>{
  if(ts.isBinaryExpression(node)&&node.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&node.operatorToken.kind<=ts.SyntaxKind.LastAssignment&&ts.isIdentifier(node.left))assigned.add(node.left.text);
  if((ts.isPostfixUnaryExpression(node)||ts.isPrefixUnaryExpression(node))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(node.operator)&&ts.isIdentifier(node.operand))assigned.add(node.operand.text);
  if(ts.isExportDeclaration(node)&&node.moduleSpecifier){const from=textValue(node.moduleSpecifier);if(from?.startsWith('.'))dependencies.push(from);}
  if(ts.isImportDeclaration(node)){
   const from=textValue(node.moduleSpecifier),clause=node.importClause;
   if(from?.startsWith('.'))dependencies.push(from);
   if(fsModule(from??'')){
    if(clause?.name)namespaces.add(clause.name.text);
    const named=clause?.namedBindings;
    if(named&&ts.isNamespaceImport(named))namespaces.add(named.name.text);
    if(named&&ts.isNamedImports(named))for(const item of named.elements)if(/^readFile(?:Sync)?$/.test((item.propertyName??item.name).text))readers.add(item.name.text);
   }
  }
  if(ts.isVariableDeclaration(node)&&node.initializer){
   if(ts.isIdentifier(node.name)){
    // A repeated name may belong to another lexical scope. Fail closed rather than selecting a misleading data literal.
    bindings.set(node.name.text,bindings.has(node.name.text)?null:node.initializer);
    if(ts.isAwaitExpression(node.initializer)&&ts.isCallExpression(node.initializer.expression)&&node.initializer.expression.expression.kind===ts.SyntaxKind.ImportKeyword&&fsModule(textValue(node.initializer.expression.arguments[0])??''))namespaces.add(node.name.text);
   }
   if(ts.isObjectBindingPattern(node.name)&&/import\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)/.test(node.initializer.getText(ast)))
    for(const item of node.name.elements)if(/^readFile(?:Sync)?$/.test((item.propertyName??item.name).getText(ast)))readers.add(item.name.getText(ast));
  }
  ts.forEachChild(node,visit);
 };visit(ast);
 for(const name of assigned)bindings.set(name,null);
 const resolve=(node,seen=new Set())=>{
  if(!node)return null;
  const literal=textValue(node);if(literal!==null)return literal;
  if(ts.isIdentifier(node)&&bindings.get(node.text)&&!seen.has(node.text))return resolve(bindings.get(node.text),new Set([...seen,node.text]));
  if(ts.isPropertyAccessExpression(node)&&node.getText(ast)==='import.meta.dirname')return path.posix.dirname(file);
  if((ts.isNewExpression(node)||ts.isCallExpression(node))&&node.expression.getText(ast)==='URL'){
   const relative=resolve(node.arguments?.[0],seen);return relative===null?null:path.posix.normalize(path.posix.join(path.posix.dirname(file),relative));
  }
  if(ts.isCallExpression(node)&&/^(?:path\.)?(?:join|resolve)$/.test(node.expression.getText(ast))){
   const values=node.arguments.map(arg=>resolve(arg,seen));return values.some(v=>v===null)?null:path.posix.normalize(values.join('/'));
  }
  return null;
 };
 const reads=[];
 const scan=node=>{
  if(ts.isCallExpression(node)){
   const callee=node.expression;
   const isRead=ts.isIdentifier(callee)?readers.has(callee.text):ts.isPropertyAccessExpression(callee)&&/^readFile(?:Sync)?$/.test(callee.name.text)&&namespaces.has(callee.expression.getText(ast));
   if(isRead){
    const target=resolve(node.arguments[0]);
    // Unresolved reads require classification rather than silently escaping enforcement.
    if(target===null||sourceExtension.test(target))reads.push(target??`unresolved:${node.arguments[0]?.getText(ast)??'<missing>'}`);
   }
   if(callee.kind===ts.SyntaxKind.ImportKeyword){const from=textValue(node.arguments[0]);if(from?.startsWith('.'))dependencies.push(from);}
  }
  ts.forEachChild(node,scan);
 };scan(ast);
 return {reads:[...new Set(reads)].sort(),dependencies:[...new Set(dependencies)]};
}
export function sourceReaders(root,{files,read}={}) {
 files??=execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const available=new Set(files),seen=new Set(),findings=[];
 const load=read??(file=>readFileSync(path.join(root,file),'utf8'));
 const visit=file=>{
  if(seen.has(file))return;seen.add(file);
  const module=inspectModule(file,load(file));
  if(module.reads.length)findings.push({file,targets:module.reads});
  // Follow test-local support, not imported production implementations.
  for(const relative of module.dependencies){
   const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),relative));
   if(!/(?:^|\/)(?:test|tests|support|e2e|browser-integration|validation-e2e)(?:\/|$)/.test(target))continue;
   const resolved=[target,`${target}.mjs`,`${target}.js`,`${target}.ts`].find(f=>available.has(f));if(resolved)visit(resolved);
  }
 };
 for(const file of files.filter(f=>testFile.test(f)))visit(file);
 return findings.sort((a,b)=>a.file.localeCompare(b.file));
}
export function policyProblems(findings,policy) {
 const problems=[],entries=[...(policy.legacy??[]),...(policy.artifacts??[])],byFile=new Map();
 if(policy.version!==2)problems.push('Expected source inspection policy version 2');
 for(const entry of entries){
  if(byFile.has(entry.file))problems.push(`Duplicate entry: ${entry.file}`);byFile.set(entry.file,entry);
  if(!entry.reason?.trim())problems.push(`Missing contract reason: ${entry.file}`);
 }
 for(const entry of policy.artifacts??[])if(!['workflow','configuration','generated','vendor'].includes(entry.kind)||!entry.whyExecutionInsufficient?.trim())problems.push(`Artifact exception needs kind and why execution cannot prove it: ${entry.file}`);
 const observed=new Map(findings.map(item=>[item.file,item]));
 for(const finding of findings){
  const entry=byFile.get(finding.file);
  if(!entry){problems.push(`Unexpected source reader: ${finding.file} (${finding.targets.join(', ')}). Execute production behavior or document an artifact contract.`);continue;}
  for(const target of finding.targets)if(!entry.targets.includes(target))problems.push(`Unclassified source read: ${finding.file}: ${target}`);
 }
 for(const entry of entries){
  const targets=observed.get(entry.file)?.targets??[];
  for(const target of entry.targets)if(!targets.includes(target))problems.push(`Stale source exception: ${entry.file}: ${target}`);
 }
 return problems;
}

// Retain the inventory in Git: a future squash merge may not retain the original PR commit.
export const LEGACY_BASELINE='64443d2d530ea9206403154b0120e6ff8cc5d8a4';
const baselineBytes=readFileSync(new URL('./source-inspection-legacy-baseline.json',import.meta.url));
const baseline=JSON.parse(baselineBytes);
const baselineReaders=new Map(baseline.readers.map(entry=>[entry.file,entry.targets]));
const BASELINE_DIGEST='4d28afe1ad8ade643fdd1fa5514512de6e0664b3aa2a003671a53106e5c045c8';
export function legacyProblems(policy,readBaseline=file=>baselineReaders.get(file)) {
 const problems=[];
 if(policy.baselineRevision!==LEGACY_BASELINE)problems.push('Legacy baseline revision must not change');
 for(const entry of policy.legacy??[]){
  let reads;
  try { reads=readBaseline(entry.file); }
  catch {reads=null;}
  if(!reads){problems.push(`New legacy reader is forbidden: ${entry.file}`);continue;}
  for(const target of entry.targets)if(!reads.includes(target))problems.push(`New legacy target is forbidden: ${entry.file}: ${target}`);
 }
 return problems;
}
export function checkPolicy(root,policy) {
 const baselineProblems=createHash('sha256').update(baselineBytes).digest('hex')!==BASELINE_DIGEST||baseline.revision!==LEGACY_BASELINE?['Frozen legacy baseline changed; do not regenerate it to silence violations']:[];
 return [...baselineProblems,...policyProblems(sourceReaders(root),policy),...legacyProblems(policy)];
}
