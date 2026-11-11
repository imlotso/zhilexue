/* Native PDF image bounds only: never infer question ownership or confirm figures. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PdfNativeCandidates=api;})(typeof window==='object'?window:globalThis,function(){
'use strict';
function sanitize(value){
 if(!Array.isArray(value))return [];
 const out=[],seen=new Set();
 for(const p of value.slice(0,200)){
  if(!p||!['x','y','w','h'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])))continue;
  const {x,y,w,h}=p;if(x<0||y<0||x>=1||y>=1||w<=0||h<=0||x+w>1.000001||y+h>1.000001||w*h>.65)continue;
  const clean={x,y,w:Math.min(w,1-x),h:Math.min(h,1-y)},key=JSON.stringify(clean);
  if(clean.w<=0||clean.h<=0)continue;
  if(!seen.has(key)){seen.add(key);out.push(clean);}
 }
 return out;
}
const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
function extract(list,viewport,OPS){
 if(!list||!Array.isArray(list.fnArray)||!Array.isArray(list.argsArray)||!viewport||!(viewport.width>0&&viewport.height>0))return [];
 let matrix=Array.from(viewport.transform||[]),stack=[],groups=0;const out=[],min=4*(Number(viewport.scale)||1);
 if(matrix.length!==6||!matrix.every(Number.isFinite))return [];
 const save=()=>stack.push(matrix.slice());const restore=()=>{matrix=stack.pop()||Array.from(viewport.transform);};
 for(let i=0;i<list.fnArray.length&&out.length<200;i++){
  const op=list.fnArray[i],a=list.argsArray[i]||[];
  if(op===OPS.beginGroup){groups++;continue;}if(op===OPS.endGroup){groups=Math.max(0,groups-1);continue;}if(groups)continue;
  if(op===OPS.save){save();continue;}if(op===OPS.restore){restore();continue;}
  if(op===OPS.paintFormXObjectBegin){save();if(a[0]){if(a[0].length!==6||!Array.from(a[0]).every(Number.isFinite))return [];matrix=multiply(matrix,a[0]);}continue;}
  if(op===OPS.paintFormXObjectEnd){restore();continue;}
  if(op===OPS.transform){if(a.length!==6||!Array.from(a).every(Number.isFinite))return [];matrix=multiply(matrix,a);continue;}
  if(op!==OPS.paintImageXObject&&op!==OPS.paintInlineImageXObject)continue;
  // Unknown repeat/group/mask operations are intentionally not guessed.
  const pts=[[0,0],[1,0],[0,1],[1,1]].map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]]);
  const x=Math.max(0,Math.min(...pts.map(p=>p[0]))),y=Math.max(0,Math.min(...pts.map(p=>p[1])));
  const right=Math.min(viewport.width,Math.max(...pts.map(p=>p[0]))),bottom=Math.min(viewport.height,Math.max(...pts.map(p=>p[1])));
  if(right-x<min||bottom-y<min)continue;
  out.push({x:x/viewport.width,y:y/viewport.height,w:(right-x)/viewport.width,h:(bottom-y)/viewport.height});
 }
 return sanitize(out);
}
return {extract,sanitize};
});
