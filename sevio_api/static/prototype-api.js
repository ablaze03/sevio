"use strict";

let DATA;
const PROTOTYPE_DATA_URL = "/static/prototype-core-data.json?v=20260711-core1";

async function loadPrototypeData() {
  const response = await fetch(PROTOTYPE_DATA_URL);
  if (!response.ok) throw new Error("prototype data failed: " + response.status);
  return response.json();
}

async function bootPrototype() {
  DATA = await loadPrototypeData();

  /* ---------- utils ---------- */
  const Q = ["3 кв. 2025","4 кв. 2025","1 кв. 2026"];
  const FQ = ["2 кв. 2026","3 кв. 2026"]; // прогнозные кварталы
  const TYPE_NAMES = {1:"Участки",2:"Дома",3:"Квартиры",4:"Коммерция",5:"Машино-места",6:"Кладовки"};
  const UNIT = {1:"₽/сот.",2:"₽/м²",3:"₽/м²",4:"₽/м²",5:"₽/м²",6:"₽/м²"};
  const AREA_UNIT = {1:"сот.",2:"м²",3:"м²",4:"м²",5:"м²",6:"м²"};
  const DEFAULT_AREAS = {1:"10",2:"120",3:"54",4:"80",5:"14",6:"4"};
  const fmt = n => {
    const value = Number(n);
    return Number.isFinite(value) ? Math.round(value).toLocaleString("ru-RU") : "—";
  };
  const fmtMoney = n => {
    if(n==null) return "—";
    if(n>=1e6) return (n/1e6).toLocaleString("ru-RU",{maximumFractionDigits:1})+" млн ₽";
    return fmt(Math.round(n))+" ₽";
  };
  const fmtShort = n => {
    if(n==null) return "—";
    if(n>=1e6) return (n/1e6).toLocaleString("ru-RU",{maximumFractionDigits:1})+" млн";
    if(n>=1e3) return Math.round(n/1e3).toLocaleString("ru-RU")+" тыс";
    return fmt(Math.round(n));
  };
  const pct = x => (x>0?"+":"")+ (x*100).toLocaleString("ru-RU",{maximumFractionDigits:1})+"%";
  const LOCATION_PHRASES = ["городской округ","муниципальный округ","муниципальный район","административный округ","городское поселение","сельское поселение","рабочий поселок","рабочий посёлок","пр т","б р","р н","г о","м о"];
  const LOCATION_WORDS = ["район","округ","город","улица","ул","проспект","пр","переулок","пер","шоссе","бульвар","б-р","площадь","пл","проезд","набережная","наб","аллея","тупик","линия","микрорайон","мкр","территория","тер","поселок","посёлок","пос","деревня","д","село","с","рп","пгт","снт","днп","кп","г","го"];
  const rxEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  function rawKey(v){
    return String(v||"").toLowerCase().replace(/ё/g,"е").replace(/["'`«»„“”]/g,"").replace(/[^0-9a-zа-я]+/g," ").replace(/\s+/g," ").trim();
  }
  function searchKey(v){
    const raw=rawKey(v);
    if(!raw) return "";
    let key=raw;
    for(const p of LOCATION_PHRASES){
      const pk=rawKey(p);
      while((" "+key+" ").includes(" "+pk+" ")) key=(" "+key+" ").replace(" "+pk+" "," ").trim();
    }
    const drop=new Set(LOCATION_WORDS.map(rawKey));
    key=key.split(" ").filter(part=>!drop.has(part)).join(" ");
    key=key.replace(/\s+/g," ").trim();
    return key||raw;
  }
  function editDistanceWithinOne(a,b){
    if(a===b) return true;
    if(Math.abs(a.length-b.length)>1) return false;
    let i=0,j=0,edits=0;
    while(i<a.length&&j<b.length){
      if(a[i]===b[j]){ i++; j++; continue; }
      if(++edits>1) return false;
      if(a.length>b.length) i++;
      else if(b.length>a.length) j++;
      else { i++; j++; }
    }
    return edits + (i<a.length||j<b.length ? 1 : 0) <= 1;
  }
  function searchMatch(key,q){
    if(!q) return true;
    if(key.includes(q)) return true;
    if(q.length<5) return false;
    const keyTokens=key.split(" ");
    return q.split(" ").every(qt=>keyTokens.some(kt=>kt.includes(qt)||editDistanceWithinOne(qt,kt)));
  }
  function matchQuality(key,q){
    if(!q) return 1;
    if(key.includes(q)) return 100 + q.length;
    if(q.length<5) return -1;
    const keyTokens=key.split(" ");
    let total=0;
    for(const qt of q.split(" ")){
      let best=-1;
      for(const kt of keyTokens){
        if(kt===qt) best=Math.max(best,40);
        else if(kt.startsWith(qt)) best=Math.max(best,30);
        else if(kt.includes(qt)) best=Math.max(best,20);
        else if(editDistanceWithinOne(qt,kt)) best=Math.max(best,8);
      }
      if(best<0) return -1;
      total+=best;
    }
    return total;
  }
  function tokenQuality(token,key){
    if(!token || !key) return -1;
    if(key===token) return 60;
    if(key.split(" ").some(kt=>kt===token)) return 50;
    if(key.split(" ").some(kt=>kt.startsWith(token))) return 35;
    if(key.includes(token)) return 24;
    if(token.length>=5 && key.split(" ").some(kt=>editDistanceWithinOne(token,kt))) return 10;
    return -1;
  }
  function locationScore(item,q){
    const tokens=q.split(" ").filter(Boolean);
    if(!tokens.length) return 0;
    const labelKey=item.labelKey||searchKey(item.label);
    const contextKey=item.contextKey||"";
    let labelHits=0, contextHits=0, quality=0;
    for(const token of tokens){
      const lq=tokenQuality(token,labelKey);
      const cq=tokenQuality(token,contextKey);
      if(lq<0 && cq<0) return -1;
      if(lq>=cq){
        labelHits++;
        quality+=lq;
      } else {
        contextHits++;
        quality+=cq;
      }
    }
    if(!labelHits && item.kind!=="region") return -1;
    const exactLabel = labelKey===q ? 500 : 0;
    return exactLabel + labelHits*120 + contextHits*12 + quality;
  }
  const locationKey = (...parts) => searchKey(parts.filter(Boolean).join(" "));
  const kindRank = {street:4, settlement:3, area:2, region:1};
  const kindLabel = {street:"улица", settlement:"нас. пункт", area:"район/округ", region:"регион"};
  const hasStreetIntent = raw => /\b(ул\.?|улица|проспект|пр-?т|переулок|пер\.?|шоссе|бульвар|проезд|набережная|наб\.?)\b/i.test(raw);
  const STREET_DISPLAY_ALIASES = {
    "москва|варшавское": "Варшавское шоссе",
    "москва|дмитровское": "Дмитровское шоссе",
    "москва|каширское": "Каширское шоссе",
    "москва|ленинградское": "Ленинградское шоссе",
    "москва|можайское": "Можайское шоссе",
    "москва|рублевское": "Рублёвское шоссе",
    "москва|щелковское": "Щёлковское шоссе",
    "москва|энтузиастов": "шоссе Энтузиастов"
  };
  function streetTypeFromRaw(raw){
    const key=rawKey(raw);
    if(!key) return "";
    if(key.split(" ").includes("шоссе")) return "шоссе";
    if(key.split(" ").includes("проспект") || key.split(" ").includes("пр") || key.includes("пр т")) return "проспект";
    if(key.split(" ").includes("переулок") || key.split(" ").includes("пер")) return "переулок";
    if(key.split(" ").includes("бульвар") || key.includes("б р")) return "бульвар";
    if(key.split(" ").includes("проезд")) return "проезд";
    if(key.split(" ").includes("набережная") || key.split(" ").includes("наб")) return "набережная";
    if(key.split(" ").includes("улица") || key.split(" ").includes("ул")) return "улица";
    return "";
  }
  function displayStreetName(name, region, raw=""){
    const key=searchKey(name);
    const regionKey=searchKey(region);
    const alias=STREET_DISPLAY_ALIASES[regionKey+"|"+key] || STREET_DISPLAY_ALIASES[key];
    if(alias) return alias;
    const type=streetTypeFromRaw(raw);
    if(!type) return name;
    if(type==="улица") return name;
    return key.split(" ").includes(searchKey(type)) ? name : name+" "+type;
  }
  function mergeStreetSuggestions(items, ft){
    const out=[], byKey=new Map();
    for(const item of items){
      if(item.kind!=="street"){
        out.push(item);
        continue;
      }
      const key=[item.rc,item.region,item.labelKey||searchKey(item.label)].join("|");
      const n=scoreOf(item,ft);
      let merged=byKey.get(key);
      if(!merged){
        merged={...item, nt:{...item.nt}, aliases:[item], mergedStreet:true, districts:[item.loc].filter(Boolean), best:item};
        byKey.set(key,merged);
        out.push(merged);
      } else {
        merged.aliases.push(item);
        merged.nt[ft]=(merged.nt[ft]||0)+n;
        if(item.loc && !merged.districts.includes(item.loc)) merged.districts.push(item.loc);
        if(n>scoreOf(merged.best,ft)) {
          merged.best=item;
          merged.loc=item.loc;
          merged.lcName=item.lcName;
          merged.street=item.street;
        }
      }
    }
    for(const item of out){
      if(item.mergedStreet && item.districts.length>1){
        item.pathOverride = item.region + " · " + item.districts.slice(0,2).join(", ") + (item.districts.length>2 ? " +" + (item.districts.length-2) : "");
      }
    }
    return out;
  }
  function scoreOf(i,ft){
    return (i.nt&&i.nt[ft])||0;
  }

  /* ---------- state ---------- */
  /* старт: Россия + 2-комн. — экран никогда не пустой, ответ виден сразу */
  function makeDefaultState(){
    return { rc:null, loc:null, lc:null, t:"3", street:null, metric:"med", mode:"buy", seg:0, market:"", ct:0, horizon:5, sortBy:"u", sortDir:-1, showAll:false,
      inputs:{area:DEFAULT_AREAS["3"], price:"", invest:"", ay:"0", af:"0", am:"0"} };
  }
  let state = makeDefaultState();
  const STATE_STORAGE_KEY = "sevio:state:v1";
  const STATE_URL_KEYS = ["mode","t","rc","loc","lc","street","metric","seg","market","ct","area","price","invest","ay","af","am"];
  let inputsByType = {"3":{...state.inputs}};

  const MARKET_NAMES={"":"", "n":"Новостройки (2020+)","v":"Вторичка (до 2020)"};
  const CT_NAMES={0:"",1:"Стрит-ритейл",2:"Офисы",3:"Подвал/цоколь",4:"Склады",5:"Кладовки",6:"Машино-места"};
  const YB_NAMES={"1":"до 1960","2":"1960–89","3":"1990–2009","4":"2010–19","5":"2020+"};
  const MAT_NAMES={"1":"кирпич","2":"панель","3":"монолит","4":"блоки","5":"дерево"};

  /* поправочный коэффициент оценки (квартиры): год × этаж × материал, из реальных сделок региона */
  function adjFactor(){
    if(state.t!=="3") return {k:1, parts:[]};
    const adj=(DATA.regions[state.rc]||{}).adj||{};
    let k=1; const parts=[];
    const hum=(kk,what)=>{const d=Math.round((kk-1)*100);
      return d===0 ? what+" — на цену здесь почти не влияет"
        : what+" — такие здесь обычно "+(d>0?"дороже":"дешевле")+" на ~"+Math.abs(d)+"%";};
    const y=state.inputs.ay, m=state.inputs.am, f=state.inputs.af;
    if(y!=="0" && adj.y && adj.y[y]){ k*=adj.y[y]; parts.push(hum(adj.y[y],"дом "+YB_NAMES[y])); }
    if(f==="1" && adj.f1){ k*=adj.f1; parts.push(hum(adj.f1,"первый этаж")); }
    if(m!=="0" && adj.m && adj.m[m]){ k*=adj.m[m]; parts.push(hum(adj.m[m],"стены — "+MAT_NAMES[m])); }
    return {k, parts};
  }

  /* сегмент: ячейка [n,p,u,S,K,P] → [n,p,u] выбранного сегмента */
  const SEG_NAMES={0:"все уровни",1:"Эконом",2:"Средний",3:"Премиум"};
  function segCell(c){
    if(!c) return null;
    if(!state.seg) return c;
    const s=c[2+state.seg];
    return (s&&s[0])?s:null;
  }
  function segArr(arr){ return arr?arr.map(segCell):null; }

  /* ---------- search index ---------- */
  const index = [];
  const TKEYS=["1","2","3","4"];
  function ntOf(src){
    const o={all:0};
    for(const t of TKEYS){
      const arr=src[t]; if(!arr) continue;
      const n=arr.filter(Boolean).reduce((s,c)=>s+c[0],0);
      o[t]=n; o.all+=n;
    }
    for(const [vt,k] of [["5","4c6"],["6","4c5"]]){
      const arr=src[k]; if(!arr) continue;
      o[vt]=arr.filter(Boolean).reduce((s,c)=>s+c[0],0);
    }
    return o;
  }
  for(const [rc,reg] of Object.entries(DATA.regions)){
    index.push({label:reg.name, kind:"region", rc, loc:null, nt:ntOf(reg.tot), labelKey:searchKey(reg.name), contextKey:"", key:locationKey(reg.name)});
    for(const [loc,td] of Object.entries(reg.d)){
      index.push({label:loc, kind:"area", rc, loc, region:reg.name, nt:ntOf(td), labelKey:searchKey(loc), contextKey:searchKey(reg.name), key:locationKey(loc, reg.name)});
    }
  }
  index.sort((a,b)=>b.nt.all-a.nt.all);
  /* индекс улиц: для поиска "моя улица" */
  const streetIndex=[];
  for(const [rc,reg] of Object.entries(DATA.regions)){
    for(const [loc,d] of Object.entries(reg.d)){
      if(!d.st) continue;
      const per={}; // street -> {t:n}
      for(const [tt,lst] of Object.entries(d.st))
        for(const s of lst) (per[s[0]]=per[s[0]]||{})[tt]=s[1];
      for(const [name,nt] of Object.entries(per))
        streetIndex.push({label:name, kind:"street", rc, loc, region:reg.name, street:name, nt, labelKey:searchKey(name), contextKey:locationKey(loc, reg.name), key:locationKey(name, loc, reg.name)});
    }
  }

  /* индекс населённых пунктов */
  const lcIndex=[];
  for(const [rc,reg] of Object.entries(DATA.regions)){
    for(const [loc,d] of Object.entries(reg.d)){
      if(!d.lc) continue;
      for(const [city,e] of Object.entries(d.lc)){
        const nt={all:e.n||0};
        for(const t of TKEYS){ if(e[t]) nt[t]=e[t].filter(Boolean).reduce((s,c)=>s+c[0],0); }
        lcIndex.push({label:city, kind:"settlement", rc, loc, lcName:city, region:reg.name, nt, labelKey:searchKey(city), contextKey:locationKey(loc, reg.name), key:locationKey(city, loc, reg.name)});
      }
    }
  }
  /* ---------- data access ---------- */
  function keyOf(t){ return t==="5" ? "4c6" : t==="6" ? "4c5" : t; }
  function lcEntry(){ if(!state.rc||!state.loc||!state.lc) return null; return (((DATA.regions[state.rc]||{}).d||{})[state.loc]||{}).lc ? ((DATA.regions[state.rc].d[state.loc].lc)||{})[state.lc]||null : null; }
  function lcPooled(e,t){ const arr=e&&e[t]; if(!arr) return null; let n=0,su=0,sp=0; for(const c of arr){ if(!c) continue; n+=c[0]; su+=c[2]*c[0]; sp+=c[1]*c[0]; } return n? {n, u:su/n, p:sp/n} : null; }
  function currentStreetLabel(){
    if(!state.street) return "";
    const region=state.rc&&DATA.regions[state.rc] ? DATA.regions[state.rc].name : "";
    return displayStreetName(state.street, region);
  }
  /* полный ключ среза с учётом ВСЕХ фильтров сверху: тип + рынок + подтип */
  function fullKey(){
    if(state.t==="3" && state.market) return "3"+state.market;
    if(state.t==="4" && state.ct)     return "4c"+state.ct;
    if(state.t==="4" && state.market) return "4"+state.market;
    return keyOf(state.t);
  }
  function hasBase(rc,loc,tt){
    const src = !rc ? DATA.rf : (DATA.regions[rc] ? (loc?(DATA.regions[rc].d[loc]||{}):DATA.regions[rc].tot) : null);
    return !!(src && src[keyOf(tt)]);
  }

  function defaultInputs(t){
    return {area:DEFAULT_AREAS[t]||"", price:"", invest:"", ay:"0", af:"0", am:"0"};
  }
  function rememberTypeInputs(t=state.t){
    inputsByType[t] = {...defaultInputs(t), ...state.inputs};
  }
  function useTypeInputs(t){
    state.inputs = {...defaultInputs(t), ...(inputsByType[t]||{})};
    if(t!=="3"){ state.inputs.ay="0"; state.inputs.af="0"; state.inputs.am="0"; }
  }
  function cleanState(){
    if(!TYPE_NAMES[state.t]) state.t="3";
    if(state.rc && !DATA.regions[state.rc]){ state.rc=null; state.loc=null; state.lc=null; state.street=null; }
    if(state.rc && state.loc && !DATA.regions[state.rc].d[state.loc]){ state.loc=null; state.lc=null; state.street=null; }
    if(state.rc && state.loc && state.lc && !(((DATA.regions[state.rc].d[state.loc]||{}).lc||{})[state.lc])) state.lc=null;
    if(state.rc && state.loc && state.street){
      const streets = ((((DATA.regions[state.rc]||{}).d||{})[state.loc]||{}).st||{})[state.t] || [];
      if(!streets.some(row=>row[0]===state.street)) state.street=null;
    }
    if(state.t!=="4") state.ct=0;
    if(state.t!=="3" && state.t!=="4") state.market="";
    if((state.t==="5"||state.t==="6"||!state.rc) && state.seg) state.seg=0;
    if(!hasBase(state.rc,state.loc,state.t)){
      for(const t of ["3","2","1","4","5","6"]) if(hasBase(state.rc,state.loc,t)){ state.t=t; useTypeInputs(t); break; }
    }
  }
  function restoreState(opts={}){
    const useStorage = opts.useStorage !== false;
    state = makeDefaultState();
    inputsByType = {"3":{...state.inputs}};
    let saved=null;
    if(useStorage){
      try { saved = JSON.parse(window.localStorage.getItem(STATE_STORAGE_KEY)||"null"); } catch(e) {}
      if(saved && saved.inputsByType) inputsByType = saved.inputsByType;
      if(saved && saved.state){
        state = {...state, ...saved.state, inputs:{...state.inputs, ...(saved.state.inputs||{})}};
      }
    }
    const params = new URLSearchParams(location.search);
    if(STATE_URL_KEYS.some(k=>params.has(k))){
      const next = {};
      for(const k of ["mode","t","rc","loc","lc","street","metric","market"]) if(params.has(k)) next[k]=params.get(k)||null;
      for(const k of ["seg","ct"]) if(params.has(k)) next[k]=parseInt(params.get(k),10)||0;
      const inputs = {};
      for(const k of ["area","price","invest","ay","af","am"]) if(params.has(k)) inputs[k]=params.get(k)||"";
      state = {...state, ...next, inputs:{...state.inputs, ...inputs}};
      rememberTypeInputs(state.t);
    }
    cleanState();
  }
  function restoreUrlState(){
    restoreState({useStorage:false});
    render();
  }
  function isDefaultState(){
    const d=defaultInputs("3");
    return !state.rc && !state.loc && !state.lc && !state.street && state.t==="3" && state.mode==="buy" &&
      state.metric==="med" && !state.seg && !state.market && !state.ct &&
      state.inputs.area===d.area && !state.inputs.price && !state.inputs.invest &&
      state.inputs.ay==="0" && state.inputs.af==="0" && state.inputs.am==="0";
  }
  function persistState(){
    rememberTypeInputs(state.t);
    try {
      window.localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify({state:{...state, showAll:false}, inputsByType}));
    } catch(e) {}
    const params = new URLSearchParams(location.search);
    for(const k of STATE_URL_KEYS) params.delete(k);
    if(!isDefaultState()){
      const put=(k,v)=>{ if(v!==null && v!==undefined && v!=="") params.set(k,String(v)); };
      put("mode",state.mode); put("t",state.t); put("rc",state.rc); put("loc",state.loc); put("lc",state.lc); put("street",state.street);
      put("metric",state.metric); put("seg",state.seg||""); put("market",state.market); put("ct",state.ct||"");
      put("area",state.inputs.area); put("price",state.inputs.price); put("invest",state.inputs.invest);
      put("ay",state.inputs.ay!=="0"?state.inputs.ay:""); put("af",state.inputs.af!=="0"?state.inputs.af:""); put("am",state.inputs.am!=="0"?state.inputs.am:"");
    }
    const qs = params.toString();
    const nextUrl = location.pathname + (qs ? "?"+qs : "") + location.hash;
    try {
      if(nextUrl !== location.pathname + location.search + location.hash) window.history.replaceState(null, "", nextUrl);
    } catch(e) {}
  }
  /* срез локации со всеми фильтрами (включая сегмент) — для карты, таблицы, топов */
  function locArr(td){ return segArr((td||{})[fullKey()]||null); }
  function series(rc, loc, t){
    const src = !rc ? DATA.rf : (DATA.regions[rc] ? (loc ? (DATA.regions[rc].d[loc]||{}) : DATA.regions[rc].tot) : null);
    if(!src) return null;
    return src[t===state.t ? fullKey() : keyOf(t)] || null; // [ [n,price,unit,S,K,P] | null x3 ]
  }
  function kpiSeries(fallback){
    if(state.lc && !state.street){
      const e=lcEntry();
      const raw=e && (e[fullKey()] || e[keyOf(state.t)]);
      if(raw && raw.some(Boolean)) return raw;
    }
    return fallback;
  }
  function lastCell(arr){ for(let i=2;i>=0;i--) if(arr&&arr[i]) return {c:arr[i],qi:i}; return null; }
  function firstCell(arr){ for(let i=0;i<3;i++) if(arr&&arr[i]) return {c:arr[i],qi:i}; return null; }
  function totalDeals(arr){ return (arr||[]).filter(Boolean).reduce((s,c)=>s+c[0],0); }

  /* прогноз: среднеквартальный темп по unit-цене, зажатый в ±8% */
  function forecast(arr){
    const f = firstCell(arr), l = lastCell(arr);
    if(!f||!l||l.qi===f.qi) return null;
    if((f.c[0]||0)<10 || (l.c[0]||0)<10) return null;
    const span = l.qi - f.qi;
    let g = Math.pow(l.c[2]/f.c[2], 1/span) - 1;
    g = Math.max(-0.08, Math.min(0.08, g));
    const n = totalDeals(arr);
    const unc = n>=300 ? 0.05 : n>=50 ? 0.09 : 0.15; // неопределённость
    const p1 = l.c[2]*(1+g), p2 = l.c[2]*Math.pow(1+g,2);
    return {g, unc, pts:[p1,p2]};
  }

  /* ---------- render: KPIs ---------- */
  function confidence(n){
    if(n>=300) return {cls:"hi", lb:"надёжные данные · "+fmt(n)+" сделок"};
    if(n>=50)  return {cls:"md", lb:"средняя выборка · "+fmt(n)+" сделок"};
    return {cls:"lo", lb:"мало сделок ("+fmt(n)+") — ориентир"};
  }

  function render(){
    const reg = state.rc ? DATA.regions[state.rc] : null;
    const locLevelArr = segArr(series(state.rc, state.loc, state.t));
    const arr = kpiSeries(locLevelArr);
    const locEl = document.getElementById("locname");
    const subEl = document.getElementById("locsub");
    const confEl = document.getElementById("conf");

    // хлебная крошка: Россия → регион → локация
    let crumbs='<span class="crumb'+(!state.rc?' cur':'')+'" data-lv="rf">Россия</span>';
    if(state.rc) crumbs+=' <span class="csep">→</span> <span class="crumb'+(!state.loc?' cur':'')+'" data-lv="reg">'+reg.name+'</span>';
    if(state.loc) crumbs+=' <span class="csep">→</span> <span class="crumb'+(!state.lc?' cur':'')+'" data-lv="loc">'+state.loc+'</span>';
    if(state.lc) crumbs+=' <span class="csep">→</span> <span class="crumb cur">'+state.lc+'</span>';
    locEl.innerHTML=crumbs;
    locEl.querySelectorAll(".crumb:not(.cur)").forEach(c=>c.onclick=()=>{
      if(c.dataset.lv==="rf"){state.rc=null;state.loc=null;}
      else if(c.dataset.lv==="reg"){state.loc=null;}
      state.lc=null; state.street=null; render();
    });
    subEl.textContent = state.lc ? "населённый пункт · KPI и расчёт по нему, карта и таблица ниже — по округу" : state.loc ? "город/район" : (state.rc ? "весь регион · кликните район на карте ниже" : "вся страна · кликните регион на карте ниже");

    syncForm();

    const kpis = document.getElementById("kpis");
    const chart = document.getElementById("chart");

    // рынок (только квартиры); при выбранном рынке сегменты недоступны — в срезе нет квартилей
    const mktbar=document.getElementById("mktbar");
    mktbar.style.display = (state.t==="3"||state.t==="4") ? "" : "none";
    if(state.t!=="3" && state.t!=="4") state.market="";
    const ctbar=document.getElementById("ctbar");
    ctbar.style.display = state.t==="4" ? "" : "none";
    if(state.t!=="4") state.ct=0;
    document.querySelectorAll(".mk").forEach(b=>{
      b.classList.toggle("on", b.dataset.m===state.market);
      b.classList.toggle("dis", !!state.ct && b.dataset.m!=="");
    });
    document.querySelectorAll(".ctb").forEach(b=>b.classList.toggle("on", +b.dataset.c===state.ct));
    if(state.t==="5"||state.t==="6"||!state.rc) state.seg=0;
    document.querySelectorAll(".sg[data-s]").forEach(b=>{
      b.classList.toggle("on", +b.dataset.s===state.seg);
      b.classList.toggle("dis", (!!state.market||!!state.ct||state.t==="5"||state.t==="6"||!state.rc) && +b.dataset.s>0);
    });

    if(!locLevelArr || !locLevelArr.some(Boolean)){
      confEl.style.display="none";
      kpis.innerHTML = "";
      chart.innerHTML = '<div class="nodata">'+(state.seg
        ? 'В сегменте «'+SEG_NAMES[state.seg]+'» здесь недостаточно сделок.<br>Выберите «Все» или другой район.'
        : 'По типу «'+TYPE_NAMES[state.t]+'» в этой локации недостаточно сделок.<br>Попробуйте другой тип объекта или соседний район.')+'</div>';
      document.getElementById("ask-result").innerHTML =
        '<div class="nodata" style="padding:16px">Недостаточно данных в этом срезе</div>';
      renderMap(); renderTable();
      persistState();
      return;
    }

    const l = lastCell(arr), f = firstCell(arr);
    const locLevelLast = lastCell(locLevelArr);
    const BU = locLevelLast ? baseUnit(locLevelLast) : {unit:l.c[2], n:l.c[0], src:"loc", lbl:"типичная цена в этой локации"};
    const n = BU.n || totalDeals(arr);
    const cf = confidence(n);
    confEl.style.display="";
    confEl.className = "conf "+cf.cls;
    confEl.textContent = cf.lb;

    const chg = (BU.src==="loc"&&state.metric==="med"&&l&&f&&l.qi!==f.qi&&l.c[0]>=10&&f.c[0]>=10) ? l.c[2]/f.c[2]-1 : null;
    const fc = forecast(arr);

    const segSuffix = (state.ct ? " · "+CT_NAMES[state.ct] : "") + (state.market ? " · "+MARKET_NAMES[state.market] : "") + (state.seg ? " · "+SEG_NAMES[state.seg] : "");
    const area = parseFloat(state.inputs.area);
    const areaEstimate = area>0 ? BU.unit * area * adjFactor().k : null;
    const basisSuffix = BU.src==="lc" ? " · "+state.lc : BU.src==="street" ? " · "+currentStreetLabel() : segSuffix;
    const kpiData = [
      {main:1, lb:"Цена за "+(state.t==="1"?"сотку":"м²")+basisSuffix,
       v:fmt(BU.unit), u:UNIT[state.t],
       d: chg==null?null:{x:chg, txt:pct(chg)+" за "+(l.qi-f.qi)+" кв."}},
      {lb:areaEstimate ? "Оценка "+fmt(area)+" "+AREA_UNIT[state.t] : "Медиана сделки целиком"+basisSuffix,
       v: areaEstimate ? fmtMoney(areaEstimate).replace(" ₽","") : (l.c[1]>=1e6 ? (l.c[1]/1e6).toLocaleString("ru-RU",{maximumFractionDigits:2}) : fmt(l.c[1])),
       u: areaEstimate ? "₽" : (l.c[1]>=1e6 ? "млн ₽" : "₽"),
       d: areaEstimate ? {x:0, txt:fmt(BU.unit)+" "+UNIT[state.t]+" × "+fmt(area)+" "+AREA_UNIT[state.t]} : null},
      {lb:"Как часто здесь покупают"+basisSuffix, v:fmt(Math.max(1,Math.round(n/9))), u:"сделок в месяц",
       d:{x:0, txt: liquidity(n).txt.split("·")[1].trim()+" · всего "+fmt(n)+" за 9 мес"}},
      {lb:"Что будет с ценой"+segSuffix+" · "+FQ[0], v: fc?fmtShort(fc.pts[0]):"—", u:fc?UNIT[state.t]:"",
       d: fc?{x:fc.g, txt:pct(fc.g)+" в квартал, если тренд сохранится"}:null},
    ];
    kpis.innerHTML = kpiData.map(k=>`
      <div class="kpi ${k.main?'main':''}">
        <div class="lb">${k.lb}</div>
        <div class="v">${k.v} <span class="u">${k.u}</span></div>
        ${k.d?`<div class="d ${k.d.x>0.005?'up':k.d.x<-0.005?'dn':'fl'}">${k.d.txt}</div>`:""}
      </div>`).join("");

    renderChart(arr, fc);
    renderSide(locLevelLast);
    renderStreets(locLevelLast);
    renderMap();
    renderTable();
    persistState();
  }

  /* ---------- улицы ---------- */
  let stShowAll=false, stKey="";
  function renderStreets(l){
    const panel=document.getElementById("streets-panel");
    const reg=DATA.regions[state.rc];
    const st = state.loc && reg.d[state.loc] && reg.d[state.loc].st && reg.d[state.loc].st[state.t];
    if(!st || !st.length){ panel.style.display="none"; return; }
    panel.style.display="";
    const key=state.rc+"|"+state.loc+"|"+state.t;
    if(key!==stKey){ stKey=key; stShowAll=false; document.getElementById("st-search").value=""; }
    const noFilt=(state.seg||state.market||state.ct);
    document.getElementById("st-title").textContent="Улицы · "+state.loc+" · "+TYPE_NAMES[state.t]+" · "+st.length+" улиц"+(noFilt?" · без учёта фильтра":"");
    document.querySelector("#streets-panel .hint").textContent = noFilt
      ? "К улицам фильтры сегмента/фонда/подтипа не применяются — показаны все сделки типа «"+TYPE_NAMES[state.t]+"»"
      : "Медианы реальных сделок за 9 месяцев · улицы с 15+ сделками · сравнение с медианой локации";
    const q=(document.getElementById("st-search").value||"").trim().toLowerCase();
    let rows = q ? st.filter(s=>s[0].toLowerCase().includes(q)) : st;
    const shown = (stShowAll||q) ? rows : rows.slice(0,10);
    const base = l ? l.c[2] : null;
    const maxU = Math.max(...rows.map(s=>s[3]), 1);
    document.getElementById("st-list").innerHTML = shown.map(s=>{
      const d = base ? s[3]/base-1 : null;
      return `<div class="strow">
        <span class="sn2">${s[0]}<small> · ${fmt(s[1])} сд.</small></span>
        <span class="sbar"><i style="width:${Math.max(6,Math.round(s[3]/maxU*100))}%"></i></span>
        <span class="sv2">${fmt(s[3])} ${UNIT[state.t]}</span>
        <span class="sd">${d==null?"":`<span class="${d>0.02?'pos':d<-0.02?'neg':''}">${pct(d)} к локации</span>`}</span>
      </div>`;
    }).join("") || '<div class="nodata">Улица не найдена</div>';
    const mb=document.getElementById("st-more");
    mb.style.display=(rows.length>10&&!q)?"block":"none";
    mb.textContent=stShowAll?"Свернуть":"Показать все ("+rows.length+")";
  }
  document.getElementById("st-search").addEventListener("input",()=>{
    const arr=segArr(series(state.rc,state.loc,state.t)); renderStreets(arr&&lastCell(arr));
  });
  document.getElementById("st-more").onclick=()=>{
    stShowAll=!stShowAll;
    const arr=segArr(series(state.rc,state.loc,state.t)); renderStreets(arr&&lastCell(arr));
  };

  /* ---------- карта районов: тепловая плитка ---------- */
  function renderMap(){
    const reg=state.rc?DATA.regions[state.rc]:null;
    const cr=document.getElementById("crumbs");
    if(cr) cr.innerHTML="";
    const filtSuffix=(state.ct?" · "+CT_NAMES[state.ct]:"")+(state.market?" · "+MARKET_NAMES[state.market]:"")+(state.seg?" · "+SEG_NAMES[state.seg]:"");
    const hasStreetMap = !!(state.rc && state.loc && (((DATA.regions[state.rc]||{}).d||{})[state.loc]||{}).st);
    const lvl = !state.rc ? "rf" : (state.loc && hasStreetMap ? "street" : "loc");
    document.getElementById("map-title").textContent =
      (lvl==="rf" ? "Карта регионов · Россия" : lvl==="street" ? "Карта улиц · "+state.loc : "Карта районов · "+reg.name)
      +" · "+TYPE_NAMES[state.t]+(lvl==="street"?" · фильтры не применяются":filtSuffix);
    const rows=[];
    if(lvl==="rf"){
      for(const [rc2,rg] of Object.entries(DATA.regions)){
        const v=locArr(rg.tot); const l=v&&lastCell(v); if(!l) continue;
        rows.push({loc:rg.name, rc2, n:totalDeals(v), u:l.c[2]});
      }
    } else if(lvl==="street"){
      const st=(reg.d[state.loc]||{}).st;
      for(const s of (st&&st[state.t])||[]) rows.push({loc:s[0], street:true, n:s[1], u:s[3]});
    } else
    for(const [loc,td] of Object.entries(reg.d)){
      const v=locArr(td); const l=v&&lastCell(v); if(!l) continue;
      rows.push({loc, n:totalDeals(v), u:l.c[2]});
    }
    rows.sort((a,b)=>b.n-a.n);
    const top=rows.slice(0,40);
    const el=document.getElementById("tilemap");
    if(!top.length){ el.innerHTML='<div class="nodata">Нет районов с данными в этом сегменте</div>'; return; }
    const us=top.map(r=>r.u).sort((a,b)=>a-b);
    const lo=us[Math.floor(us.length*.08)], hi=us[Math.min(us.length-1,Math.floor(us.length*.92))];
    const tot=top.reduce((s,r)=>s+r.n,0);
    const color=u=>{
      let x=hi>lo?(u-lo)/(hi-lo):0.5; x=Math.max(0,Math.min(1,x));
      const st=[[34,211,238],[124,92,255],[251,191,36]];
      const s=x<0.5?0:1, t2=(x-s*0.5)*2, a=st[s], b=st[s+1];
      return "rgb("+Math.round(a[0]+(b[0]-a[0])*t2)+","+Math.round(a[1]+(b[1]-a[1])*t2)+","+Math.round(a[2]+(b[2]-a[2])*t2)+")";
    };
    el.innerHTML=top.map(r=>{
      const share=r.n/tot;
      return `<div class="tile ${(r.street? r.loc===state.street : r.loc===state.loc)?'sel':''}" data-loc="${r.loc.replace(/"/g,'&quot;')}"
        style="background:${color(r.u)};flex-grow:${Math.max(1,Math.round(share*140))};flex-basis:${Math.max(88,Math.round(Math.sqrt(share)*560))}px"
        title="${r.loc}: ${fmt(r.u)} ${UNIT[state.t]} · ${fmt(r.n)} сделок">
        <div class="tn">${r.loc}</div><div class="tv">${fmtShort(r.u)} ${UNIT[state.t]} · ${fmt(r.n)} сд.</div></div>`;
    }).join("");
    el.querySelectorAll(".tile").forEach(tl=>{
      const r=rows.find(x=>x.loc===tl.dataset.loc);
      tl.onclick=()=>{
        if(lvl==="rf"){ state.rc=r.rc2; state.loc=null; state.lc=null; state.street=null; }
        else if(lvl==="street"){ state.lc=null; state.street=r.loc; syncForm(); refreshSide(); showToast("улица "+r.loc+" — расчёт в форме"); return; }
        else { state.loc=tl.dataset.loc; state.lc=null; state.street=null; }
        render(); showToast(tl.dataset.loc);
      };
    });
  }

  /* ликвидность: сделок в месяц */
  function liquidity(n){
    const pm = n/9;
    if(pm>=30) return {pm, lvl:"hi", txt:"≈"+Math.round(pm)+" в месяц · высокая ликвидность"};
    if(pm>=8)  return {pm, lvl:"md", txt:"≈"+Math.round(pm)+" в месяц · средняя ликвидность"};
    return {pm, lvl:"lo", txt:"≈"+(pm<1?"1 и реже":Math.round(pm))+" в месяц · низкая ликвидность"};
  }

  /* ---------- chart (SVG) ---------- */
  function renderChart(arr, fc){
    const chart = document.getElementById("chart");
    document.getElementById("chart-title").textContent =
      "Динамика и прогноз · "+locLabel()+(state.ct?" · "+CT_NAMES[state.ct]:"")+(state.market?" · "+MARKET_NAMES[state.market]:"")+(state.seg?" · "+SEG_NAMES[state.seg]:"");
    document.getElementById("chart-hint").textContent =
      "Медианная цена за "+(state.t==="1"?"сотку":"м²")+" по кварталам · пунктир — прогноз";
    const vals = arr.map(c=>c?c[2]:null);
    const fvals = fc ? fc.pts : [null,null];
    const all = [...vals, ...fvals].filter(v=>v!=null);
    if(!all.length){chart.innerHTML="";return;}
    const labels = [...Q, ...FQ];
    const series5 = [...vals, ...fvals];
    const W=560, H=250, padL=8, padB=30, padT=34;
    const max = Math.max(...all)*1.08, min = Math.min(...all)*0.86;
    const bw = 66, gap=(W-padL*2-bw*5)/4;
    let bars="";
    series5.forEach((v,i)=>{
      const x = padL + i*(bw+gap);
      const lb = `<text x="${x+bw/2}" y="${H-8}" text-anchor="middle" font-size="12" class="ctm">${labels[i]}</text>`;
      if(v==null){ bars+=lb+`<text x="${x+bw/2}" y="${H-padB-14}" text-anchor="middle" font-size="11" class="ctm">нет данных</text>`; return; }
      const h = (v-min)/(max-min)*(H-padB-padT);
      const y = H-padB-h;
      if(i<3){
        bars+=`<defs><linearGradient id="g${i}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#22d3ee" stop-opacity=".55"/></linearGradient></defs>
        <rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="10" fill="url(#g${i})"/>`;
      } else {
        const u = fc.unc;
        const yHi = H-padB-((v*(1+u)-min)/(max-min)*(H-padB-padT));
        const yLo = H-padB-((v*(1-u)-min)/(max-min)*(H-padB-padT));
        bars+=`<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="10" fill="rgba(139,148,171,.08)" stroke="#8b94ab" stroke-width="1.6" stroke-dasharray="5 4"/>
        <line x1="${x+bw/2}" y1="${yHi}" x2="${x+bw/2}" y2="${yLo}" stroke="#8b94ab" stroke-width="1.4"/>
        <line x1="${x+bw/2-7}" y1="${yHi}" x2="${x+bw/2+7}" y2="${yHi}" stroke="#8b94ab" stroke-width="1.4"/>
        <line x1="${x+bw/2-7}" y1="${yLo}" x2="${x+bw/2+7}" y2="${yLo}" stroke="#8b94ab" stroke-width="1.4"/>`;
      }
      bars+=`<text x="${x+bw/2}" y="${y-9}" text-anchor="middle" font-size="12.5" font-weight="700" class="${i<3?'ct':'ctm'}">${fmtShort(v)}</text>`+lb;
    });
    chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${bars}</svg>`;
  }

  /* ---------- сценарные панели (JTBD) ---------- */
  const MODE_TITLES = {buy:"Проверить цену объявления", sell:"Оценить мой объект", invest:"Где растёт и что ликвидно"};

  function locLabel(){ return currentStreetLabel() || state.lc || state.loc || (state.rc ? DATA.regions[state.rc].name : "Россия"); }

  function renderSide(l){
    const el = document.getElementById("ask-result");
    const arr = segArr(series(state.rc, state.loc, state.t));
    const n = totalDeals(arr);
    const spread = n>=300?0.12:n>=50?0.18:0.25;
    const unit = l.c[2];
    const au = AREA_UNIT[state.t];

    if(state.mode==="buy"){
      el.innerHTML = `<div id="side-res"></div>`;
      renderBuyResult(l, unit, spread);
    } else if(state.mode==="sell"){
      el.innerHTML = `<div id="side-res"></div>`;
      renderSellResult(l, unit, spread, n);
    } else {
      renderInvest(el);
    }
    if (window.SevioLike && el.querySelector(".big")) window.SevioLike.reveal();
  }

  /* база расчёта: улица (если выбрана) или район; метрика: медиана / нижний / верхний квартиль */
  function baseUnit(l){
    let unit=l.c[2], n=l.c[0], src="loc", lbl="типичная цена в этой локации";
    if(state.metric!=="med" && !state.street){
      const raw=(series(state.rc,state.loc,state.t)||[])[l.qi];
      if(state.metric==="avg"){
        if(raw && raw[6]){ unit=raw[6]; lbl="средняя цена — её тянут вверх дорогие лоты"; }
      } else {
        const segc = raw && (state.metric==="low" ? raw[3] : raw[5]);
        if(segc && segc[0]){ unit=segc[2]; n=segc[0]; lbl = state.metric==="low" ? "расчёт по дешёвой четверти сделок" : "расчёт по дорогой четверти сделок"; }
      }
    }
    if(state.lc && !state.street){
      const g=lcPooled(lcEntry(),state.t);
      if(g){ unit=g.u; n=g.n; src="lc"; lbl="типичная цена по «"+state.lc+"» за 9 месяцев"; }
    }
    if(state.street){
      let row=null;
      if(state.lc){ const e=lcEntry(); const l=e&&e.st&&e.st[state.t]; row=l&&l.find(s=>s[0]===state.street); }
      if(!row){ const st=(((DATA.regions[state.rc]||{}).d||{})[state.loc]||{}).st; row=st && st[state.t] && st[state.t].find(s=>s[0]===state.street); }
      if(row){ unit=row[3]; n=row[1]; src="street"; lbl="типичная цена по улице за 9 месяцев"; }
    }
    return {unit,n,src,lbl};
  }
  function streetNoteHTML(BU){
    if(BU.src!=="street"&&BU.src!=="lc") return "";
    const what=BU.src==="street" ? "улице "+currentStreetLabel() : "населённому пункту «"+state.lc+"»";
    const weak=BU.n<25;
    return `<div class="street-note ${weak?'weak':''}">Расчёт по ${what}: ${fmt(BU.n)} ${BU.n%10===1&&BU.n%100!==11?"сделка":BU.n%10>=2&&BU.n%10<=4&&(BU.n%100<10||BU.n%100>=20)?"сделки":"сделок"} за 9 месяцев.${weak?" Этого мало для надёжной оценки — считайте ориентиром.":""} Надёжнее по округу: <button type="button" id="to-loc">считать по ${state.loc}</button></div>`;
  }
  function wireStreetNote(){
    const b=document.getElementById("to-loc");
    if(b) b.onclick=()=>{ state.street=null; state.lc=null; syncForm(); refreshSide(); };
  }
  /* доверие: сколько реальных сделок за расчётом (для улицы/нас.пункта есть своя плашка) */
  const ndealsHTML = BU => BU.src==="loc" && BU.n
    ? `<div class="ndeals">по ${fmt(BU.n)} ${BU.n%10===1&&BU.n%100!==11?"реальной сделке":"реальным сделкам"} за 9 месяцев</div>` : "";
  /* эхо параметров, введённых в форме сверху — без второго ввода */
  function echoHTML(mode, defSum){
    const a=state.inputs.area, p=state.inputs.price, inv=state.inputs.invest;
    let parts=[];
    if(mode==="invest"){
      parts.push(inv? "<b>"+fmtMoney(parseFloat(inv))+"</b>" : "<b>"+fmtMoney(defSum)+"</b> <span class='muted'>· типичный объект, сумму можно задать в форме ↑</span>");
    } else {
      parts.push(a? "<b>"+fmt(parseFloat(a))+" "+AREA_UNIT[state.t]+"</b>" : "<span class='muted'>площадь не указана</span>");
      if(mode==="buy") parts.push(p? "<b>"+fmtMoney(parseFloat(p))+"</b> <span class='muted'>цена объявления</span>" : "<span class='muted'>цена объявления не указана</span>");
    }
    return `<div class="echo">${parts.join(' <span class="muted">·</span> ')}<button type="button" class="echo-edit">Изменить в форме ↑</button></div>`;
  }
  function wireEcho(){
    document.querySelectorAll(".echo-edit").forEach(b=>b.onclick=()=>{
      document.querySelector(".ask").scrollIntoView({behavior:"smooth",block:"center"});
      const f=document.getElementById("fa")||document.getElementById("fi");
      if(f) setTimeout(()=>f.focus(),400);
    });
  }
  function refreshSide(){
    const arr=segArr(series(state.rc,state.loc,state.t));
    const lc=arr&&lastCell(arr);
    if(lc) renderSide(lc);
  }
  function wireInputs(cb){
    ["in-area","in-price"].forEach(id=>{
      const inp=document.getElementById(id);
      if(inp) inp.addEventListener("input",()=>{
        state.inputs[id==="in-area"?"area":"price"]=inp.value;
        cb();
      });
    });
    [["adj-y","ay"],["adj-f","af"],["adj-m","am"]].forEach(([id,key])=>{
      const s=document.getElementById(id);
      if(s) s.addEventListener("change",()=>{ state.inputs[key]=s.value; cb(); });
    });
  }

  /* уточнение оценки: селекты год/этаж/материал (только квартиры и только если для региона есть поправки) */
  function adjRowHTML(){
    if(state.t!=="3") return "";
    const adj=(DATA.regions[state.rc]||{}).adj;
    if(!adj) return "";
    const opt=(v,lb,cur)=>`<option value="${v}" ${v===cur?"selected":""}>${lb}</option>`;
    return `<div class="adj-row">
      <select id="adj-y">${opt("0","год дома: любой",state.inputs.ay)}${Object.keys(YB_NAMES).map(k=>opt(k,YB_NAMES[k],state.inputs.ay)).join("")}</select>
      <select id="adj-f">${opt("0","этаж: любой",state.inputs.af)}${opt("1","первый",state.inputs.af)}${opt("2","не первый",state.inputs.af)}</select>
      <select id="adj-m">${opt("0","стены: любые",state.inputs.am)}${Object.keys(MAT_NAMES).map(k=>opt(k,MAT_NAMES[k],state.inputs.am)).join("")}</select>
    </div>`;
  }

  function renderBuyResult(l, unit, spread){
    const res = document.getElementById("side-res");
    const area = parseFloat(state.inputs.area), price = parseFloat(state.inputs.price);
    if(!area||area<=0){
      res.innerHTML = `<div class="res-hint">Укажите площадь и мы покажем, за сколько здесь реально покупают. Точнее будет с ценой объявления и параметрами объекта.</div>`;
      return;
    }
    const BU=baseUnit(l);
    unit=BU.unit;
    spread = BU.n>=300?0.12:BU.n>=50?0.18:0.25;
    const A = adjFactor();
    const market = unit*area*A.k;
    const lo=market*(1-spread), hi=market*(1+spread);
    const loUnit=unit*(1-spread), hiUnit=unit*(1+spread);
    const adjNote = A.parts.length ? `<div class="adj-note">Учли особенности объекта (по реальным сделкам региона): ${A.parts.join(" · ")}</div>` : "";
    const pos=v=>Math.max(3,Math.min(97,(v-lo)/(hi-lo)*100));
    const yp = price?pos(price):0;
    const scale=(cls)=>`<div class="scale">
        ${price?`<div class="scale-you ${cls} ${yp<15?"edge-l":yp>85?"edge-r":""}" style="left:${yp}%"><span>ваша цена ${fmtMoney(price)}</span><i></i></div>`:""}
        <div class="scale-track"></div>
        <div class="scale-med" style="left:${pos(market)}%"><i></i><span>чаще всего ≈ ${fmtMoney(market)}<small>${fmt(unit)} ${UNIT[state.t]}</small></span></div>
        <div class="scale-min">дешёвые · ${fmtMoney(lo)}<small>${fmt(loUnit)} ${UNIT[state.t]}</small></div><div class="scale-max">${fmtMoney(hi)} · дорогие<small>${fmt(hiUnit)} ${UNIT[state.t]}</small></div>
      </div>`;
    const head=`<span class="rp-lbl">За сколько ${BU.src==="street"?"на «"+currentStreetLabel()+"»":BU.src==="lc"?"в «"+state.lc+"»":"здесь"} покупают ${fmt(area)} ${AREA_UNIT[state.t]}</span>
        <div class="big">≈ ${fmtMoney(market)}</div>
        <div class="rng">реальные сделки: от ${fmtMoney(lo)} до ${fmtMoney(hi)}</div>
        ${ndealsHTML(BU)}
        ${state.metric!=="med"&&!state.street?`<div class="metric-note">${BU.lbl}</div>`:""}
        ${streetNoteHTML(BU)}`;
    if(!price||price<=0){
      res.innerHTML = `<div class="res">${head}${scale("")}
        <div class="res-hint" style="border:none;padding:0;margin-top:0">Добавьте цену из объявления и мы покажем её на шкале и скажем, стоит ли торговаться.</div>${adjNote}</div>`;
      wireStreetNote();
      return;
    }
    const dev = price/market - 1;
    const diff = Math.abs(price-market);
    let cls,vt,vd,rub="";
    if(dev<=-0.10){cls="good";vt="Ниже рынка на "+pct(-dev).replace("+","");
      rub="Экономия против типичной сделки ≈ "+fmtMoney(diff);
      vd="Похоже на выгодную цену. Проверьте документы и состояние: сильный дисконт часто имеет причину.";}
    else if(dev<=0.05){cls="ok";vt="Цена в рынке";
      vd="Запрашиваемая цена соответствует реальным сделкам. Умеренный торг на 2–5% здесь обычная практика.";}
    else if(dev<=0.18){cls="warn";vt="Выше рынка на "+pct(dev);
      rub="Переплата против типичной сделки ≈ "+fmtMoney(diff);
      vd="Покажите продавцу: половина реальных сделок такого метража здесь закрывается дешевле "+fmtMoney(market)+". Это ваш аргумент для торга.";}
    else {cls="bad";vt="Существенно выше рынка: "+pct(dev);
      rub="Переплата против типичной сделки ≈ "+fmtMoney(diff);
      vd="Половина похожих объектов здесь продана дешевле "+fmtMoney(market)+". Либо объект действительно уникален, либо продавец переоценивает.";}
    const fits = budgetFits(price, area).slice(0,4);
    res.innerHTML = `
      <div class="verdict ${cls}"><div class="vt">${vt}</div>
        ${rub?`<div class="vd" style="font-weight:700;color:var(--text);margin-top:4px">${rub}</div>`:""}
        <div class="vd">${vd}</div>
      </div>
      <div class="res" style="margin-top:12px">${head}${scale(cls)}${adjNote}</div>
      ${fits.length?`<div class="fitlist"><div style="color:var(--muted2);font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">За этот бюджет также доступны</div>
        ${fits.map(f=>`<div class="fi" data-loc="${f.loc.replace(/"/g,'&quot;')}"><b>${f.loc}</b><span>${fmtMoney(f.est)} за ${fmt(area)} ${AREA_UNIT[state.t]}<i class="go">→</i></span></div>`).join("")}</div>`:""}`;
    res.querySelectorAll(".fi").forEach(fi=>fi.onclick=()=>{state.loc=fi.dataset.loc;state.lc=null;state.street=null;render();});
    wireStreetNote();
  }

  function budgetFits(budget, area){
    const out=[];
    const src = state.rc ? Object.entries((DATA.regions[state.rc]||{d:{}}).d) : Object.entries(DATA.regions).map(([rc2,rg])=>[rg.name,rg.tot]);
    for(const [loc,td] of src){
      if(loc===state.loc) continue;
      const arr=locArr(td); const l=arr&&lastCell(arr); if(!l) continue;
      const est=l.c[2]*area;
      if(est<=budget) out.push({loc, est});
    }
    return out.sort((a,b)=>b.est-a.est);
  }

  function renderSellResult(l, unit, spread, n){
    const res = document.getElementById("side-res");
    const area = parseFloat(state.inputs.area);
    if(!area||area<=0){
      res.innerHTML = `<div class="res-hint">Укажите площадь и мы оценим объект по реальным сделкам. Точнее будет с годом дома, этажом и стенами.</div>`;
      return;
    }
    const BU=baseUnit(l);
    unit=BU.unit;
    spread = BU.n>=300?0.12:BU.n>=50?0.18:0.25;
    const A = adjFactor();
    const v = unit*area*A.k;
    const lq = liquidity(n);
    const demand = lq.lvl==="hi" ? "Спрос высокий — при цене в рынке продажа обычно не затягивается."
      : lq.lvl==="md" ? "Спрос умеренный — заложите время на экспозицию и покажите объект хорошо."
      : "Сделки здесь редки — цена в рынке и терпение важнее агрессивного маркетинга.";
    res.innerHTML = `
      <div class="res">
        <div class="big">≈ ${fmtMoney(v)}</div>
        <div class="rng">вероятный диапазон: от ${fmtMoney(v*(1-spread))} до ${fmtMoney(v*(1+spread))}</div>
        ${ndealsHTML(BU)}
        ${streetNoteHTML(BU)}
        ${A.parts.length?`<div class="adj-note">Учли особенности объекта (по реальным сделкам региона): ${A.parts.join(" · ")}</div>`:""}
        <div class="base">Расчёт: ${fmt(area)} ${AREA_UNIT[state.t]} × ${fmt(unit)} ${UNIT[state.t]} (${BU.src==="street"?"улица, 9 мес":BU.lbl})${A.k!==1?" с учётом особенностей объекта":""}. Диапазон отражает разброс цен внутри локации.</div>
      </div>
      <div class="verdict ${lq.lvl==='hi'?'good':lq.lvl==='md'?'ok':'warn'}" style="margin-top:12px">
        <div class="vt" style="font-size:15.5px">Покупают ${lq.txt.replace('≈','≈ ')}</div>
        <div class="vd">${demand}</div>
        <div class="vd" style="margin-top:6px;font-weight:700;color:var(--text)">Стартовая цена: ${fmtMoney(v*1.05)} · разумный минимум в торге: ${fmtMoney(v*0.96)}</div>
      </div>`;
    wireStreetNote();
  }

  /* годовые сценарии доходности из квартального тренда */
  function investScenarios(arr){
    const fc = forecast(arr);
    let annual = fc ? Math.pow(1+fc.g, 4) - 1 : 0.04;
    annual = Math.max(-0.05, Math.min(0.15, annual));
    return {
      cons: Math.max(-0.02, annual-0.05),
      base: annual,
      opt:  annual+0.04
    };
  }

  function renderInvest(el){
    const reg = state.rc ? DATA.regions[state.rc] : null;
    const arr = segArr(series(state.rc, state.loc, state.t));
    const l = arr && lastCell(arr);
    const H = state.horizon;
    // сумма: введённая или медианная цена объекта в локации
    const defSum = l ? l.c[1] : 5000000;
    const sumIn = parseFloat(state.inputs.invest);
    const sum = (sumIn && sumIn>0) ? sumIn : defSum;
    const sc = arr ? investScenarios(arr) : null;

    // топ роста в регионе
    const rows=[];
    const invSrc = state.rc ? Object.entries(reg.d) : Object.entries(DATA.regions).map(([rc2,rg])=>[rg.name,rg.tot]);
    for(const [loc,td] of invSrc){
      const a=locArr(td); if(!a) continue;
      const ll=lastCell(a), ff=firstCell(a);
      if(!ll||!ff||ll.qi===ff.qi||ll.c[0]<10||ff.c[0]<10) continue;
      const n=totalDeals(a);
      const minN=(state.seg||state.market||state.ct||state.t==="5"||state.t==="6")?30:100;
      if(n<minN) continue;
      rows.push({loc, n, u:ll.c[2], chg:ll.c[2]/ff.c[2]-1});
    }
    rows.sort((a,b)=>b.chg-a.chg);
    const top=rows.slice(0,3);

    const yw = h => h===3 ? "года" : "лет";
    const scnRow = (name, r) => {
      const v = sum*Math.pow(1+r, H);
      const profit = v-sum;
      return `<div class="scn"><span class="sn">${name} · ${pct(r)}/год</span>
        <span><span class="sv">${fmtMoney(v)}</span> <span class="sp">${profit>=0?"+":"−"}${fmtMoney(Math.abs(profit))}</span></span></div>`;
    };

    el.innerHTML = `
      <div class="hz" id="hz">${[3,5,7,10].map(h=>`<button data-h="${h}" class="${h===H?'on':''}">${h} ${yw(h)}</button>`).join("")}</div>
      ${sc?`
      <div class="verdict ok" style="margin-top:14px">
        <div class="vt" style="font-size:15px">Вложение ${fmtMoney(sum)} через ${H} ${yw(H)}</div>
        <div style="margin-top:8px">
          ${scnRow("Консервативный", sc.cons)}
          ${scnRow("Базовый (тренд)", sc.base)}
          ${scnRow("Оптимистичный", sc.opt)}
        </div>
        <div class="vd" style="margin-top:8px">Базовый темп — годовой эквивалент тренда реальных цен за 3 квартала, ограничен −5…+15%/год. Без учёта аренды, налогов и издержек сделки. Не инвестиционная рекомендация.</div>
      </div>`:`<div class="nodata">Недостаточно данных для сценариев</div>`}
      ${top.length?`<div style="margin-top:16px;color:var(--muted2);font-size:12px;text-transform:uppercase;letter-spacing:.06em">Растут быстрее всех в регионе</div>
      <div class="inv">${top.map((r,i)=>`
        <div class="ri" data-loc="${r.loc.replace(/"/g,'&quot;')}">
          <div class="rank">${i+1}</div>
          <div class="nm">${r.loc}<small>${fmt(r.u)} ${UNIT[state.t]} · ${liquidity(r.n).txt.split("·")[1].trim()}</small></div>
          <div class="gr ${r.chg>0?'pos':'neg'}">${pct(r.chg)}</div>
        </div>`).join("")}</div>`:""}`;

    el.querySelectorAll("#hz button").forEach(b=>b.onclick=()=>{state.horizon=+b.dataset.h; renderInvest(el);});
    el.querySelectorAll(".ri").forEach(ri=>ri.onclick=()=>{state.loc=ri.dataset.loc;render();});
  }

  /* ---------- table ---------- */
  const COLS = [
    {id:"loc", lb:"Локация"},
    {id:"n", lb:"Сделок"},
    {id:"price", lb:"Медиана сделки"},
    {id:"u", lb:"Цена за м²/сот."},
    {id:"chg", lb:"Динамика"},
  ];
  function renderTable(){
    const reg = state.rc ? DATA.regions[state.rc] : null;
    const lvl = state.rc ? "loc" : "rf";
    document.getElementById("tbl-title").textContent = (lvl==="rf" ? "Регионы России" : "Районы и города · "+reg.name)+" · "+TYPE_NAMES[state.t]
      +(state.ct?" · "+CT_NAMES[state.ct]:"")+(state.market?" · "+MARKET_NAMES[state.market]:"")+(state.seg?" · "+SEG_NAMES[state.seg]:"");
    const rows = [];
    const src = lvl==="rf" ? Object.entries(DATA.regions).map(([rc2,rg])=>[rg.name,rg.tot,rc2]) : Object.entries(reg.d);
    for(const [loc,td,rc2] of src){
      const arr = locArr(td); if(!arr) continue;
      const l=lastCell(arr), f=firstCell(arr);
      if(!l) continue;
      rows.push({loc, rc2, n:totalDeals(arr), price:l.c[1], u:l.c[2], small:l.c[0]<10,
        chg:(f&&l.qi!==f.qi&&l.c[0]>=10&&f.c[0]>=10)?l.c[2]/f.c[2]-1:null});
    }
    rows.sort((a,b)=>{
      const k=state.sortBy, d=state.sortDir;
      const av=a[k]==null?-Infinity:a[k], bv=b[k]==null?-Infinity:b[k];
      if(k==="loc") return d*String(a.loc).localeCompare(b.loc,"ru");
      return d*(av-bv);
    });
    const thead=document.getElementById("thead");
    thead.innerHTML = COLS.map(c=>`<th data-c="${c.id}" class="${state.sortBy===c.id?'sorted':''}">${c.lb}${state.sortBy===c.id?(state.sortDir<0?" ↓":" ↑"):""}</th>`).join("");
    thead.querySelectorAll("th").forEach(th=>th.onclick=()=>{
      const c=th.dataset.c;
      if(state.sortBy===c) state.sortDir*=-1; else {state.sortBy=c; state.sortDir = c==="loc"?1:-1;}
      renderTable();
    });
    // фильтр по названию района
    const q=(document.getElementById("tbl-search").value||"").trim().toLowerCase();
    const frows = q ? rows.filter(r=>r.loc.toLowerCase().includes(q)) : rows;
    const shown = (state.showAll||q)?frows:frows.slice(0,12);
    const hasStreets = loc => { if(lvl==="rf") return false; const d=reg.d[loc]; return d && d.st && d.st[state.t] && d.st[state.t].length; };
    document.getElementById("tbody").innerHTML = shown.map(r=>`
      <tr data-loc="${r.loc.replace(/"/g,'&quot;')}">
        <td>${hasStreets(r.loc)?`<button class="st-toggle" data-st="${r.loc.replace(/"/g,'&quot;')}" title="Улицы района">▸</button> `:""}${r.loc}</td>
        <td>${fmt(r.n)}${r.small?' <span class="fl" title="мало сделок в последнем квартале — цифры ориентировочные">⚠</span>':''}</td><td>${fmtMoney(r.price)}</td>
        <td>${fmt(r.u)}</td>
        <td>${r.chg==null?'<span class="fl" title="динамика скрыта: менее 10 сделок в квартале">—</span>':`<span class="${r.chg>0.005?'pos':r.chg<-0.005?'neg':'fl'}">${pct(r.chg)}</span>`}</td>
      </tr>`).join("") || `<tr><td colspan="5" class="nodata">${q?"Район не найден":"Нет локаций с достаточным числом сделок этого типа"}</td></tr>`;
    document.getElementById("tbody").querySelectorAll("tr[data-loc]").forEach(tr=>{
      tr.classList.toggle("sel", lvl==="rf" ? false : tr.dataset.loc===state.loc);
      tr.onclick=()=>{
        if(lvl==="rf"){ const r=rows.find(x=>x.loc===tr.dataset.loc); state.rc=r.rc2; state.loc=null; }
        else state.loc = tr.dataset.loc;
        state.street=null; render(); showToast(tr.dataset.loc);
      };
    });
    // разворот улиц района прямо в таблице
    document.getElementById("tbody").querySelectorAll(".st-toggle").forEach(btn=>btn.onclick=(e)=>{
      e.stopPropagation();
      const tr=btn.closest("tr");
      const next=tr.nextElementSibling;
      if(next && next.classList.contains("streets-sub")){ next.remove(); btn.textContent="▸"; return; }
      // закрыть другие
      document.getElementById("tbody").querySelectorAll("tr.streets-sub").forEach(x=>x.remove());
      document.getElementById("tbody").querySelectorAll(".st-toggle").forEach(x=>x.textContent="▸");
      const loc=btn.dataset.st;
      const st=(reg.d[loc].st[state.t]||[]).slice(0,8);
      const maxU=Math.max(...st.map(s=>s[3]),1);
      const sub=document.createElement("tr");
      sub.className="streets-sub";
      sub.innerHTML=`<td colspan="5">${st.map(s=>`
        <div class="strow">
          <span class="sn2">${s[0]}<small> · ${fmt(s[1])} сд.</small></span>
          <span class="sbar"><i style="width:${Math.max(6,Math.round(s[3]/maxU*100))}%"></i></span>
          <span class="sv2">${fmt(s[3])} ${UNIT[state.t]}</span>
        </div>`).join("")}
        <div class="hint" style="margin-top:6px">топ-${st.length} улиц · выберите район, чтобы увидеть все</div></td>`;
      tr.after(sub); btn.textContent="▾";
    });
    const mb=document.getElementById("morebtn");
    mb.style.display = (frows.length>12&&!q)?"block":"none";
    mb.textContent = state.showAll?"Свернуть":"Показать все ("+frows.length+")";
  }
  document.getElementById("tbl-search").addEventListener("input",()=>renderTable());

  /* ---------- search ---------- */
  const searchEl=document.getElementById("search"), suggEl=document.getElementById("sugg");
  let activeIdx=-1, suggItems=[];
  function currentSearchValue(){
    return state.street ? currentStreetLabel()+" ("+(state.lc||state.loc)+")" : state.lc ? state.lc+" ("+state.loc+")" : (state.loc || (state.rc&&DATA.regions[state.rc]?DATA.regions[state.rc].name:"Россия"));
  }
  function openSugg(q){
    const rawQ=q.trim().toLowerCase();
    q=searchKey(q);
    const ft=fTypeEl.value;
    const score=i=>i.nt[ft]||0;
    const curLabel=searchKey(currentSearchValue());
    const browse = !q || q===curLabel; // текст не меняли — показываем следующий уровень иерархии
    let html=""; suggItems=[];
    const hl = (browse||!rawQ) ? (s=>s) : (s=>s.replace(new RegExp("("+rxEsc(rawQ)+")","i"),"<b>$1</b>"));
    const push=(arr,title)=>{
      if(!arr.length) return;
      html+='<div class="grp">'+title+'</div>';
      arr.forEach(it=>{ suggItems.push(it); html+=item(it,suggItems.length-1,hl); });
    };
    if(browse){
      if(!state.rc){
        const regs=Object.entries(DATA.regions).map(([rc2,rg])=>({label:rg.name,kind:"region",rc:rc2,loc:null,nt:ntOf(rg.tot)}))
          .filter(i=>score(i)>0).sort((a,b)=>score(b)-score(a)).slice(0,15);
        push(regs,"Регионы · по числу сделок");
      } else if(!state.loc){
        push([{label:"← Россия · вся страна",rf:true,up:true,nt:{}}],"Уровень выше");
        const locs=index.filter(i=>i.loc&&i.rc===state.rc&&score(i)>0)
          .sort((a,b)=>score(b)-score(a)).slice(0,15);
        push(locs,"Города и районы · "+DATA.regions[state.rc].name+" · по числу сделок");
      } else if(state.lc){
        push([{label:"← "+state.loc+" целиком",rc:state.rc,loc:state.loc,up:true,nt:{}}],"Уровень выше");
        const e=lcEntry();
        const lst=((e&&e.st)||{})[ft]||[];
        const streets=lst.slice(0,20).map(x=>({label:x[0],kind:"street",rc:state.rc,loc:state.loc,lcName:state.lc,street:x[0],region:state.lc,nt:{[ft]:x[1]}}));
        if(streets.length) push(streets,"Улицы · "+state.lc+" · по числу сделок");
        else html+='<div class="grp" style="padding-bottom:14px">Улиц с данными (от 3 сделок) в этом пункте нет</div>';
      } else {
        push([{label:"← "+DATA.regions[state.rc].name,upReg:true,rc:state.rc,up:true,nt:{}}],"Уровень выше");
        if(state.street) push([{label:state.loc+" целиком",rc:state.rc,loc:state.loc,nt:{}}],"Текущий уровень");
        const d=DATA.regions[state.rc].d[state.loc]||{};
        const lcs=Object.entries(d.lc||{}).map(([city,e])=>{
          const nt={}; if(e[ft]) nt[ft]=e[ft].filter(Boolean).reduce((s2,c)=>s2+c[0],0);
          return {label:city,kind:"settlement",rc:state.rc,loc:state.loc,lcName:city,region:DATA.regions[state.rc].name,nt,ntAll:e.n||0};
        }).sort((a,b)=>(score(b)||0)-(score(a)||0) || (b.ntAll||0)-(a.ntAll||0)).slice(0,12);
        if(lcs.length) push(lcs,"Населённые пункты · "+state.loc);
        const st=(d.st||{})[ft]||[];
        const streets=st.slice(0,15).map(x=>({label:x[0],kind:"street",rc:state.rc,loc:state.loc,street:x[0],region:DATA.regions[state.rc].name,nt:{[ft]:x[1]}}));
        if(streets.length) push(streets,"Улицы · "+state.loc+" · по числу сделок");
        else if(!lcs.length) html+='<div class="grp" style="padding-bottom:14px">Улиц с данными (от 3 сделок) здесь нет</div>';
      }
    } else {
      const streetIntent=hasStreetIntent(rawQ);
      const regions=index.filter(i=>!i.loc&&score(i)>0&&locationScore(i,q)>=0);
      const areas=index.filter(i=>i.loc&&score(i)>0&&locationScore(i,q)>=0);
      const lcs=lcIndex.filter(i=>locationScore(i,q)>=0);
      const streets=q.length>=3 ? streetIndex.filter(i=>score(i)>0&&locationScore(i,q)>=0) : [];
      const rank = i => locationScore(i,q)*10000000 + (streetIntent&&i.kind==="street"?1000000:0) + kindRank[i.kind]*100000 + (score(i)||i.nt.all||i.ntAll||0);
      const best=mergeStreetSuggestions([...streets,...lcs,...areas,...regions], ft)
        .sort((a,b)=>rank(b)-rank(a))
        .slice(0,12);
      push(best,"Подходящие локации");
    }
    if(!suggItems.length){
      suggEl.innerHTML='<div class="empty"><b>Локация не найдена</b><span>Попробуйте название без номера дома или выберите более крупный уровень: город, район или округ.</span></div>';
      suggEl.classList.add("open");
      return;
    }
    suggEl.innerHTML=html; suggEl.classList.add("open"); activeIdx=-1;
    suggEl.querySelectorAll(".item").forEach(el=>el.onclick=()=>pick(+el.dataset.i));
  }
  function item(i,k,hl){
    const n=i.nt[fTypeEl.value]||0;
    const label=i.displayLabel || (i.street ? displayStreetName(i.label, i.region, searchEl.value) : i.label);
    const path=i.pathOverride || (i.street?`${i.lcName||i.loc}, ${i.region}`
      : i.lcName?`${i.loc}, ${i.region}`
      : (i.loc&&i.region?i.region:""));
    const right=i.up?"":(n?`<span class="n">${fmt(n)} сд. · ${TYPE_NAMES[fTypeEl.value].toLowerCase()}</span>`
      : (i.nt.all||i.ntAll)?`<span class="n">${fmt(i.nt.all||i.ntAll)} сд. всего</span>`:"");
    const tag=i.up?"":`<span class="tag">${kindLabel[i.kind]||"локация"}</span>`;
    return `<div class="item" data-i="${k}"><span class="main"><span class="nm">${hl(label)} ${tag}</span>${path?`<span class="path">${path}</span>`:""}</span>${right}</div>`;
  }
  function pick(k){
    const it=suggItems[k]; if(!it) return;
    const target=it.best||it;
    if(target.rf){ state.rc=null; state.loc=null; state.lc=null; state.street=null; }
    else if(target.upReg){ state.loc=null; state.lc=null; state.street=null; }
    else { state.rc=target.rc; state.loc=target.loc||null; state.lc=target.lcName||null; state.street=target.street||null; }
    state.showAll=false;
    const shownStreet = it.street ? (it.displayLabel || displayStreetName(it.street, it.region, searchEl.value)) : "";
    searchEl.value = it.street ? shownStreet+" ("+(it.region||it.lcName||it.loc)+")" : it.lcName ? it.lcName+" ("+it.loc+")" : it.label.replace(/^← /,"");
    suggEl.classList.remove("open");
    // если у выбранной локации нет текущего типа — переключить на самый массовый доступный
    if(state.lc){
      const e=lcEntry();
      if(e && !lcPooled(e,state.t)){ for(const t of ["3","2","1","4"]) if(lcPooled(e,t)){ state.t=t; break; } }
    } else if(!hasBase(state.rc,state.loc,state.t)){
      for(const t of ["3","2","1","4"]) if(hasBase(state.rc,state.loc,t)){state.t=t;break;}
    }
    render();
  }
  searchEl.addEventListener("input",e=>openSugg(e.target.value));
  searchEl.addEventListener("focus",e=>{
    if(searchKey(e.target.value)===searchKey(currentSearchValue())) e.target.value="";
    openSugg(e.target.value);
  });
  searchEl.addEventListener("keydown",e=>{
    const items=suggEl.querySelectorAll(".item");
    if(e.key==="ArrowDown"){e.preventDefault();activeIdx=Math.min(activeIdx+1,items.length-1);}
    else if(e.key==="ArrowUp"){e.preventDefault();activeIdx=Math.max(activeIdx-1,0);}
    else if(e.key==="Enter"){e.preventDefault();if(activeIdx>=0)pick(activeIdx);else if(items.length)pick(0);return;}
    else if(e.key==="Escape"){suggEl.classList.remove("open");return;}
    else return;
    items.forEach((el,i)=>el.classList.toggle("active",i===activeIdx));
    if(items[activeIdx]) items[activeIdx].scrollIntoView({block:"nearest"});
  });
  document.addEventListener("click",e=>{ if(!e.target.closest(".searchbox")) suggEl.classList.remove("open"); });

  /* ---------- форма-предложение ---------- */
  const PRESETS = {
    "3":[["Студия",25],["1-комн.",36],["2-комн.",54],["3-комн.",75]],
    "2":[["Дачный · 60 м²",60],["Средний · 120 м²",120],["Большой · 200 м²",200]],
    "1":[["6 соток",6],["8 соток",8],["12 соток",12]],
    /* коммерция: подтип по этажу (задаёт фильтр «Подтип» и типовую площадь) */
    "4":[["Стрит-ритейл",80,null,1],["Офис",50,null,2],["Склад",300,null,4],["Подвал/цоколь",50,null,3]],
    "5":[["Место · 14 м²",14],["Большое · 18 м²",18]],
    "6":[["Кладовка · 4 м²",4],["Кладовка · 6 м²",6]]
  };
  const fModeEl=document.getElementById("f-mode"), fTypeEl=document.getElementById("f-type");

  function buildAskDetails(){
    const m=fModeEl.value, t=fTypeEl.value;
    const d=document.getElementById("ask-details");
    let html="";
    if(m!=="invest"){
      html+=`<div class="p-row">`+PRESETS[t].map(p=>{
        const on = String(p[1])===String(state.inputs.area) && (p[2]==null || state.seg===p[2]) && (p[3]==null || state.ct===p[3]);
        return `<button class="preset ${on?'on':''}" data-a="${p[1]}" ${p[2]!=null?`data-sg="${p[2]}"`:""} ${p[3]!=null?`data-ct="${p[3]}"`:""}>${p[0]}${t==="3"?" · "+p[1]+" м²":""}</button>`;
      }).join("")+`</div>`;
      html+=`<div class="f-row"><label class="fld"><span>Площадь, ${AREA_UNIT[t]}</span><input class="ainp" id="fa" type="number" min="1" placeholder="например, ${DEFAULT_AREAS[t]||54}" value="${state.inputs.area}"></label>`;
      if(m==="buy") html+=`<label class="fld price-lb"><span><span class="full-lb">Цена из объявления, ₽ · не обязательно</span><span class="mob-lb">Цена, ₽ · необяз.</span></span><input class="ainp" id="fp" type="text" inputmode="numeric" placeholder="например, 12 500 000" value="${state.inputs.price?(+state.inputs.price).toLocaleString("ru-RU"):""}"></label>`;
      html+=`</div>`;
      if(t==="3" && m!=="invest"){
        const advRow=adjRowHTML();
        if(advRow) html+=`<details class="adv adj-adv" ${(state.inputs.ay!=="0"||state.inputs.af!=="0"||state.inputs.am!=="0")?"open":""}><summary>Уточнить объект: год дома, этаж, стены — оценка станет точнее</summary>${advRow}</details>`;
      }

      if(t==="4") html+=`<div class="ex-note">Подтип по данным ЕГРН: 1-й этаж — стрит-ритейл · 2+ — офисы · >100 м² — склад</div>`;
    } else {
      html+=`<div class="f-row"><label class="fld"><span>Сумма вложения, ₽</span><input class="ainp" id="fi" type="text" inputmode="numeric" placeholder="8 000 000" value="${state.inputs.invest?(+state.inputs.invest).toLocaleString("ru-RU"):""}"></label></div>`;
    }
    d.innerHTML=html;
    d.querySelectorAll(".preset").forEach(b=>b.onclick=()=>{
      state.inputs.area=b.dataset.a;
      if(b.dataset.sg!==undefined){ state.seg=+b.dataset.sg; state.market=""; state.ct=0; }
      if(b.dataset.ct!==undefined){ state.ct=+b.dataset.ct; state.seg=0; state.market=""; }
      buildAskDetails(); apply(false);
    });
    const fa=d.querySelector("#fa"); if(fa) fa.addEventListener("input",()=>{state.inputs.area=fa.value; rememberTypeInputs(); refreshSide(); persistState();});
    const fp=d.querySelector("#fp"); if(fp) fp.addEventListener("input",()=>{const raw=fp.value.replace(/[^\d]/g,""); state.inputs.price=raw; fp.value=raw?(+raw).toLocaleString("ru-RU"):""; rememberTypeInputs(); refreshSide(); persistState();});
    const fi=d.querySelector("#fi"); if(fi) fi.addEventListener("input",()=>{const raw=fi.value.replace(/[^\d]/g,""); state.inputs.invest=raw; fi.value=raw?(+raw).toLocaleString("ru-RU"):""; rememberTypeInputs(); refreshSide(); persistState();});
    [["adj-y","ay"],["adj-f","af"],["adj-m","am"]].forEach(([id,key])=>{
      const s=d.querySelector("#"+id);
      if(s) s.addEventListener("change",()=>{ state.inputs[key]=s.value; rememberTypeInputs(); refreshSide(); persistState(); });
    });

  }

  let syncing=false;
  let clearSearchOnNextSync=false;
  function syncForm(){
    syncing=true;
    fModeEl.value=state.mode; fTypeEl.value=state.t;
    const reg=DATA.regions[state.rc];
    if(document.activeElement!==searchEl) {
      searchEl.value = clearSearchOnNextSync ? "" : currentSearchValue();
      clearSearchOnNextSync=false;
    }
    buildAskDetails();
    document.querySelectorAll("#mtbar .mt").forEach(b=>b.classList.toggle("on",b.dataset.mt===state.metric));
    buildExamples();
    const ctaEl=document.getElementById("cta");
    if(ctaEl){
      const nm = currentStreetLabel() || state.lc || state.loc || (state.rc && DATA.regions[state.rc] ? DATA.regions[state.rc].name : null);
      ctaEl.textContent = nm ? "Показать, за сколько покупают · "+nm : "Показать, за сколько здесь покупают";
    }
    syncing=false;
  }

  function apply(scroll){
    const nextType=fTypeEl.value;
    state.mode=fModeEl.value;
    if(state.t!==nextType){
      rememberTypeInputs(state.t);
      if(state.street){
        state.loc=null;
        state.lc=null;
        state.street=null;
        clearSearchOnNextSync=true;
      } else {
        state.street=null;
      }
      useTypeInputs(nextType);
      state.seg=0; state.market=""; state.ct=0;
    }
    state.t=nextType; state.showAll=false;
    if(state.lc && !lcPooled(lcEntry(),state.t)) { state.lc=null; state.street=null; }
    if(state.street){
      let ok=false;
      if(state.lc){ const e=lcEntry(); const l=e&&e.st&&e.st[state.t]; ok=!!(l&&l.some(x=>x[0]===state.street)); }
      if(!ok){ const st=(((DATA.regions[state.rc]||{}).d||{})[state.loc]||{}).st; ok=!!(st&&st[state.t]&&st[state.t].some(x=>x[0]===state.street)); if(ok) state.lc=null; }
      if(!ok) state.street=null;
    }
    if(!hasBase(state.rc,state.loc,state.t)){
      for(const t of ["3","2","1","4"]) if(hasBase(state.rc,state.loc,t)){state.t=t;break;}
    }
    render();
    if(scroll) document.querySelector(".locbar").scrollIntoView({behavior:"smooth",block:"start"});
  }
  fModeEl.addEventListener("change",()=>{ if(!syncing) apply(false); });
  fTypeEl.addEventListener("change",()=>{ if(!syncing) apply(false); });
  document.getElementById("cta").onclick=()=>{apply(false); const r=document.getElementById("ask-result"); if(r) r.scrollIntoView({behavior:"smooth",block:"center"});};
  document.querySelectorAll("#mtbar .mt").forEach(b=>b.addEventListener("click",()=>{ state.metric=b.dataset.mt; document.querySelectorAll("#mtbar .mt").forEach(x=>x.classList.toggle("on",x.dataset.mt===state.metric)); refreshSide(); persistState(); }));

  /* примеры-кейсы: короткие, подстраиваются под выбранные фильтры */
  function buildExamples(){
    const m=fModeEl.value, t=fTypeEl.value;
    const mk=(lb,rc,loc,inp)=>({lb,rc,loc,inp:inp||{}});
    let list;
    if(m==="invest"){
      list=[mk("10 млн · Казань","16","Казань",{invest:"10000000"}),
            mk("5 млн · Сочи","23","Сочи",{invest:"5000000"}),
            mk("15 млн · Москва","77",null,{invest:"15000000"}),
            mk("7 млн · Мытищи","50","Мытищи",{invest:"7000000"})];
    } else if(t==="3"){
      list=[mk("54 м² · Мытищи · 11,4 млн","50","Мытищи",{area:"54",price:"11400000"}),
            mk("Студия · СПб","78",null,{area:"25"}),
            mk("1-комн. · Казань","16","Казань",{area:"36"}),
            mk("3-комн. · Москва","77",null,{area:"75"}),
            mk("2-комн. · Сочи","23","Сочи",{area:"54"})];
    } else if(t==="2"){
      list=[mk("120 м² · Истра","50","Истра",{area:"120"}),
            mk("Дача 60 м² · Дмитровский","50","Дмитровский",{area:"60"}),
            mk("200 м² · Сочи","23","Сочи",{area:"200"}),
            mk("Дом · Раменский","50","Раменский",{area:"120"})];
    } else if(t==="1"){
      list=[mk("8 сот. · Дмитровский","50","Дмитровский",{area:"8"}),
            mk("12 сот. · Раменский","50","Раменский",{area:"12"}),
            mk("6 сот. · Истра","50","Истра",{area:"6"}),
            mk("10 сот. · Казань","16","Казань",{area:"10"})];
    } else if(t==="5"){
      list=[mk("Машино-место · Мытищи","50","Мытищи",{area:"14"}),
            mk("Машино-место · Москва","77",null,{area:"14"}),
            mk("Машино-место · Казань","16","Казань",{area:"14"}),
            mk("Машино-место · СПб","78",null,{area:"14"})];
    } else if(t==="6"){
      list=[mk("Кладовка · Мытищи","50","Мытищи",{area:"4"}),
            mk("Кладовка · Москва","77",null,{area:"4"}),
            mk("Кладовка · СПб","78",null,{area:"5"})];
    } else {
      list=[mk("Офис 50 м² · Мытищи","50","Мытищи",{area:"50"}),
            mk("Ритейл 80 м² · Казань","16","Казань",{area:"80"}),
            mk("Склад 400 м² · Москва","77",null,{area:"400"}),
            mk("Кладовка · СПб","78",null,{area:"5"})];
    }
    // не показываем кейсы без данных
    list=list.filter(e=>{
      const src=e.loc?(DATA.regions[e.rc]||{d:{}}).d[e.loc]:(DATA.regions[e.rc]||{}).tot;
      return src && src[keyOf(t)];
    });
    document.getElementById("examples").innerHTML =
      list.map((e,i)=>`<button class="ex" data-i="${i}">${e.lb}</button>`).join(" ");
    document.querySelectorAll(".ex").forEach(el=>el.onclick=()=>{
      const e=list[+el.dataset.i];
      state.mode=m; state.t=t; state.rc=e.rc; state.loc=e.loc; state.showAll=false;
      state.inputs={area:"",price:"",invest:"",ay:"0",af:"0",am:"0",...e.inp};
      if(!hasBase(state.rc,state.loc,state.t)){
        for(const tt of ["3","2","1","4"]) if(hasBase(state.rc,state.loc,tt)){state.t=tt;break;}
      }
      render();
    });
  }
  document.getElementById("morebtn").onclick=()=>{ state.showAll=!state.showAll; renderTable(); };
  document.querySelectorAll(".sg[data-s]").forEach(b=>b.onclick=()=>{ state.seg=+b.dataset.s; if(state.seg) state.market=""; render(); });
  document.querySelectorAll(".mk").forEach(b=>b.onclick=()=>{ state.market=b.dataset.m; if(state.market){state.seg=0; state.ct=0;} render(); });
  document.querySelectorAll(".geo").forEach(b=>b.onclick=()=>{
    document.querySelectorAll(".geo").forEach(x=>x.classList.toggle("on",x===b));
    document.getElementById("geo-map").style.display = b.dataset.g==="map" ? "" : "none";
    document.getElementById("geo-list").style.display = b.dataset.g==="list" ? "" : "none";
  });
  document.querySelectorAll(".ctb").forEach(b=>b.onclick=()=>{ state.ct=+b.dataset.c; if(state.ct){state.seg=0; state.market="";} render(); });

  /* ---------- инструменты риэлтора: сводка и справка ---------- */
  function summaryText(){
    const reg = state.rc ? DATA.regions[state.rc] : {name:"Россия"};
    const arr = segArr(series(state.rc, state.loc, state.t));
    if(!arr||!arr.some(Boolean)) return "Недостаточно данных";
    const l=lastCell(arr), f=firstCell(arr);
    const n=totalDeals(arr);
    const chg=(f&&l.qi!==f.qi)?l.c[2]/f.c[2]-1:null;
    const lines=[
      "SEVIO · аналитика недвижимости по реальным данным (ЕГРН/Росреестр) · sevio.ru",
      (state.loc?state.loc+" · ":"")+reg.name+" · "+TYPE_NAMES[state.t]+(state.seg?" · сегмент "+SEG_NAMES[state.seg]:""),
      "",
      "Медиана реальных сделок ("+Q[l.qi]+"): "+fmt(l.c[2])+" "+UNIT[state.t],
      "Медианная цена объекта: "+fmtMoney(l.c[1]),
      chg!=null?"Динамика цены: "+pct(chg)+" за "+(l.qi-f.qi)+" кв.":"",
      "Активность: "+fmt(n)+" сделок за 9 мес (≈"+Math.round(n/9)+"/мес)",
      "",
      "Половина сделок прошла дешевле медианы, половина — дороже.",
      "Источник: открытые данные Росреестра, июль 2025 — март 2026"
    ];
    return lines.filter(s=>s!=="" || true).join("\n");
  }
  document.getElementById("btn-copy").onclick=async function(){
    const btn=this;
    try{ await navigator.clipboard.writeText(summaryText()); }
    catch(e){
      const ta=document.createElement("textarea"); ta.value=summaryText();
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    btn.classList.add("done"); btn.querySelector("span").textContent="Скопировано ✓";
    setTimeout(()=>{btn.classList.remove("done"); btn.querySelector("span").textContent="Скопировать сводку";},1800);
  };
  document.getElementById("btn-print").onclick=()=>window.print();

  /* тост при выборе локации из таблицы/карты: без принудительного скролла */
  let toastTimer=null;
  function showToast(loc){
    const el=document.getElementById("toast");
    document.getElementById("toast-msg").innerHTML="Выбрано: <b>"+loc+"</b> — все данные обновлены";
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>el.classList.remove("show"),4500);
  }
  document.getElementById("toast-go").onclick=()=>{
    document.getElementById("toast").classList.remove("show");
    document.querySelector(".locbar").scrollIntoView({behavior:"smooth",block:"start"});
  };

  /* ---------- демо-ролик: живой прогон сценария ---------- */
  const demo={running:false,abort:false,saved:null};
  const dCur=document.getElementById("demo-cursor"), dOv=document.getElementById("demo-ov"), dCap=document.getElementById("demo-cap");

  function dSleepRaw(ms){return new Promise(r=>setTimeout(r,ms));}
  async function dSleep(ms){
    for(let t=0;t<ms;t+=90){ if(demo.abort) throw new Error("skip"); await dSleepRaw(Math.min(90,ms-t)); }
  }
  const DEMO_TOTAL=9;
  function dProgress(){
    demo.step=(demo.step||0)+1;
    document.getElementById("demo-step").textContent=Math.min(demo.step,DEMO_TOTAL)+" / "+DEMO_TOTAL;
    document.getElementById("demo-prog").style.width=Math.min(100,demo.step/DEMO_TOTAL*100)+"%";
  }
  function capHTML(t){ return t.replace(/\[\[(.+?)\]\]/g,'<b class="hl">$1</b>'); }
  async function dCaption(txt,ms){
    // перезапуск анимации титра
    dCap.style.animation="none"; void dCap.offsetWidth; dCap.style.animation="";
    dCap.innerHTML=capHTML(txt); dProgress();
    if(ms) await dSleep(ms);
  }
  async function dMove(el){
    el.scrollIntoView({behavior:"smooth",block:"center"}); await dSleep(500);
    const r=el.getBoundingClientRect();
    dCur.style.left=(r.left+Math.min(r.width/2,140)-11)+"px";
    dCur.style.top=(r.top+r.height/2-11)+"px";
    await dSleep(680);
  }
  function dClick(){ dCur.classList.remove("pulse"); void dCur.offsetWidth; dCur.classList.add("pulse"); }
  async function dType(el,txt){
    el.focus();
    for(const ch of txt){ el.value+=ch; el.dispatchEvent(new Event("input",{bubbles:true})); await dSleep(90); }
  }

  async function runDemo(){
    if(demo.running) return;
    demo.running=true; demo.abort=false; demo.step=0;
    demo.saved={rc:state.rc,loc:state.loc,t:state.t,mode:state.mode,horizon:state.horizon,inputs:{...state.inputs}};
    document.getElementById("demo-prog").style.width="0";
    document.getElementById("demo-step").textContent="";
    dOv.classList.add("on"); dCur.classList.add("show");
    try{
      // 0. чистый лист
      state.mode="buy"; state.t="3"; state.rc="50"; state.loc=null;
      state.inputs={area:"",price:"",invest:""}; render();
      window.scrollTo({top:0,behavior:"smooth"});
      await dCaption("Вы смотрите двушку в Мытищах за [[11,4 млн]]. Дорого или нет?",2400);

      // 1. локация
      await dCaption("Опишите ситуацию одной фразой…",0);
      searchEl.value="";
      await dMove(searchEl); dClick();
      await dType(searchEl,"Мытищи"); await dSleep(700);
      const idx=suggItems.findIndex(i=>i.loc==="Мытищи"&&i.rc==="50");
      if(idx>=0) pick(idx);
      await dSleep(600);

      // 2. площадь-пресет
      const p2=[...document.querySelectorAll(".preset")].find(b=>b.textContent.includes("2-комн"));
      if(p2){ await dCaption("Площадь — одним тапом",0); await dMove(p2); dClick(); p2.click(); await dSleep(500); }

      // 3. цена из объявления
      const fp=document.getElementById("fp");
      if(fp){ await dCaption("Цена из объявления",0); await dMove(fp); dClick(); fp.value=""; await dType(fp,"11400000"); await dSleep(400); }

      // 4. кнопка
      const cta=document.getElementById("cta");
      await dCaption("Сверяем с реальными сделками Росреестра…",0);
      await dMove(cta); dClick(); cta.click();
      await dSleep(1300);

      // 5. вердикт
      const v=document.querySelector("#side-res .verdict");
      if(v){ v.scrollIntoView({behavior:"smooth",block:"center"}); v.classList.add("demo-hl"); }
      await dCaption("Выше рынка на 11% — [[переплата ≈ 1,15 млн ₽]]. Готовый аргумент для торга",5500);
      if(v) v.classList.remove("demo-hl");

      // 6. график с прогнозом
      const ch=document.getElementById("chart");
      ch.scrollIntoView({behavior:"smooth",block:"center"}); ch.classList.add("demo-hl");
      await dCaption("Динамика реальных цен и [[прогноз на квартал вперёд]]",4500);
      ch.classList.remove("demo-hl");

      // 7. инвест-тизер
      fModeEl.value="invest"; apply(false); await dSleep(400);
      const sp=document.getElementById("side-panel");
      sp.scrollIntoView({behavior:"smooth",block:"center"}); sp.classList.add("demo-hl");
      await dCaption("Инвестору — сценарии дохода на [[3, 5, 7 и 10 лет]]",4800);
      sp.classList.remove("demo-hl");

      await dCaption("Sevio: [[знай реальную цену]]. Попробуйте сами ↓",4800);
    }catch(e){ /* пропуск */ }
    // восстановление
    Object.assign(state,{rc:demo.saved.rc,loc:demo.saved.loc,t:demo.saved.t,mode:demo.saved.mode,horizon:demo.saved.horizon});
    state.inputs={...demo.saved.inputs}; render();
    dCap.textContent=""; dOv.classList.remove("on"); dCur.classList.remove("show","pulse");
    demo.running=false;
    window.scrollTo({top:0,behavior:"smooth"});
  }
  document.getElementById("demo-btn").onclick=()=>runDemo();
  document.getElementById("demo-skip").onclick=()=>{demo.abort=true;};

  /* ---------- промо-ролик: история Ани ---------- */
  /* кисть руки: ладонь + большой палец (flat) */
  function handSVG(x,y,rot,skin){
    return `<g transform="translate(${x} ${y}) rotate(${rot})">
      <ellipse rx="6.6" ry="8.2" fill="${skin}"/>
      <ellipse cx="-6" cy="-3" rx="3.1" ry="5" fill="${skin}"/>
    </g>`;
  }
  /* большой палец поверх телефона (рисуется после корпуса телефона) */
  function thumbSVG(x,y,rot,skin){
    return `<ellipse cx="${x}" cy="${y}" rx="3.4" ry="6" fill="${skin}" transform="rotate(${rot} ${x} ${y})"/>`;
  }

  /* персонаж (flat-иллюстрация): pose = think | show | happy */
  function anyaSVG(pose,h){
    h=h||"clamp(140px,17vw,225px)";
    const smile = pose==="happy"
      ? '<path d="M92 69 q8 8 16 0" stroke="#c2185b" stroke-width="3" fill="none" stroke-linecap="round"/>'
      : '<path d="M93 70 q7 5 14 0" stroke="#c2185b" stroke-width="3" fill="none" stroke-linecap="round"/>';
    const brows = pose==="think"
      ? '<path d="M83 45 q6 -4 12 -1 M105 44 q6 -3 12 1" stroke="#8a3d12" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
      : '<path d="M83 46 q6 -3 12 0 M105 46 q6 -3 12 0" stroke="#8a3d12" stroke-width="2.4" fill="none" stroke-linecap="round"/>';
    const SK="#f7c6a3";
    const arms = pose==="happy"
      ? '<path d="M74 128 L42 88" stroke="#f2b48c" stroke-width="12" stroke-linecap="round"/>'+handSVG(38,82,-40,SK)
       +'<path d="M126 128 L158 88" stroke="#f2b48c" stroke-width="12" stroke-linecap="round"/>'+handSVG(162,82,40,SK)
      : pose==="show"
      ? '<path d="M74 132 C60 140 56 152 58 160" stroke="#f2b48c" stroke-width="12" stroke-linecap="round" fill="none"/>'+handSVG(58,166,170,SK)
       +'<path d="M126 132 L166 118" stroke="#f2b48c" stroke-width="12" stroke-linecap="round"/>'+handSVG(168,124,15,SK)
       +'<rect x="158" y="86" width="30" height="52" rx="7" fill="#141c36" stroke="#22d3ee" stroke-width="2"/><rect x="163" y="94" width="20" height="8" rx="2" fill="#7c5cff"/><rect x="163" y="106" width="20" height="5" rx="2" fill="#3a4568"/><rect x="163" y="115" width="20" height="5" rx="2" fill="#3a4568"/>'
       +thumbSVG(161,125,20,SK)
      : '<path d="M74 132 C60 138 56 150 58 158" stroke="#f2b48c" stroke-width="12" stroke-linecap="round" fill="none"/>'+handSVG(58,164,170,SK)
       +'<path d="M126 132 C146 126 148 108 142 96" stroke="#f2b48c" stroke-width="12" stroke-linecap="round" fill="none"/>'+handSVG(140,102,-15,SK)
       +'<rect x="128" y="66" width="29" height="50" rx="7" transform="rotate(14 142 91)" fill="#141c36" stroke="#22d3ee" stroke-width="2"/>'
       +thumbSVG(131,104,-10,SK);
    return `<svg viewBox="0 0 200 340" style="height:${h}" class="anya">
      <ellipse cx="100" cy="330" rx="60" ry="8" fill="rgba(0,0,0,.35)"/>
      <path d="M64 52 C64 14 136 14 136 52 L141 150 C141 166 119 168 117 150 L115 92 L85 92 L83 150 C81 168 59 166 59 150 Z" fill="#c05a1e"/>
      <path d="M64 52 C64 14 136 14 136 52 L138 96 L127 96 L124 60 L76 60 L73 96 L62 96 Z" fill="#d1692a"/>
      <rect x="86" y="230" width="9" height="92" rx="4.5" fill="#f2b48c"/>
      <rect x="105" y="230" width="9" height="92" rx="4.5" fill="#f2b48c"/>
      <path d="M82 318 h17 v8 h-22 c-2 0 -2 -6 5 -8 Z" fill="#7c2d5e"/>
      <path d="M101 318 h17 v8 h-22 c-2 0 -2 -6 5 -8 Z" fill="#7c2d5e"/>
      <path d="M82 100 h36 l4 34 h-44 Z" fill="#8b5cf6"/>
      <path d="M78 134 h44 l12 92 c-24 12 -44 12 -68 0 Z" fill="#7c5cff"/>
      <rect x="78" y="130" width="44" height="8" rx="4" fill="#5b3fd6"/>
      ${arms}
      <rect x="94" y="82" width="12" height="14" rx="5" fill="#f2b48c"/>
      <circle cx="100" cy="56" r="29" fill="#f7c6a3"/>
      <path d="M71 52 C71 24 129 24 129 52 C124 36 116 32 100 32 C84 32 76 36 71 52 Z" fill="#d1692a"/>
      <path d="M71 52 C74 44 78 40 84 37 L80 58 C76 60 72 58 71 52 Z" fill="#c05a1e"/>
      <path d="M129 52 C126 44 122 40 116 37 L120 58 C124 60 128 58 129 52 Z" fill="#c05a1e"/>
      <circle cx="72" cy="66" r="3" fill="#fbbf24"/><circle cx="128" cy="66" r="3" fill="#fbbf24"/>
      <circle cx="89" cy="55" r="3.2" fill="#33210f"/><circle cx="111" cy="55" r="3.2" fill="#33210f"/>
      <path d="M84 51 l-4 -2 M86 49.5 l-3 -3 M116 51 l4 -2 M114 49.5 l3 -3" stroke="#33210f" stroke-width="1.6" stroke-linecap="round"/>
      ${brows}
      <path d="M97 60 q3 3 6 0" stroke="#e39b72" stroke-width="2" fill="none" stroke-linecap="round"/>
      ${smile}
      <circle cx="83" cy="63" r="4" fill="#f5a9a0" opacity=".55"/><circle cx="117" cy="63" r="4" fill="#f5a9a0" opacity=".55"/>
    </svg>`;
  }

  /* мужской персонаж (продавец Сергей): pose = think | show | happy */
  function sergeySVG(pose,h){
    h=h||"clamp(140px,17vw,225px)";
    const mouth = pose==="happy"
      ? '<path d="M91 72 q9 8 18 0" stroke="#b06a4a" stroke-width="3" fill="none" stroke-linecap="round"/>'
      : pose==="show"
      ? '<path d="M92 73 q8 6 16 0" stroke="#b06a4a" stroke-width="3" fill="none" stroke-linecap="round"/>'
      : '<path d="M93 74 h14" stroke="#b06a4a" stroke-width="3" stroke-linecap="round"/>';
    const brows = pose==="think"
      ? '<path d="M82 45 l13 -3 M105 42 l13 3" stroke="#5a3417" stroke-width="3.6" stroke-linecap="round"/>'
      : '<path d="M83 44 h12 M105 44 h12" stroke="#5a3417" stroke-width="3.6" stroke-linecap="round"/>';
    const SK="#f0b98d";
    const arms = pose==="happy"
      ? '<path d="M64 128 L34 86" stroke="#0d9488" stroke-width="15" stroke-linecap="round"/>'+handSVG(30,80,-40,SK)
       +'<path d="M136 128 L166 86" stroke="#0d9488" stroke-width="15" stroke-linecap="round"/>'+handSVG(170,80,40,SK)
      : pose==="show"
      ? '<path d="M64 134 C52 142 48 154 50 162" stroke="#0d9488" stroke-width="15" stroke-linecap="round" fill="none"/>'+handSVG(50,169,170,SK)
       +'<path d="M136 134 L172 120" stroke="#0d9488" stroke-width="15" stroke-linecap="round"/>'+handSVG(174,126,15,SK)
       +'<rect x="164" y="86" width="30" height="52" rx="7" fill="#141c36" stroke="#4ade80" stroke-width="2"/><rect x="169" y="94" width="20" height="8" rx="2" fill="#059669"/><rect x="169" y="106" width="20" height="5" rx="2" fill="#3a4568"/><rect x="169" y="115" width="20" height="5" rx="2" fill="#3a4568"/>'
       +thumbSVG(167,127,20,SK)
      : '<path d="M64 134 C52 140 48 152 50 160" stroke="#0d9488" stroke-width="15" stroke-linecap="round" fill="none"/>'+handSVG(50,167,170,SK)
       +'<path d="M136 134 C154 128 156 110 150 98" stroke="#0d9488" stroke-width="15" stroke-linecap="round" fill="none"/>'+handSVG(148,104,-15,SK)
       +'<rect x="136" y="66" width="29" height="50" rx="7" transform="rotate(14 150 91)" fill="#141c36" stroke="#4ade80" stroke-width="2"/>'
       +thumbSVG(139,106,-10,SK);
    return `<svg viewBox="0 0 200 340" style="height:${h}" class="anya">
      <ellipse cx="100" cy="330" rx="64" ry="8" fill="rgba(0,0,0,.35)"/>
      <rect x="76" y="212" width="20" height="106" rx="8" fill="#44548a"/>
      <rect x="104" y="212" width="20" height="106" rx="8" fill="#394874"/>
      <path d="M72 316 h24 v10 h-30 c-3 0 -2 -8 6 -10 Z" fill="#7a5533"/>
      <path d="M100 316 h24 v10 h-30 c-3 0 -2 -8 6 -10 Z" fill="#7a5533"/>
      <path d="M58 132 C58 116 72 108 84 108 h32 c12 0 26 8 26 24 l-6 84 h-72 Z" fill="#0d9488"/>
      <path d="M58 132 C58 116 72 108 84 108 h6 l-4 108 h-22 Z" fill="#0ea89a"/>
      <path d="M84 108 l16 16 -18 8 -8 -16 Z" fill="#e6f4f2"/>
      <path d="M116 108 l-16 16 18 8 8 -16 Z" fill="#e6f4f2"/>
      <path d="M96 124 h8 l-4 10 Z" fill="#f0b98d"/>
      ${arms}
      <rect x="92" y="84" width="16" height="18" rx="6" fill="#eeb184"/>
      <circle cx="70" cy="58" r="6" fill="#f0b98d"/><circle cx="130" cy="58" r="6" fill="#f0b98d"/>
      <circle cx="100" cy="56" r="30" fill="#f0b98d"/>
      <path d="M70 54 C70 28 96 20 112 26 C126 30 132 40 131 52 L128 50 C127 40 121 33 111 31 C108 34 104 36 99 36 C88 37 76 42 73 56 Z" fill="#8a5a2e"/>
      <path d="M111 31 C117 25 126 26 130 32 C126 29 119 29 115 34 Z" fill="#9c6a38"/>
      <path d="M70 54 C70 44 73 38 78 34 L76 58 C73 59 70 57 70 54 Z" fill="#8a5a2e"/>
      <path d="M131 52 C131 44 129 38 125 34 L127 58 C130 58 131 55 131 52 Z" fill="#8a5a2e"/>
      <circle cx="88" cy="53" r="3.4" fill="#241708"/><circle cx="112" cy="53" r="3.4" fill="#241708"/>
      ${brows}
      <path d="M98 57 q2 5 4 7 l-4 1" stroke="#d69a6e" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      ${mouth}
      <path d="M93 84 q7 4 14 0" stroke="#e0a173" stroke-width="2" fill="none" stroke-linecap="round"/>
    </svg>`;
  }

  /* История Сергея — продавца.
     Расчёт (реальные данные, Мытищи, 2-комн. 54 м²):
     реальная цена сделок ≈ 10,25 млн (189 900 ₽/м² × 54);
     продажа сейчас за 10,4 млн → вклад 15% годовых → +1,56 млн за год → ≈ 11,9 млн;
     ожидание года на цене 11,4 млн: −0,2 млн содержание → максимум 11,2 млн, и то если купят.
     Итог: продать по реальной цене выгоднее на ≈ 700 тыс. ₽. */
  const SERGEY_SCENES=[
   {d:6500, cap:"Сергей продаёт двушку 54 м² за [[11,4 млн]]. Четыре месяца — [[ноль звонков]]", html:`
     <div class="scene">
       ${sergeySVG("think")}
       <div>
         <div class="bubble">Сосед продал за 11 —<br>я подороже выставлю!</div>
         <div class="listing" style="margin-top:16px;animation-delay:.2s">Моё объявление · 11 400 000 ₽<small>4 месяца · 2 звонка · 0 просмотров на неделе</small></div>
       </div>
     </div>`},
   {d:7000, cap:"Покупатели рядом — но покупают [[по другой цене]]", html:`
     <div class="scene">
       <div class="listing" style="animation-delay:.2s;max-width:420px">Такая же двушка этажом ниже<small>ПРОДАНА за <b style="color:var(--green)">10 250 000 ₽</b></small><span class="tagx" style="color:var(--green);border-color:rgba(74,222,128,.4)">реальная сделка · Росреестр</span></div>
     </div>`},
   {d:7000, cap:"Sevio: спрос живёт на [[10,2–10,4 млн]] — 260 сделок в месяц", html:`
     <div class="scene">
       ${sergeySVG("show")}
       <div class="phone-ui">
         <div class="ph-logo"><svg class="ic" style="width:15px;height:15px"><use href="#i-logo"/></svg>Sevio</div>
         <div class="pr">Продаю · Мытищи · 54 м²</div>
         <div class="pr">Реальная цена: ≈ 10 250 000 ₽</div>
         <div class="pr">Покупают: ≈ 260 квартир/мес</div>
         <div class="pb">Стартовая цена: 10,4–10,7 млн</div>
       </div>
     </div>`},
   {d:8500, cap:"Каждый год ожидания «своей цены» [[стоит живых денег]]", sfx:"drop", html:`
     <div class="scene">
       <div class="vcard" style="border-color:rgba(248,113,113,.5);background:linear-gradient(135deg,rgba(248,113,113,.12),rgba(251,191,36,.08))">
         <div class="v1" style="color:var(--red)">Что теряет Сергей за год ожидания</div>
         <div class="crow"><span>Деньги заперты в квартире, а не на вкладе под 12%</span><b style="color:var(--red)">−1 250 000 ₽</b></div>
         <div class="crow"><span>Коммуналка, налог, присмотр за пустой квартирой</span><b style="color:var(--red)">−200 000 ₽</b></div>
         <div class="crow csum"><span>Год ожидания «своей цены» стоит</span><b style="color:var(--red)">−1 450 000 ₽</b></div>
         <div class="v3" style="margin-top:10px">…и покупателя на 11,4 млн может так и не быть</div>
       </div>
     </div>`},
   {d:10000, cap:"", sfx:"tada", html:`
     <div class="scene" style="gap:6%">
       ${sergeySVG("happy")}
       <div class="endcard">
         <div class="e1">Продал за 3 недели — и деньги заработали сами</div>
         <div class="vcard" style="margin:12px auto 0;width:min(100%,480px);border-color:rgba(74,222,128,.45);background:linear-gradient(135deg,rgba(74,222,128,.1),rgba(34,211,238,.07))">
           <div class="crow"><span>Продал по реальной цене</span><b>10 400 000 ₽</b></div>
           <div class="crow"><span>+ год на вкладе под 12%</span><b style="color:var(--green)">+1 250 000 ₽</b></div>
           <div class="crow csum"><span>Через год у Сергея</span><b style="color:var(--green)">≈ 11 650 000 ₽</b></div>
           <div class="crow"><span><small>Если бы ждал «свои 11,4»: максимум</small></span><b style="color:var(--muted);font-size:clamp(14px,1.7vw,18px)">11 200 000 ₽</b></div>
         </div>
         <div class="e2"><b style="color:var(--text)">Реальная цена принесла ≈ +450 000 ₽</b> — и деньги весь год были в руках</div>
         <button class="ebtn promo-cta"><svg class="ic"><use href="#i-sell"/></svg>Оценить свою квартиру</button>
       </div>
     </div>`}
  ];

  const PROMO_SCENES=[
   {d:6500, cap:"Аня нашла двушку 54 м² в Мытищах за [[11,4 млн]]. Дорого или честно?", html:`
     <div class="scene">
       ${anyaSVG("think")}
       <div>
         <div class="bubble">Ипотека на 25 лет…<br>А вдруг я переплачиваю?</div>
         <div class="listing" style="margin-top:16px;animation-delay:.2s">2-комн. · 54 м² · Мытищи<small>11 400 000 ₽ · 15 фото</small></div>
       </div>
     </div>`},
   {d:7000, cap:"Цена в объявлении — желание продавца. [[Сделка — факт]]", html:`
     <div class="scene" style="flex-direction:column;gap:14px">
       <div class="listing" style="animation-delay:.2s;max-width:420px">Такая же квартира · в объявлении 11 400 000 ₽<small>реально ПРОДАНА за <b style="color:var(--green)">10 250 000 ₽</b> — на 10% дешевле</small><span class="tagx" style="color:var(--green);border-color:rgba(74,222,128,.4)">реальная сделка · Росреестр</span></div>
       <div class="hint" style="animation:bpop .5s both;animation-delay:1s">цены продаж видны только в данных Росреестра — Sevio их показывает</div>
     </div>`},
   {d:7000, cap:"Sevio сверяет цену с [[2 миллионами реальных сделок]] — за минуту", html:`
     <div class="scene">
       ${anyaSVG("show")}
       <div class="phone-ui">
         <div class="ph-logo"><svg class="ic" style="width:15px;height:15px"><use href="#i-logo"/></svg>Sevio</div>
         <div class="pr">Хочу купить · Мытищи · 54 м²</div>
         <div class="pr">Цена продавца: 11 400 000 ₽</div>
         <div class="pb">Показать, за сколько тут покупают</div>
       </div>
     </div>`},
   {d:8500, cap:"Вердикт: [[выше рынка на 11%]]", sfx:"cash", html:`
     <div class="scene">
       <div class="vcard">
         <div class="v1">Переплата ≈ 1 150 000 ₽</div>
         <div class="v2">Половина таких квартир куплена дешевле 10,25 млн</div>
         <div class="v3">в ипотеке на 25 лет эта переплата вырастет с процентами до ≈ 2,3 млн ₽</div>
       </div>
     </div>`},
   {d:10000, cap:"", sfx:"tada", html:`
     <div class="scene" style="gap:6%">
       ${anyaSVG("happy")}
       <div class="endcard">
         <div class="e1">Аня показала данные продавцу —<br>и сторговалась до 10,3 млн</div>
         <div class="e2">Проверка заняла минуту и сберегла 1,1 млн ₽.<br><b style="color:var(--text)">Sevio. Знай реальную цену</b> · бесплатно, на данных Росреестра · sevio.ru</div>
         <button class="ebtn promo-cta"><svg class="ic"><use href="#i-buy"/></svg>А вы не переплачиваете? Проверить</button>
       </div>
     </div>`}
  ];

  const promo={playing:false,abort:false};
  const pStage=document.getElementById("promo-stage"), pCap=document.getElementById("promo-cap"),
        pFill=document.getElementById("promo-fill"), pPoster=document.getElementById("promo-poster"),
        pStop=document.getElementById("promo-stop");

  /* ---------- звук: музыка + озвучка + эффекты (WebAudio, без файлов) ---------- */
  const snd={on:false,ctx:null,master:null,musicTimer:null,bar:0};
  function sndReady(){
    if(!(window.AudioContext||window.webkitAudioContext)) return false;
    if(!snd.ctx){
      snd.ctx=new (window.AudioContext||window.webkitAudioContext)();
      snd.master=snd.ctx.createGain(); snd.master.gain.value=0.7;
      snd.master.connect(snd.ctx.destination);
    }
    if(snd.ctx.state==="suspended") snd.ctx.resume();
    return true;
  }
  function tone(freq,t0,dur,type,vol){
    const o=snd.ctx.createOscillator(), g=snd.ctx.createGain();
    o.type=type||"triangle"; o.frequency.value=freq;
    g.gain.setValueAtTime(0,t0);
    g.gain.linearRampToValueAtTime(vol,t0+0.025);
    g.gain.exponentialRampToValueAtTime(0.001,t0+dur);
    o.connect(g); g.connect(snd.master);
    o.start(t0); o.stop(t0+dur+0.05);
  }
  /* лёгкий лаундж-луп: Am → F → C → G, пад + перебор */
  function musicStart(){
    if(!snd.on||!sndReady()||snd.musicTimer) return;
    const chords=[[220,261.63,329.63],[174.61,220,261.63],[196,261.63,329.63],[196,246.94,293.66]];
    const bar=()=>{
      const t=snd.ctx.currentTime+0.06, ch=chords[snd.bar%4];
      ch.forEach(f=>tone(f/2,t,1.9,"sine",0.05));            // пад
      tone(ch[0]/4,t,0.5,"sine",0.10);                        // бас
      tone(ch[0]/4,t+0.96,0.5,"sine",0.08);
      for(let i=0;i<8;i++){                                   // перебор
        const f=ch[i%3]*(i>=6?2:1);
        tone(f,t+i*0.24,0.2,"triangle",0.055);
      }
      snd.bar++;
    };
    bar(); snd.musicTimer=setInterval(bar,1920);
  }
  function musicStop(){ if(snd.musicTimer){clearInterval(snd.musicTimer); snd.musicTimer=null;} }
  function sfx(name){
    if(!snd.on||!sndReady()) return;
    const t=snd.ctx.currentTime+0.03;
    if(name==="whoosh"){ tone(520,t,0.14,"sawtooth",0.05); tone(320,t+0.07,0.16,"sawtooth",0.04); }
    else if(name==="cash"){ tone(1318.5,t,0.3,"square",0.06); tone(1760,t+0.13,0.45,"square",0.06); tone(2093,t+0.26,0.4,"triangle",0.07); }
    else if(name==="drop"){ tone(392,t,0.25,"sawtooth",0.06); tone(311,t+0.18,0.3,"sawtooth",0.06); tone(233,t+0.38,0.5,"sawtooth",0.07); }
    else if(name==="tada"){ [523.25,659.25,784,1046.5].forEach((f,i)=>tone(f,t+i*0.11,0.5,"triangle",0.09)); tone(1318.5,t+0.5,0.8,"triangle",0.08); }
  }
  /* голоса подгружаются асинхронно — кэшируем и выбираем лучший мужской русский */
  let voicesCache=[];
  function loadVoices(){ try{ voicesCache=speechSynthesis.getVoices()||[]; }catch(e){} }
  if(window.speechSynthesis){ loadVoices(); speechSynthesis.onvoiceschanged=loadVoices; }
  const MALE_RU=["dmitry","dmitri","дмитрий","pavel","павел","yuri","yuriy","юрий","artem","артем","артём","filipp","филипп","aleksandr","александр","maxim","максим","ruslan","руслан","sergey","сергей","male"];
  function pickVoice(){
    const ru=voicesCache.filter(v=>v.lang&&v.lang.toLowerCase().replace("_","-").startsWith("ru"));
    if(!ru.length) return {v:null,male:false};
    const nm=v=>v.name.toLowerCase();
    const isMale=v=>MALE_RU.some(m=>nm(v).includes(m));
    const isNeural=v=>/natural|neural|online|premium|enhanced/i.test(v.name);
    let v=ru.find(x=>isMale(x)&&isNeural(x))   // нейро-мужской (Edge: Dmitry Online Natural)
        ||ru.find(isMale)                      // любой мужской
        ||ru.find(isNeural)                    // нейро-женский (лучше робота)
        ||ru[0];
    return {v, male:isMale(v)};
  }
  function speak(txt){
    if(!snd.on||!txt||!window.speechSynthesis) return;
    try{
      speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance(txt);
      const p=pickVoice();
      u.lang="ru-RU"; u.volume=1;
      if(p.v) u.voice=p.v;
      if(p.male){ u.pitch=0.92; u.rate=0.98; }        // естественный глубокий мужской
      else { u.pitch=0.66; u.rate=0.94; }             // нет мужского — искусственно занижаем тон
      speechSynthesis.speak(u);
    }catch(e){}
  }
  function speakStop(){ if(window.speechSynthesis) try{speechSynthesis.cancel();}catch(e){} }
  const muteBtn=document.getElementById("promo-mute")||{addEventListener(){},classList:{toggle(){}},set innerHTML(v){}};
  muteBtn.onclick=()=>{
    snd.on=!snd.on;
    muteBtn.classList.toggle("on",snd.on);
    muteBtn.innerHTML='<svg class="ic"><use href="#i-snd'+(snd.on?'':'-off')+'"/></svg><span>звук '+(snd.on?'вкл':'выкл')+'</span>';
    if(snd.on){ if(promo.playing) musicStart(); }
    else { musicStop(); speakStop(); }
  };

  const promoEl=document.getElementById("promo");
  const pRotate=document.getElementById("promo-rotate");
  async function requestPromoLandscape(){
    let tried=false;
    if(!window.matchMedia || !window.matchMedia("(max-width:900px)").matches) return;
    try{
      if(promoEl.requestFullscreen && document.fullscreenElement!==promoEl){
        tried=true;
        await promoEl.requestFullscreen({navigationUI:"hide"});
      }
    }catch(e){}
    try{
      if(screen.orientation && screen.orientation.lock){
        tried=true;
        await screen.orientation.lock("landscape");
      }
    }catch(e){}
    return tried;
  }
  async function enterPromoViewport(){
    await requestPromoLandscape();
  }
  async function exitPromoViewport(){
    promoEl.classList.remove("visual-landscape");
    try{ if(screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); }catch(e){}
    try{
      if(document.fullscreenElement===promoEl && document.exitFullscreen)
        await document.exitFullscreen();
    }catch(e){}
  }
  async function rotatePromoViewport(){
    await requestPromoLandscape();
    setTimeout(()=>{
      if(window.matchMedia && window.matchMedia("(orientation:portrait)").matches)
        promoEl.classList.toggle("visual-landscape");
    },180);
  }

  async function playPromo(scenes, ctaMode){
    if(promo.playing) return;
    promo.playing=true; promo.abort=false;
    pPoster.classList.add("hide"); pStop.classList.add("show");
    promoEl.classList.add("playing");
    document.getElementById("promo-backdrop").classList.add("show");
    await enterPromoViewport();
    musicStart();
    const total=scenes.reduce((s,x)=>s+x.d,0);
    let done=0, finished=false;
    try{
      for(const sc of scenes){
        pStage.innerHTML=sc.html; pCap.innerHTML="<span>"+capHTML(sc.cap)+"</span>";
        sfx(sc.sfx||"whoosh"); speak((sc.voice||sc.cap).replace(/\[\[|\]\]/g,""));
        const cta=pStage.querySelector(".promo-cta");
        if(cta) cta.onclick=()=>{
          stopPromo();
          fModeEl.value=ctaMode; apply(false);
          document.querySelector(".ask").scrollIntoView({behavior:"smooth",block:"center"});
        };
        const t0=Date.now();
        while(Date.now()-t0<sc.d){
          if(promo.abort) throw new Error("stop");
          pFill.style.width=((done+Date.now()-t0)/total*100)+"%";
          await new Promise(r=>setTimeout(r,80));
        }
        done+=sc.d;
      }
      pFill.style.width="100%"; finished=true;
    }catch(e){}
    if(!finished){ stopPromo(); }
    else { promo.playing=false; musicStop(); } // финальный кадр остаётся с кнопкой
  }
  function stopPromo(){
    promo.abort=true; promo.playing=false;
    promoEl.classList.remove("playing");
    document.getElementById("promo-backdrop").classList.remove("show");
    exitPromoViewport();
    musicStop(); speakStop();
    pStage.innerHTML=""; pCap.textContent=""; pFill.style.width="0";
    pPoster.classList.remove("hide"); pStop.classList.remove("show");
  }
  document.getElementById("promo-play-anya").onclick=()=>playPromo(PROMO_SCENES,"buy");
  document.getElementById("promo-play-sergey").onclick=()=>playPromo(SERGEY_SCENES,"sell");
  pStop.onclick=()=>stopPromo();
  if(pRotate) pRotate.onclick=(e)=>{ e.stopPropagation(); rotatePromoViewport(); };
  document.getElementById("promo-backdrop").onclick=()=>stopPromo();
  /* мини-аватары героев в кнопках */
  document.getElementById("ava-anya").innerHTML=anyaSVG("show","88px");
  document.getElementById("ava-sergey").innerHTML=sergeySVG("happy","88px");

  window.addEventListener("popstate", restoreUrlState);
  window.addEventListener("pageshow", e=>{ if(e.persisted) restoreUrlState(); });
  restoreState();
  render();

}

bootPrototype().catch((error) => {
  console.error(error);
  const result = document.getElementById("ask-result");
  if (result) result.innerHTML = '<div class="res-hint">API временно недоступен.</div>';
});

/* ---------- лайки «👍 если было полезно» ---------- */
(function initLike() {
  const bar = document.getElementById("like-bar");
  const btn = document.getElementById("like-btn");
  const countEl = document.getElementById("like-count");
  if (!bar || !btn || !countEl) return;

  let tokenPromise = null;
  let primed = false;
  let busy = false;
  let liked = false;

  function getToken(force) {
    if (force) tokenPromise = null;
    if (!tokenPromise) {
      tokenPromise = fetch("/api/session")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("session " + r.status))))
        .then((d) => d.token);
    }
    return tokenPromise;
  }

  async function apiLikes(method) {
    const opts = { method, headers: {} };
    let token = await getToken(false);
    opts.headers["X-Sevio-Token"] = token;
    let res = await fetch("/api/like" + (method === "GET" ? "s" : ""), opts);
    if (res.status === 403) {
      token = await getToken(true);
      opts.headers["X-Sevio-Token"] = token;
      res = await fetch("/api/like" + (method === "GET" ? "s" : ""), opts);
    }
    if (!res.ok) throw new Error("like " + res.status);
    return res.json();
  }

  function paint(data) {
    liked = !!data.liked;
    btn.classList.toggle("on", liked);
    btn.setAttribute("aria-pressed", liked ? "true" : "false");
    countEl.textContent = (data.count || 0).toLocaleString("ru-RU");
  }

  async function prime() {
    if (primed) return;
    primed = true;
    try {
      paint(await apiLikes("GET"));
    } catch (e) {
      primed = false;
    }
  }

  btn.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    try {
      paint(await apiLikes("POST"));
    } catch (e) {
      console.error(e);
    } finally {
      busy = false;
      btn.disabled = false;
    }
  });

  window.SevioLike = {
    reveal() {
      bar.hidden = false;
      prime();
    },
  };

  prime();
})();
