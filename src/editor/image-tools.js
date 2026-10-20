// Image appearance controls.
export function setupImageTools({ current, persist }) {
function syncImageTools(){const c=current(),isImage=c?.kind==='image';document.getElementById('imageTools').style.display=isImage?'inline-flex':'none';if(!isImage)return;for(const k of ['opacity','brightness','contrast','rotation'])document.getElementById(k).value=c[k]??(k==='rotation'?0:100);document.getElementById('opacityValue').textContent=(c.opacity??100)+'%';document.getElementById('fit').value=c.fit||'contain'}
function updateImage(){const c=current();if(!c||c.kind!=='image')return;for(const k of ['opacity','brightness','contrast','rotation'])c[k]=Number(document.getElementById(k).value);c.fit=document.getElementById('fit').value;const e=document.querySelector('.el.selected');if(e){e.style.opacity=c.opacity/100;const im=e.querySelector('img');if(im){im.style.filter=`brightness(${c.brightness}%) contrast(${c.contrast}%)`;im.style.transform=`rotate(${c.rotation}deg)`;im.style.objectFit=c.fit}}document.getElementById('opacityValue').textContent=c.opacity+'%';persist()}
for(const k of ['opacity','brightness','contrast','rotation','fit'])document.getElementById(k).addEventListener('input',updateImage);
document.getElementById('resetImage').onclick=()=>{const c=current();if(!c||c.kind!=='image')return;Object.assign(c,{opacity:100,brightness:100,contrast:100,rotation:0,fit:'contain'});syncImageTools();updateImage()};
return { syncImageTools };
}
