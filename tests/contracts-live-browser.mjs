// Staff browser QA against the guarded local e2e API. Nothing is sent to real people.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';
import {E2E_ADMIN,freshAdminCode} from './support/e2e-admin.mjs';
const base=process.env.E2E_PORTAL??'http://localhost:4173',api=process.env.E2E_API??'http://localhost:3000';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});const errors=[];let checks=0;mkdirSync('test-results/contracts',{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route(`${base}/public-config.json`,route=>route.fulfill({contentType:'application/json',body:JSON.stringify({mode:'live',apiBaseUrl:`${api}/api/v1`,clientPortalUrl:'http://localhost:3001/es/portal/',whatsappMode:'manual'})}));
 await page.goto(base);await page.fill('#auth-email',E2E_ADMIN.email);await page.fill('#auth-password',E2E_ADMIN.password);await page.click('button[type="submit"]');await page.waitForSelector('#auth-code');await page.fill('#auth-code',await freshAdminCode(api));await page.click('button[type="submit"]');await page.waitForSelector('.pt-mode[data-mode="live"]');checks++;
 await page.goto(`${base}/#contratos`);await page.getByRole('heading',{name:'Contratación',exact:true}).waitFor();await page.getByText('Producción contractual bloqueada',{exact:false}).waitFor();checks++;
 await page.getByRole('button',{name:'Preparar borrador ficticio',exact:true}).waitFor();await page.getByRole('button',{name:'Preparar borrador ficticio',exact:true}).click();assert.equal(await page.locator('#interaction-modal input[type="checkbox"]:checked').count(),0);checks++;
 await page.locator('[name="clientId"]').waitFor();assert.equal(await page.locator('[name="maintenance"] option').count(),3);checks++;
 await page.keyboard.press('Escape');
 await page.screenshot({path:'test-results/contracts/staff-1440.png',fullPage:true});
 const list=page.locator('a[href^="#contratos/"]');if(await list.count()){await list.first().click();await page.getByRole('button',{name:'Previsualizar documento completo',exact:true}).first().click();await page.locator('dialog pre').waitFor();assert.ok((await page.locator('dialog pre').textContent()).includes('No aprobado para contratación'));await page.locator('dialog button').click();checks++;}
 await page.setViewportSize({width:360,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks++;await page.screenshot({path:'test-results/contracts/staff-360.png',fullPage:true});
 assert.deepEqual(errors,[]);checks++;console.log(`PASS ${checks} staff browser checks: real admin MFA/session, contract module, production gates, empty consent, catalog-backed monthly options, preview, mobile overflow and no runtime errors.`);await context.close();
}finally{await browser.close();}
