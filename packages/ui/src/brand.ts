/** Display identity only. Package names and local data paths are intentionally independent. */
export const product = {name:'SubValue',site:'subvalue.dev',exportBasename:'subvalue-receipt'};
// Typography remains separate from the neutral symbol and follows the display name.
const nameParts = product.name.split(/(?=[A-Z])/);
const escapeName = (value:string) => value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
// Original 5×7 terminal lettering, kept separate from the name-independent symbol.
const glyphs:Record<string,string[]> = {
  S:['01111','10000','10000','01110','00001','00001','11110'],
  U:['10001','10001','10001','10001','10001','10001','01110'],
  B:['11110','10001','10001','11110','10001','10001','11110'],
  V:['10001','10001','10001','10001','10001','01010','00100'],
  A:['01110','10001','10001','11111','10001','10001','10001'],
  L:['1000','1000','1000','1000','1000','1000','1111'],
  E:['11111','10000','10000','11110','10000','10000','11111']
};
export function wordmarkSvg(monochrome=false,withCursor=false):string|null{
  const letters=[...product.name.toUpperCase()];
  if(!letters.length||letters.some(letter=>!glyphs[letter]))return null;
  const accentStart=nameParts.slice(0,-1).join('').length;
  let offset=0;
  const paths=letters.map((letter,index)=>{
    const rows=glyphs[letter],start=offset;offset+=rows[0].length+1;
    return `<g${!monochrome&&index>=accentStart?' class="brand-name-accent"':''}>${rows.map((row,y)=>[...row].map((pixel,x)=>pixel==='1'?`<rect x="${start+x}" y="${y}" width="1" height="1"/>`:'').join('')).join('')}</g>`;
  }).join('');
  const cursor=withCursor?`<rect class="brand-cursor${monochrome?'':' brand-name-accent'}" x="${offset}" y="6" width="5" height="1"/>`:'';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="brand-wordmark" viewBox="0 0 ${withCursor?offset+5:offset-1} 7" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${paths}${cursor}</svg>`;
}
// A future rename automatically uses readable text if new glyphs are needed.
function nameMarkup(withCursor=false){
  const wordmark=wordmarkSvg(false,withCursor);
  return wordmark
  ? `<span class="brand-name"><span class="brand-name-label">${escapeName(product.name)}</span>${wordmark}</span>`
  : `<span class="brand-name">${nameParts.map((part,index) => index===nameParts.length-1 ? `<span class="brand-name-accent">${escapeName(part)}</span>` : escapeName(part)).join('')}</span>`;
}
export const productNameMarkup=nameMarkup();
export const productTitleMarkup=nameMarkup(true);
// Opposed measurement corners. No letter, currency sign or provider-derived geometry.
export const markPath = 'M4 18V4h14v4H8v10H4Zm10 6h10V14h4v14H14v-4Z';
export const productMark = `<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="${markPath}"/></svg>`;
