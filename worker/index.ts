import { solaxRoute } from './solax.ts';
type Env={SOLAX_API_URL:string;SOLAX_CLIENT_ID:string;SOLAX_CLIENT_SECRET:string;ALLOWED_ORIGIN:string;VIEWER_TOKEN_SHA256:string};
const encode=new TextEncoder();
export async function authorized(value:string|null,hash:string){
  if(!/^[a-f0-9]{64}$/.test(hash||'')||!value?.startsWith('Bearer '))return false;
  const token=value.slice(7);if(token.length<32||token.length>256)return false;
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encode.encode(token))),v=>v.toString(16).padStart(2,'0')).join('');
  let difference=0;for(let i=0;i<64;i++)difference|=digest.charCodeAt(i)^hash.charCodeAt(i);return difference===0;
}
export default {async fetch(request:Request,env:Env){
  const headers=new Headers({'Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'});
  const respond=(data:unknown,status:number)=>Response.json(data,{status,headers});
  if(!env.ALLOWED_ORIGIN||!env.VIEWER_TOKEN_SHA256)return respond({error:'Máy chủ chưa được cấu hình quyền truy cập.'},503);
  const origin=request.headers.get('Origin');
  if(origin&&origin!==env.ALLOWED_ORIGIN)return respond({error:'Nguồn truy cập không được phép.'},403);
  if(origin){headers.set('Access-Control-Allow-Origin',origin);headers.set('Access-Control-Allow-Methods','GET, OPTIONS');headers.set('Access-Control-Allow-Headers','Authorization');}
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='GET')return respond({error:'Chỉ hỗ trợ đọc dữ liệu.'},405);
  if(!await authorized(request.headers.get('Authorization'),env.VIEWER_TOKEN_SHA256))return respond({error:'Mã truy cập không đúng hoặc đã được thay đổi.'},401);
  const url=new URL(request.url);
  if(!['/api/overview','/api/history'].includes(url.pathname))return respond({error:'Không tìm thấy API.'},404);
  const response=await solaxRoute(request,env);
  for(const [key,value] of response.headers)if(!headers.has(key))headers.set(key,value);
  return new Response(response.body,{status:response.status,headers});
}};
