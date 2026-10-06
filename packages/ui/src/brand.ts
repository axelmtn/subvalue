/** Display identity only. Package names and local data paths are intentionally independent. */
export const product = {name:'SubValue',site:'subvalue.dev',exportBasename:'subvalue-receipt'};
// Typography remains separate from the neutral symbol and follows the display name.
const nameParts = product.name.split(/(?=[A-Z])/);
const escapeName = (value:string) => value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
export const productNameMarkup = `<span class="brand-name">${nameParts.map((part,index) => index===nameParts.length-1 ? `<span class="brand-name-accent">${escapeName(part)}</span>` : escapeName(part)).join('')}</span>`;
// Opposed measurement corners. No letter, currency sign or provider-derived geometry.
export const markPath = 'M4 18V4h14v4H8v10H4Zm10 6h10V14h4v14H14v-4Z';
export const productMark = `<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="${markPath}"/></svg>`;
