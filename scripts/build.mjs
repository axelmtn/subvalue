import {stripTypeScriptTypes} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {privacyPage} from './privacy-page.mjs';
const output='packages/cli/dist';fs.mkdirSync(path.join(output,'public'),{recursive:true});fs.mkdirSync('apps/web/dist',{recursive:true});
function compile(source,destination){const input=fs.readFileSync(source,'utf8').replace(/^import ['"]\.\/(?:style|landing)\.css['"];?\s*$/gm,'');const js=stripTypeScriptTypes(input,{mode:'strip'}).replace(/(from\s+['"][^'"]+)\.ts(['"])/g,'$1.js$2').replace(/(import\(['"][^'"]+)\.ts(['"]\))/g,'$1.js$2');fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,js);}
function walk(directory){for(const e of fs.readdirSync(directory,{withFileTypes:true})){if(e.name==='dist')continue;const p=path.join(directory,e.name);if(e.isDirectory())walk(p);else if(e.isFile()&&p.endsWith('.ts'))compile(p,path.join(output,p.replace(/\.ts$/,'.js')));}}
walk('packages/core/src');walk('packages/cli/src');walk('packages/receipt/src');walk('packages/ui/src');
for(const file of ['main','landing'])compile(`apps/web/src/${file}.ts`,path.join(output,'public','apps/web/src',`${file}.js`));
compile('packages/receipt/src/index.ts',path.join(output,'public','packages/receipt/src/index.js'));
compile('packages/ui/src/brand.ts',path.join(output,'public','packages/ui/src/brand.js'));
compile('packages/core/src/subscriptions.ts',path.join(output,'public','packages/core/src/subscriptions.js'));
compile('packages/core/src/calendar.ts',path.join(output,'public','packages/core/src/calendar.js'));
fs.writeFileSync(path.join(output,'cli.js'),'#!/usr/bin/env node\nimport "./packages/cli/src/index.js";\n');
function css(file){return fs.readFileSync(file,'utf8').replace(/@import ['"](.+?)['"];?/g,(_,relative)=>css(path.resolve(path.dirname(file),relative)));}
for(const [name,source] of [['app','style'],['landing','landing']]){fs.writeFileSync(path.join(output,'public',`${name}.css`),css(`apps/web/src/${source}.css`));fs.writeFileSync(path.join(output,'public',`${name}.js`),`import './apps/web/src/${name==='app'?'main':'landing'}.js';\n`);}
const {product,productNameMarkup,wordmarkSvg}=await import('../'+output+'/packages/ui/src/brand.js');
for(const [src,name] of [['apps/web/index.html','index.html'],['apps/web/landing.html','landing.html']])fs.writeFileSync(path.join(output,'public',name),fs.readFileSync(src,'utf8').replaceAll('{{productName}}',product.name));
fs.cpSync('apps/web/public',path.join(output,'public'),{recursive:true});
fs.cpSync('apps/web/public','apps/web/dist',{recursive:true});
const wordmark=wordmarkSvg(),monochrome=wordmarkSvg(true);
for(const directory of [path.join(output,'public'),'apps/web/dist']){
  if(wordmark)fs.writeFileSync(path.join(directory,'logo','wordmark.svg'),wordmark.replaceAll('class="brand-name-accent"','fill="#37ec85"').replace('fill="currentColor"','fill="#eef2f4"'));
  if(monochrome)fs.writeFileSync(path.join(directory,'logo','wordmark-monochrome.svg'),monochrome);
}
for(const name of ['landing.js','landing.css','icon.svg'])fs.copyFileSync(path.join(output,'public',name),path.join('apps/web/dist',name));
// Only the landing's modules are shipped to the public site. No dashboard entry
// point, provider scanner, database code or local API is part of this output.
for(const relative of ['apps/web/src/landing.js','packages/receipt/src/index.js','packages/ui/src/brand.js','packages/core/src/calendar.js']){
  const destination=path.join('apps/web/dist',relative);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(output,'public',relative),destination);
}
for(const relative of ['apps/web/src/main.js','packages/core/src/subscriptions.js']){
  const destination=path.resolve('apps/web/dist',relative),base=path.resolve('apps/web/dist');
  if(!destination.startsWith(base+path.sep))throw new Error('Invalid generated output path');
  if(fs.existsSync(destination)&&!fs.lstatSync(destination).isSymbolicLink())fs.unlinkSync(destination);
}
fs.writeFileSync('apps/web/dist/index.html',fs.readFileSync('apps/web/landing.html','utf8').replaceAll('{{productName}}',product.name));
for(const directory of [path.join(output,'public'),'apps/web/dist']){
  fs.copyFileSync('PRIVACY.md',path.join(directory,'privacy.txt'));
  fs.writeFileSync(path.join(directory,'privacy.html'),privacyPage(fs.readFileSync('PRIVACY.md','utf8'),product,productNameMarkup));
  fs.writeFileSync(path.join(directory,'privacy.css'),css('apps/web/src/privacy.css'));
}
for(const name of ['README.md','PRE_RELEASE.md','PRIVACY.md','LICENSE'])if(fs.existsSync(name))fs.copyFileSync(name,path.join('packages/cli',name));
fs.copyFileSync('packages/core/src/pricing/SOURCES.md',path.join(output,'PRICING.md'));
fs.writeFileSync('packages/cli/README.md',fs.readFileSync('README.md','utf8').replace('packages/core/src/pricing/SOURCES.md','dist/PRICING.md'));
fs.chmodSync(path.join(output,'cli.js'),0o755);console.log('Built CLI, local dashboard, and static landing.');
