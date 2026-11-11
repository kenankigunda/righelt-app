// Controlled DOM collaborators for actual keyed patch/controller execution.
// This is not native hit geometry or browser animation/paint evidence.
export class PaperNode {
 constructor(tag='div',attrs={},text=''){this.nodeType=tag==='#text'?3:1;this.nodeName=tag==='#text'?'#text':tag.toUpperCase();this.tagName=this.nodeName;this.attrs=new Map(Object.entries(attrs));this.childNodes=[];this.parentNode=null;this.value=text;this.css={};this.listeners=new Map();
  this.style=new Proxy({removeProperty:name=>delete this.css[name]},{get:(target,key)=>target[key]??this.css[key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())],set:(_,key,value)=>{this.css[key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())]=String(value);return true;}});
  this.classList={contains:name=>(this.getAttribute('class')??'').split(/\s+/).includes(name)};
  this.dataset=new Proxy({},{get:(_,key)=>this.getAttribute('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase()))??undefined});
 }
 get attributes(){return[...this.attrs,...(Object.keys(this.css).length?[['style',Object.entries(this.css).map(([k,v])=>`${k}:${v}`).join(';')]]:[])].map(([name,value])=>({name,value}));}
 get children(){return this.childNodes.filter(n=>n.nodeType===1);}
 get id(){return this.getAttribute('id');}
 get isConnected(){return this.parentNode?this.parentNode.isConnected:this.connected===true;}
 get textContent(){return this.childNodes.length?this.childNodes.map(n=>n.textContent).join(''):this.value;}
 set textContent(value){this.childNodes=[];this.value=String(value);}
 getAttribute(name){return name==='style'?this.attributes.find(a=>a.name==='style')?.value??null:this.attrs.get(name)??null;}
 hasAttribute(name){return name==='style'?Object.keys(this.css).length>0:this.attrs.has(name);}
 setAttribute(name,value){if(name==='style'){this.css=Object.fromEntries(String(value).split(';').filter(Boolean).map(s=>s.split(':')));}else this.attrs.set(name,String(value));}
 removeAttribute(name){if(name==='style')this.css={};else this.attrs.delete(name);}
 append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.childNodes.push(node);}this.value='';}
 insertBefore(node,before){node.remove();node.parentNode=this;const i=this.childNodes.indexOf(before);this.childNodes.splice(i<0?this.childNodes.length:i,0,node);}
 remove(){if(this.parentNode)this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this),1);this.parentNode=null;}
 contains(node){return node===this||this.childNodes.some(c=>c.contains(node));}
 cloneNode(deep=false){const n=new PaperNode(this.nodeType===3?'#text':this.tagName,Object.fromEntries(this.attrs),this.value);n.css={...this.css};if(deep)n.append(...this.childNodes.map(c=>c.cloneNode(true)));return n;}
 getAnimations(){return[];}
 getBoundingClientRect(){return{left:20,top:30,width:320,height:100,right:340,bottom:130};}
 addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)??[]),fn]);}
 click(){for(const fn of this.listeners.get('click')??[])fn({target:this});}
 matches(selector){
  if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));
  if(selector.startsWith('[')){const m=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]/);if(!m)return false;return m[2]===undefined?this.hasAttribute(m[1]):this.getAttribute(m[1])===m[2];}
  return this.nodeName===selector.toUpperCase();
 }
 querySelectorAll(selector){
  if(selector===':scope > [data-notification-id]')return this.children.filter(c=>c.hasAttribute('data-notification-id'));
  const selectors=selector.split(',');const found=[];for(const node of this.children){if(selectors.some(s=>node.matches(s)))found.push(node);found.push(...node.querySelectorAll(selector));}return[...new Set(found)];
 }
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
}
export const paperCard=({key='info',kind='history-change',priority='normal',tone='',activity='static',count=1,active=true,action=false,details=false,copy='History changed'}={})=>{
 const card=new PaperNode('div',{'data-notification-id':key,'data-key':key,'data-paper-kind':kind,'data-paper-priority':priority,'data-stack-count':String(count),'class':'shell-game-alert-stack-card'+(active?' is-active':'')});
 const paper=new PaperNode('div',{class:`shell-game-alert alert ${tone}`,'data-notification-activity':activity});
 for(const name of ['notice-paper-face','notice-paper-curl'])paper.append(new PaperNode('span',{class:name,'aria-hidden':'true'}));
 const body=new PaperNode('div',{class:'shell-game-alert-copy'});body.append(new PaperNode('#text',{},copy));paper.append(body);
 if(action){const actions=new PaperNode('div',{class:'shell-game-alert-actions'});actions.append(new PaperNode('button',{'data-action':'retry'},'Retry'));paper.append(actions);}
 if(details)paper.append(new PaperNode('details',{},'Details'));
 card.append(paper);return card;
};
export const paperDocument=()=>{
 const body=new PaperNode('body');body.connected=true;const region=new PaperNode('div',{id:'shell-game-alerts'});body.append(region);
 return{body,region,defaultView:{innerWidth:1000,innerHeight:1000,getComputedStyle:()=>({position:'absolute'})},activeElement:null,hidden:false,hasFocus:()=>true,getElementById:id=>id==='shell-game-alerts'?region:null,createElement:name=>new PaperNode(name)};
};
