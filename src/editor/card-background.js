// Card backgrounds and uploads.
export function setupCardBackground({ current, persist, draw, getItems }) {
function syncBgTools(){const c=current(),ok=c?.kind==='card';document.getElementById('cardBgTools').style.display=ok?'inline-flex':'none';if(!ok)return;document.getElementById('bgMode').value=c.bgImage?'image':'color';document.getElementById('bgFit').value=c.bgFit||'cover';for(const [id,k,def] of [['bgOpacity','bgOpacity',100],['bgZoom','bgZoom',100],['bgX','bgX',0],['bgY','bgY',0],['bgShade','bgShade',0]])document.getElementById(id).value=c[k]??def;document.getElementById('bgOpacityValue').textContent=(c.bgOpacity??100)+'%';document.getElementById('bgZoomValue').textContent=(c.bgZoom??100)+'%'}
function updateBg(){const c=current();if(!c||c.kind!=='card')return;c.bgFit=document.getElementById('bgFit').value;for(const k of ['bgOpacity','bgZoom','bgX','bgY','bgShade'])c[k]=Number(document.getElementById(k).value);persist();draw();syncBgTools()}
for(const id of ['bgFit','bgOpacity','bgZoom','bgX','bgY','bgShade'])document.getElementById(id).addEventListener('input',updateBg);
document.getElementById('bgUpload').onchange=e=>{const file=e.target.files[0],c=current();if(!file||!c||c.kind!=='card'||!file.type.startsWith('image/'))return;const id=c.id;const r=new FileReader();r.onload=()=>{const target=getItems().find(x=>x.id===id);if(!target)return;target.bgImage=r.result;target.bgFit=target.bgFit||'cover';persist();draw();syncBgTools()};r.readAsDataURL(file);e.target.value=''};
document.getElementById('bgMode').onchange=e=>{const c=current();if(!c||c.kind!=='card')return;if(e.target.value==='color'){delete c.bgImage;persist();draw();syncBgTools()}else{document.getElementById('bgUpload').click()}};
document.getElementById('bgRemove').onclick=()=>{const c=current();if(!c||c.kind!=='card')return;delete c.bgImage;persist();draw();syncBgTools()};
return { syncBgTools };
}
