// Card backgrounds and uploads.
import { target } from './dom.js';
import { readCompressed } from './images.js';
/** @param {import('../types/layout').Deps} deps */
export function setupCardBackground({ current, store }) {
function syncBgTools(){const c=current(),ok=c?.kind==='card';document.getElementById('cardBgTools').style.display=ok?'inline-flex':'none';if(!ok)return;document.getElementById('bgMode').value=c.bgImage?'image':'color';document.getElementById('bgFit').value=c.bgFit||'cover';for(const [k,def] of Object.entries({bgOpacity:100,bgZoom:100,bgX:0,bgY:0,bgShade:0}))document.getElementById(k).value=String(c[k]??def);document.getElementById('bgOpacityValue').textContent=(c.bgOpacity??100)+'%';document.getElementById('bgZoomValue').textContent=(c.bgZoom??100)+'%'}
function updateBg(){const c=current();if(!c||c.kind!=='card')return;store.change(()=>{c.bgFit=document.getElementById('bgFit').value;for(const k of ['bgOpacity','bgZoom','bgX','bgY','bgShade'])c[k]=Number(document.getElementById(k).value)},{group:'cardBg:'+c.id+':'+document.activeElement?.id,windowMs:1200});syncBgTools()}
for(const id of ['bgFit','bgOpacity','bgZoom','bgX','bgY','bgShade'])document.getElementById(id).addEventListener('input',updateBg);
document.getElementById('bgUpload').onchange=async e=>{const input=target(e),file=input.files[0],c=current();input.value='';if(!file||!c||c.kind!=='card'||!file.type.startsWith('image/'))return;const id=c.id;let src;try{src=await readCompressed(file)}catch(err){alert('Картинку не удалось загрузить: '+err.message);return}const card=store.find(id);if(!card)return;store.change(()=>{card.bgImage=src;card.bgFit=card.bgFit||'cover'});syncBgTools()};
document.getElementById('bgMode').onchange=e=>{const c=current();if(!c||c.kind!=='card')return;if(target(e).value==='color'){store.change(()=>{delete c.bgImage});syncBgTools()}else{document.getElementById('bgUpload').click()}};
document.getElementById('bgRemove').onclick=()=>{const c=current();if(!c||c.kind!=='card')return;store.change(()=>{delete c.bgImage});syncBgTools()};
return { syncBgTools };
}
