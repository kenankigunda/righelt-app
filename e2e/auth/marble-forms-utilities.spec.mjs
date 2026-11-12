import {mkdir, writeFile} from 'node:fs/promises';
import {test, expect} from '@playwright/test';
import {revealAccountEntry, waitForAccountStartup} from './helpers.mjs';
import {AUTH_CONTROL_ORIGIN} from './fixture.mjs';
import {waitForOverlayEntry} from '../support/overlay-motion.mjs';

const password = 'Marble utility acceptance password 426';
const dialog = page => page.getByTestId('account-dialog');

async function openAccount(page) {
  await (await revealAccountEntry(page)).click();
  await expect(dialog(page)).toBeVisible();
}
async function registerFromAccount(page, prefix) {
  await openAccount(page);
  await dialog(page).getByRole('button', {name:'Create account', exact:true}).click();
  const username = `${prefix}_${Date.now().toString(36)}`;
  await dialog(page).getByLabel('Username', {exact:true}).fill(username);
  await dialog(page).getByLabel('Password', {exact:true}).fill(password);
  await expect(dialog(page).getByTestId('password-requirements').locator('[data-state="met"]')).toHaveCount(3);
  await dialog(page).getByRole('button', {name:'Create account & continue', exact:true}).click();
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.getByTestId('account-open')).toHaveAttribute('data-authenticated','true');
  return username;
}
async function openUtility(page, name) {
  const button = page.getByRole('button', {name, exact:true});
  if (!await button.isVisible()) await page.getByRole('button', {name:'Open navigation menu', exact:true}).click();
  await button.click();
  const flyout = page.locator(`[data-flyout="${name.toLowerCase()}"]`);
  await expect(flyout).toBeVisible();
  await waitForOverlayEntry(flyout);
  return flyout;
}
async function glassFace(root) {
  const material = await root.evaluate(node => {
    const before = getComputedStyle(node,'::before');
    const layers = [node,...node.querySelectorAll('*')].flatMap(element => ['', '::before', '::after'].map(pseudo => {
      const style = getComputedStyle(element,pseudo || null);
      return {filter:style.backdropFilter || style.webkitBackdropFilter || 'none', content:style.content};
    })).filter(layer => layer.filter !== 'none' && layer.content !== 'none');
    return {background:before.backgroundImage, filter:before.backdropFilter || before.webkitBackdropFilter || 'none', diffusionLayers:layers.length};
  });
  expect(material.background).toContain('linear-gradient');
  expect(material.filter).toMatch(/blur\(/);
  expect(material.diffusionLayers).toBe(1);
  return material;
}
async function selectFirstThree(field) {
  await field.focus();
  await field.press('ControlOrMeta+a');
  await field.press('ArrowLeft');
  for (let i=0;i<3;i++) await field.press('Shift+ArrowRight');
  await expect(field).toBeFocused();
  expect(await field.evaluate(node => [node.selectionStart,node.selectionEnd])).toEqual([0,3]);
}
async function record(info, name, observations, root) {
  const directory = info.outputPath('observations');
  await mkdir(directory, {recursive:true});
  const file = `${directory}/${name}.json`;
  await writeFile(file, JSON.stringify(observations,null,2)+'\n', {mode:0o600});
  await info.attach(name, {path:file,contentType:'application/json'});
  await root.screenshot({path:info.outputPath(`${name}.png`),animations:'disabled'});
}

test.beforeEach(async ({baseURL}) => {
  // This file belongs to the normal isolated HTTPS auth fixture, never the guest stack.
  expect(new URL(baseURL).protocol).toBe('https:');
  expect((await fetch(`${AUTH_CONTROL_ORIGIN}/reset-limits`,{method:'POST'})).ok).toBe(true);
});

test('marble forms and glass settings preserve native errors, focus and the 700px modality boundary', async ({page}, info) => {
  await page.setViewportSize({width:701,height:700});
  await page.goto('/'); await waitForAccountStartup(page);
  await openAccount(page);
  const account = dialog(page);
  await expect(account).toHaveAttribute('data-presentation','modal');
  expect(await account.evaluate(node => node.matches(':modal'))).toBe(true);
  await waitForOverlayEntry(account);
  const marble = await account.evaluate(node => {
    const style=getComputedStyle(node);
    return {image:style.backgroundImage,background:style.backgroundColor,filter:style.backdropFilter || style.webkitBackdropFilter || 'none',shadow:style.boxShadow,clip:style.clipPath,radius:style.borderTopLeftRadius};
  });
  // Assert the executed raised-material branch, without pinning a retired exploratory asset or the final paint wash.
  expect(marble.image).toContain('url(');
  expect(marble.background).toMatch(/^rgb\(/);
  expect(marble.filter).toBe('none');
  expect(marble.shadow).not.toBe('none');
  expect(marble.clip).toMatch(/^polygon\(/);expect(marble.radius).toBe('0px');
  await account.getByLabel('Username',{exact:true}).fill(`Local_${Date.now().toString(36)}`);
  await account.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(account.locator('[data-account-status]')).toHaveText('Enter your password.');
  await expect(account.locator('[data-account-status]')).toHaveAttribute('data-state','info');
  await expect(account.getByLabel('Password',{exact:true})).toBeFocused();
  await account.getByRole('button',{name:'Create account',exact:true}).click();
  const username = account.getByLabel('Username',{exact:true});
  const secret = account.getByLabel('Password',{exact:true});
  await username.fill(`Marble_${Date.now().toString(36)}`);
  const originalUsername = await username.inputValue();
  const inset = await secret.locator('..').evaluate(node => getComputedStyle(node).boxShadow);
  expect(inset).toContain('inset');
  await secret.fill('short');
  const submit = account.getByRole('button',{name:'Create account & continue',exact:true});
  await submit.click();
  await expect(secret).toHaveAttribute('aria-invalid','true');
  await expect(secret).toBeFocused();
  await expect(account.locator('[data-account-status]')).toContainText('Choose a password that meets the requirements.');
  await expect(username).toHaveValue(originalUsername);
  await secret.fill(password);
  await expect(secret).not.toHaveAttribute('aria-invalid','true');
  await expect(account.getByTestId('password-requirements').locator('[data-state="met"]')).toHaveCount(3);
  await page.evaluate(()=>document.fonts.ready);
  await account.evaluate(async node=>{await Promise.all(node.getAnimations({subtree:true}).filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const pressSnapshot = node => {const range=document.createRange();range.selectNodeContents(node);return {box:node.getBoundingClientRect().toJSON(),label:range.getBoundingClientRect().toJSON(),shadow:getComputedStyle(node).boxShadow,transform:getComputedStyle(node).transform,fontStatus:document.fonts.status,active:document.activeElement?.getAttribute('type'),dialogScroll:node.closest('dialog')?.scrollTop,ancestors:[node,...(function*(element){for(let parent=element.parentElement;parent;parent=parent.parentElement)yield parent;})(node)].map(element=>({tag:element.tagName,transform:getComputedStyle(element).transform,animations:element.getAnimations().map(animation=>({state:animation.playState,time:animation.currentTime}))}))};};
  const hit = await submit.boundingBox();
  expect(hit.width).toBeGreaterThanOrEqual(44); expect(hit.height).toBeGreaterThanOrEqual(44);
  const before = await submit.evaluate(pressSnapshot);
  await page.mouse.move(hit.x+hit.width/2,hit.y+hit.height/2); await page.mouse.down();
  let reliefFailure;try{await expect.poll(()=>submit.evaluate(node=>getComputedStyle(node).boxShadow)).toMatch(/\) 0px 1px 0px 0px(?:,|$)/);}catch(error){reliefFailure=error;}
  const held = await submit.evaluate(pressSnapshot);
  const pressFile=info.outputPath('native-held-submit.json');await writeFile(pressFile,JSON.stringify({before,held},null,2),{mode:0o600});await info.attach('native-held-submit',{path:pressFile,contentType:'application/json'});
  expect(held.box.x).toBeCloseTo(before.box.x,1); expect(held.box.y).toBeCloseTo(before.box.y,1);
  expect(held.label.x).toBeCloseTo(before.label.x,1); expect(held.label.y).toBeCloseTo(before.label.y,1);
  if(reliefFailure)throw reliefFailure;
  expect(before.shadow).toMatch(/\) 0px 3px 0px 0px(?:,|$)/);
  expect(held.shadow).toContain('0px 1px 2px 0px inset');
  // Release outside: the held-button observation must not create an account.
  await page.mouse.move(1,1); await page.mouse.up();
  await expect(account).toBeVisible();
  await record(info,'marble-local-error-and-submit',{marble,before,held},account);
  await submit.click(); await expect(account).not.toBeVisible();
  await expect(page.getByTestId('account-open')).toHaveAttribute('data-authenticated','true');
  await openAccount(page);
  await expect(account).toHaveAttribute('data-presentation','flyout');
  expect(await account.evaluate(node => node.matches(':modal'))).toBe(false);
  const material = await glassFace(account);
  const field = account.getByLabel('Display name',{exact:true});
  await field.fill('Native glass draft');
  await expect(account.locator('[data-autosave-status]')).toHaveText('Saved');
  await selectFirstThree(field);
  const originalField = await field.elementHandle();
  await page.setViewportSize({width:700,height:500});
  await expect.poll(() => account.evaluate(node => node.matches(':modal'))).toBe(true);
  await expect(account).toHaveAttribute('data-presentation','flyout');
  expect(await originalField.evaluate(node => node.isConnected)).toBe(true);
  await expect(field).toBeFocused();
  expect(await field.evaluate(node => [node.selectionStart,node.selectionEnd])).toEqual([0,3]);
  await account.getByRole('button',{name:'Change password',exact:true}).click();
  await expect(account.getByRole('heading',{name:'Change password',exact:true})).toBeVisible();
  await expect(account.getByLabel('New password',{exact:true})).toHaveAttribute('autocomplete','new-password');
  await glassFace(account);
  await account.getByRole('button',{name:'Back',exact:true}).click();
  await expect(field).toHaveValue('Native glass draft');
  const close = account.getByRole('button',{name:'Close',exact:true});
  await close.scrollIntoViewIfNeeded(); await expect(close).toBeInViewport({ratio:1});
  await record(info,'glass-settings-phone',{material,modal:true,viewport:700},account);
  await close.click(); await expect(account).not.toBeVisible();
  await page.setViewportSize({width:701,height:700});
  await openAccount(page); expect(await account.evaluate(node => node.matches(':modal'))).toBe(false);
  await page.keyboard.press('Escape'); await expect(account).not.toBeVisible();
  await expect(page.getByTestId('account-open')).toBeFocused();
});

test('glass Scenarios and Debug preserve native editing, selection and the 900px flyout boundary', async ({page}, info) => {
  await page.setViewportSize({width:901,height:700});
  await page.goto('/'); await waitForAccountStartup(page);
  await registerFromAccount(page,'Utility');
  await page.getByRole('button',{name:'Play both sides',exact:true}).click();
  await expect(page.getByTestId('game-board')).toBeVisible();
  const scenarios = await openUtility(page,'Scenarios');
  const material = await glassFace(scenarios);
  expect(await scenarios.evaluate(node => getComputedStyle(node).getPropertyValue('--flyout-offset-x').trim())).toBe('100%');
  const select = scenarios.locator('#scenario-select');
  const options = await select.locator('option').evaluateAll(nodes => nodes.map(node=>node.value));
  expect(options.length).toBeGreaterThan(1);
  await expect(select).toHaveValue(options[0]);
  // The owned plain-control diagnostic proves trusted typeahead on this
  // native backend; its popup Arrow/Enter protocols do not commit even outside the app.
  const nativeSelect=await select.elementHandle();
  await nativeSelect.evaluate(node=>{node.__nativeSelectionEvents=[];for(const type of ['keydown','keyup','input','change','focus','blur'])node.addEventListener(type,event=>node.__nativeSelectionEvents.push({type,key:event.key??null,trusted:event.isTrusted,value:node.value}));});
  await select.focus();await select.press('u');
  const selection=await nativeSelect.evaluate(node=>({value:node.value,connected:node.isConnected,events:node.__nativeSelectionEvents}));
  const selectionFile=info.outputPath('native-select-events.json');await writeFile(selectionFile,JSON.stringify(selection,null,2),{mode:0o600});await info.attach('native-select-events',{path:selectionFile,contentType:'application/json'});
  expect(selection.connected).toBe(true);
  expect(selection.events.filter(event=>event.type==='input'||event.type==='change').map(event=>({type:event.type,trusted:event.trusted}))).toEqual([{type:'input',trusted:true},{type:'change',trusted:true}]);
  await expect(select.locator('option:checked')).toHaveText('Uncommanded pieces are inactive');
  await expect(select).toBeFocused();
  const scroll = scenarios.locator('.shell-flyout-scroll');
  await page.setViewportSize({width:900,height:500});
  expect(await scenarios.evaluate(node => getComputedStyle(node).getPropertyValue('--flyout-offset-y').trim())).toBe('100%');
  await expect.poll(() => scenarios.evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(251);
  expect(await scroll.evaluate(node => node.scrollHeight>node.clientHeight)).toBe(true);
  await select.scrollIntoViewIfNeeded();
  const beforeScroll = await scroll.evaluate(node => node.scrollTop);
  const pageScroll = await page.evaluate(() => scrollY);
  await select.hover(); await page.mouse.wheel(0,600);
  await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(beforeScroll);
  expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
  const draft = scenarios.getByLabel('Description',{exact:true});
  await draft.fill('Original utility draft'); await selectFirstThree(draft);
  const original = await draft.elementHandle();
  await page.setViewportSize({width:901,height:700});
  expect(await original.evaluate(node=>node.isConnected)).toBe(true);
  await expect(draft).toHaveValue('Original utility draft'); await expect(draft).toBeFocused();
  expect(await draft.evaluate(node=>[node.selectionStart,node.selectionEnd])).toEqual([0,3]);
  await record(info,'glass-scenario-select-and-draft',{material,options:options.length,phoneScrollOwner:true},scenarios);
  await scenarios.getByRole('button',{name:'Close Scenarios',exact:true}).click();
  await expect(scenarios).toHaveCount(0);
  const debug = await openUtility(page,'Debug');
  await expect(scenarios).toHaveCount(0); await glassFace(debug);
  await debug.locator('[data-debug-section="notes"] > summary').click();
  const note = debug.locator('[data-debug-note="text"]');
  await note.fill('A private native draft'); await selectFirstThree(note);
  const flag = debug.getByLabel('Flag this decision',{exact:true});
  await flag.check(); await expect(flag).toBeChecked();
  expect(await flag.evaluate(node=>getComputedStyle(node).appearance)).toMatch(/^(auto|checkbox)$/);
  const checkedPath=info.outputPath('glass-debug-native-checked.png');await debug.screenshot({path:checkedPath});await info.attach('glass-debug-native-checked',{path:checkedPath,contentType:'image/png'});
  await flag.focus(); await flag.press('Space'); await expect(flag).not.toBeChecked();
  const label = await flag.locator('..').boundingBox();
  expect(label.width).toBeGreaterThanOrEqual(44); expect(label.height).toBeGreaterThanOrEqual(44);
  const debugScroll=debug.locator('.shell-flyout-scroll');expect(await debugScroll.evaluate(node=>({overflow:node.scrollWidth-node.clientWidth,left:node.scrollLeft}))).toEqual({overflow:0,left:0});
  // This is the real forced-colors opaque fallback. It does not claim to emulate an engine lacking backdrop-filter.
  await page.emulateMedia({forcedColors:'active'});
  expect(await page.evaluate(()=>matchMedia('(forced-colors:active)').matches)).toBe(true);
  const opaque = await debug.evaluate(node => {
    const face=getComputedStyle(node,'::before');
    return {background:face.backgroundColor,image:face.backgroundImage,filter:face.backdropFilter || face.webkitBackdropFilter || 'none',foreground:getComputedStyle(node).color};
  });
  expect(opaque.image).toBe('none'); expect(opaque.filter).toBe('none');
  expect(opaque.background).not.toBe('rgba(0, 0, 0, 0)');
  const luminance = color => {
    const channels=color.match(/[\d.]+/g).map(Number);
    expect(channels.length).toBeGreaterThanOrEqual(3);
    if(channels.length===4) expect(channels[3]).toBe(1);
    const linear=channels.slice(0,3).map(value=>{const channel=value/255;return channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4;});
    return linear[0]*0.2126+linear[1]*0.7152+linear[2]*0.0722;
  };
  const levels=[luminance(opaque.background),luminance(opaque.foreground)].sort((a,b)=>a-b);
  const contrast=(levels[1]+0.05)/(levels[0]+0.05);
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await record(info,'glass-debug-forced-colors',{opaque,contrast,checkboxNative:true},debug);
  await page.emulateMedia({forcedColors:'none'});
  await debug.getByRole('button',{name:'Close Debug mode',exact:true}).click();
  await expect(debug).toHaveCount(0);
  const reopened = await openUtility(page,'Debug');
  const notes = reopened.locator('[data-debug-section="notes"]');
  if (!await notes.evaluate(node=>node.open)) await notes.locator(':scope > summary').click();
  await expect(notes.locator('textarea')).toHaveValue('A private native draft');
  await reopened.getByRole('button',{name:'Close Debug mode',exact:true}).click();
  await expect(reopened).toHaveCount(0);
});
