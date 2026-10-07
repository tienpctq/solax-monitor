type Env = {SOLAX_API_URL?: string; SOLAX_CLIENT_ID?: string; SOLAX_CLIENT_SECRET?: string};
type Row = Record<string, any>;
let token = ''; let tokenUntil = 0; let tokenFlight: Promise<string> | null = null;
const cache = new Map<string, {until:number; value:any}>();
const flights = new Map<string,Promise<any>>();
// SolaX IDs may exceed Number.MAX_SAFE_INTEGER. Preserve integer identifiers exactly.
function decode(text:string) { return JSON.parse(text.replace(/(:\s*|\[\s*|,\s*)(-?\d{16,})(?=\s*[,}\]])/g,'$1"$2"')); }
async function memo(key:string, seconds:number, fn:()=>Promise<any>) {
  const hit=cache.get(key); if(hit && hit.until>Date.now())return hit.value;
  if(flights.has(key))return flights.get(key);
  const work=fn().then(value=>{if(cache.size>150)cache.delete(cache.keys().next().value!);cache.set(key,{until:Date.now()+seconds*1000,value});return value}).finally(()=>flights.delete(key));
  flights.set(key,work);return work;
}
function base(env:Env){if(env.SOLAX_API_URL!=='https://openapi-eu.solaxcloud.com')throw new Error('Địa chỉ API chưa được cấu hình đúng.');return env.SOLAX_API_URL}
async function access(env:Env):Promise<string>{
  if(token && Date.now()<tokenUntil)return token;
  if(tokenFlight)return tokenFlight;
  tokenFlight=(async()=>{
    if(!env.SOLAX_CLIENT_ID||!env.SOLAX_CLIENT_SECRET)throw new Error('Chưa cấu hình khóa SolaX phía máy chủ.');
    const r=await fetch(base(env)+'/openapi/auth/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.SOLAX_CLIENT_ID,client_secret:env.SOLAX_CLIENT_SECRET,grant_type:'client_credentials'}),signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw new Error('Xác thực SolaX không thành công (HTTP '+r.status+').');
    const j=decode(await r.text());if(j.code!==0||!j.result?.access_token)throw new Error('SolaX từ chối xác thực (mã '+j.code+').');
    token=j.result.access_token;tokenUntil=Date.now()+Math.max(60,Number(j.result.expires_in||3600)-120)*1000;return token;
  })().finally(()=>{tokenFlight=null});return tokenFlight;
}
async function api(env:Env,path:string,params:Row,retry=true):Promise<any>{
  const r=await fetch(base(env)+path+'?'+new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)])),{headers:{Authorization:'bearer '+await access(env)},signal:AbortSignal.timeout(25000)});
  if(r.status===401&&retry){token='';return api(env,path,params,false)}
  if(!r.ok)throw new Error('SolaX tạm không trả dữ liệu (HTTP '+r.status+').');
  const j=decode(await r.text());if(j.code===10402&&retry){token='';return api(env,path,params,false)}
  if(j.code!==10000)throw new Error(j.code===10406?'Đã đạt giới hạn gọi SolaX. Vui lòng chờ một phút.':'SolaX trả lỗi '+j.code+'.');return j.result;
}
async function pages(env:Env,path:string,params:Row){let rows:Row[]=[];for(let pageNo=1;pageNo<=100;pageNo++){const r=await api(env,path,{...params,pageNo});rows.push(...(r?.records||[]));if(pageNo>=Number(r?.pages||1))return rows}throw new Error('Danh sách thiết bị vượt giới hạn hiển thị.');}
async function inventory(env:Env){return memo('inventory',300,async()=>{const plants:Row[]=[];for(const businessType of [1,4]){for(const p of await pages(env,'/openapi/v2/plant/page_plant_info',{businessType}))plants.push({...p,plantId:String(p.plantId),businessType})}return plants})}
async function selected(env:Env,id:string|null){const plants=await inventory(env);const plant=id?plants.find((p:Row)=>p.plantId===id):plants[0];if(!plant)throw new Error(id?'Không có quyền xem nhà máy này.':'Tài khoản chưa có nhà máy được cấp quyền.');return{plants,plant}}
async function devices(env:Env,p:Row){return memo('devices:'+p.plantId,300,()=>pages(env,'/openapi/v2/device/page_device_info',{plantId:p.plantId,businessType:p.businessType,deviceType:1}))}
async function batch(env:Env,path:string,sns:string[],params:Row){let all:Row[]=[];for(let i=0;i<sns.length;i+=10){const r=await api(env,path,{...params,snList:sns.slice(i,i+10).join(',')});all.push(...(Array.isArray(r)?r:[]))}return all}
export function number(v:any):number|null{return v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v)}
function sum(values:any[]){const a=values.map(number).filter((v):v is number=>v!==null);return a.length?a.reduce((x,y)=>x+y,0):null}
export function powers(d:Row,b:number){const scale=b===1?1000:1;let pv=number(d.MPPTTotalInputPower);if(pv===null)pv=sum(Object.entries(d.mpptMap||{}).filter(([k])=>/^mppt\d+power$/i.test(k)).map(([,v])=>v));let ac=number(d.totalActivePower);if(ac===null)ac=sum([d.acPower1,d.acPower2,d.acPower3]);return{pv:pv===null?null:pv/scale,ac:ac===null?null:ac/scale}}
function fullSum(values:any[]){return values.length&&values.every(v=>number(v)!==null)?sum(values):null}
function json(value:any,status=200){return Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}
export async function solaxRoute(request:Request,env:Env){
  if(request.method!=='GET')return json({error:'Chỉ hỗ trợ đọc dữ liệu.'},405);
  const u=new URL(request.url);if(!['/api/overview','/api/history'].includes(u.pathname))return json({error:'Không tìm thấy API.'},404);
  try{
    const {plants,plant}=await selected(env,u.searchParams.get('plantId'));const ds=await devices(env,plant);const sns=ds.map((d:Row)=>d.deviceSn).filter(Boolean);
    if(u.pathname==='/api/overview')return json(await memo('live:'+plant.plantId,60,async()=>{
      const warnings:string[]=[];const optional=async(fn:()=>Promise<any>,label:string,fallback:any)=>{try{return await fn()}catch(e){warnings.push(label+': '+(e as Error).message);return fallback}};
      const summary=await optional(()=>api(env,'/openapi/v2/plant/realtime_data',{plantId:plant.plantId,businessType:plant.businessType}),'Tổng quan nhà máy',null);
      const live=sns.length?await batch(env,'/openapi/v2/device/realtime_data',sns,{businessType:plant.businessType,deviceType:1}):[];
      const battery=sns.length?await optional(()=>batch(env,'/openapi/v2/device/realtime_data',sns,{businessType:plant.businessType,deviceType:2,requestSnType:1}),'Pin',[]):[];
      const realBatteries=battery.filter((d:Row)=>d.deviceSn || Number(d.batteryVoltage)>0 || Number(d.batteryRemainings)>0);
      const readings=ds.map((d:Row)=>{const r=live.find((v:Row)=>v.deviceSn===d.deviceSn);return{...d,reading:r||null,power:r?powers(r,plant.businessType):{pv:null,ac:null}}});
      const times=live.map((d:Row)=>d.dataTime).filter(Boolean).sort();
      return{plants:plants.map((p:Row)=>({plantId:p.plantId,plantName:p.plantName})),plant:{plantId:plant.plantId,plantName:plant.plantName,pvCapacity:plant.pvCapacity,businessType:plant.businessType,plantTimeZone:plant.plantTimeZone},summary,devices:readings,batteries:realBatteries,pvPower:fullSum(readings.map((d:Row)=>d.power.pv)),acPower:fullSum(readings.map((d:Row)=>d.power.ac)),dataTime:times[0]||null,fetchedAt:new Date().toISOString(),warnings};
    }));
    const date=u.searchParams.get('date');if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({error:'Ngày không hợp lệ.'},400);
    // Plant reports a UTC offset in its timezone string. Refuse unknown zones instead of shifting dates silently.
    const offset=String(plant.plantTimeZone).match(/UTC([+-]\d{2}:\d{2})/);if(!offset)throw new Error('Chưa xác định được múi giờ nhà máy.');
    const start=Date.parse(date+'T00:00:00'+offset[1]);if(!Number.isFinite(start)||start>Date.now()||start<Date.now()-366*86400000)return json({error:'Chọn ngày trong một năm gần nhất, không ở tương lai.'},400);
    return json(await memo('history:'+plant.plantId+':'+date,120,async()=>{
      let records:Row[]=[];const end=Math.min(start+86400000-1,Date.now());
      for(let from=start;from<end;from+=43200000){records.push(...await batch(env,'/openapi/v2/device/history_data',sns,{businessType:plant.businessType,deviceType:1,startTime:from,endTime:Math.min(from+43200000-1,end),timeInterval:5}))}
      const buckets=new Map<number,Map<string,Row>>();for(const r of records){const t=Date.parse(r.dataTime||'');if(!Number.isFinite(t)||t<start||t>end)continue;const slot=Math.floor((t-start)/300000);if(!buckets.has(slot))buckets.set(slot,new Map());buckets.get(slot)!.set(r.deviceSn,r)}
      const points=[...buckets.entries()].sort(([a],[b])=>a-b).map(([slot,m])=>{const a=[...m.values()].map(r=>powers(r,plant.businessType));return{time:new Date(start+slot*300000).toISOString(),minute:slot*5,pv:m.size===sns.length?fullSum(a.map(p=>p.pv)):null,ac:m.size===sns.length?fullSum(a.map(p=>p.ac)):null,devices:m.size}});
      return{date,points,deviceCount:sns.length,intervalMinutes:5,timezone:plant.plantTimeZone};
    }));
  }catch(e){return json({error:(e as Error).name==='TimeoutError'?'SolaX phản hồi quá chậm. Vui lòng thử lại.':(e as Error).message||'Không lấy được dữ liệu.'},502)}
}
