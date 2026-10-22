// Card backgrounds and uploads.
export function setupCardBackground({ current, store }) {
function syncBgTools(){const c=current(),ok=c?.kind==='card';document.getElementById('cardBgTools').style.display=ok?'inline-flex':'none';if(!ok)return;document.getElementById('bgMode').value=c.bgImage?'image':'color';document.getElementById('bgFit').value=c.bgFit||'cover';for(const [id,k,def] of [['bgOpacity','bgOpacity',100],['bgZoom','bgZoom',100],['bgX','bgX',0],['bgY','bgY',0],['bgShade','bgShade',0]])document.getElementById(id).value=c[k]??def;document.getElementById('bgOpacityValue').textContent=(c.bgOpacity??100)+'%';document.getElementById('bgZoomValue').textContent=(c.bgZoom??100)+'%'}
function updateBg(){const c=current();if(!c||c.kind!=='card')return;store.change(()=>{c.bgFit=document.getElementById('bgFit').value;for(const k of ['bgOpacity','bgZoom','bgX','bgY','bgShade'])c[k]=Number(document.getElementById(k).value)},{group:'cardBg:'+c.id+':'+document.activeElement?.id,windowMs:1200});syncBgTools()}
for(const id of ['bgFit','bgOpacity','bgZoom','bgX','bgY','bgShade'])document.getElementById(id).addEventListener('input',updateBg);
document.getElementById('bgUpload').onchange=e=>{const file=e.target.files[0],c=current();if(!file||!c||c.kind!=='card'||!file.type.startsWith('image/'))return;const id=c.id;const r=new FileReader();r.onload=()=>{const target=store.find(id);if(!target)return;store.change(()=>{target.bgImage=r.result;target.bgFit=target.bgFit||'cover'});syncBgTools()};r.readAsDataURL(file);e.target.value=''};
document.getElementById('bgMode').onchange=e=>{const c=current();if(!c||c.kind!=='card')return;if(e.target.value==='color'){store.change(()=>{delete c.bgImage});syncBgTools()}else{document.getElementById('bgUpload').click()}};
document.getElementById('bgRemove').onclick=()=>{const c=current();if(!c||c.kind!=='card')return;store.change(()=>{delete c.bgImage});syncBgTools()};
return { syncBgTools };
}
