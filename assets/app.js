/* Painel Dengue — base robusta (TABNET Latin-1 + cabeçalho com aspas) */

const START_YEAR = 2014;

// seus arquivos no GitHub (como está no print)
const FILES = {
  br:  "assets/data/dados-dengue.csv",
  uf:  "assets/data/dados-dengue-estados.csv",
  mun: "assets/data/dados-dengue-municipios.csv",
};

const UF_IBGE = {
  "11":"RO","12":"AC","13":"AM","14":"RR","15":"PA","16":"AP","17":"TO",
  "21":"MA","22":"PI","23":"CE","24":"RN","25":"PB","26":"PE","27":"AL","28":"SE","29":"BA",
  "31":"MG","32":"ES","33":"RJ","35":"SP",
  "41":"PR","42":"SC","43":"RS",
  "50":"MS","51":"MT","52":"GO","53":"DF"
};

const $ = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat("pt-BR").format(Math.round(n || 0));

let DB = { br:null, uf:null, mun:null };
let chart = null;

function safeNum(v){
  const s = String(v ?? "").trim();
  if (!s || s === "-") return 0;
  const n = Number(s.replace(/\./g,"").replace(",","."));
  return Number.isFinite(n) ? n : 0;
}

// Lê CSV do GitHub Pages corretamente em Latin-1
async function fetchLatin1(url){
  const res = await fetch(url, { cache:"no-store" });
  if(!res.ok) throw new Error(`Falha ao carregar ${url} (${res.status})`);
  const buf = await res.arrayBuffer();
  return new TextDecoder("latin1").decode(buf);
}

// acha a linha do cabeçalho mesmo com aspas
function findHeader(lines){
  for(let i=0;i<lines.length;i++){
    const clean = (lines[i]||"").replace(/"/g,"").trim();
    if(
      clean.includes(";2014;") && clean.toLowerCase().includes("total")
    ) return i;
    // caso Brasil (mês): cabeçalho tem "Total" e "Jan"
    if(
      clean.toLowerCase().includes("total") &&
      (clean.toLowerCase().includes("jan") || clean.toLowerCase().includes("fev")) &&
      clean.toLowerCase().includes("ano")
    ) return i;
  }
  return -1;
}

function parseTabnet(text){
  const lines = text.replace(/\r/g,"").split("\n").filter(l=>l.trim().length);
  const hi = findHeader(lines);
  if(hi < 0) throw new Error("Não encontrei o cabeçalho do TABNET (linha com anos/Total).");

  const headers = lines[hi].split(";").map(x => x.replace(/"/g,"").trim());
  const rows = [];
  for(let i=hi+1;i<lines.length;i++){
    const cols = lines[i].split(";").map(x => x.replace(/"/g,"").trim());
    rows.push(cols);
  }
  return { headers, rows };
}

function yearsFromHeaders(headers){
  return headers
    .filter(h => /^\d{4}$/.test(h))
    .map(Number)
    .filter(y => y >= START_YEAR)
    .sort((a,b)=>a-b);
}

function buildBrasil(parsed){
  const { headers, rows } = parsed;
  const totalIdx = headers.findIndex(h => h.toLowerCase() === "total");
  if(totalIdx < 0) throw new Error("Brasil: não achei coluna Total.");

  const series = [];
  for(const cols of rows){
    const y = String(cols[0]||"").trim().replace(/"/g,"");
    if(!/^\d{4}$/.test(y)) continue;
    const ano = Number(y);
    if(ano < START_YEAR) continue;
    series.push({ ano, casos: safeNum(cols[totalIdx]) });
  }
  series.sort((a,b)=>a.ano-b.ano);
  return { years: series.map(d=>d.ano), series };
}

function buildEstados(parsed){
  const { headers, rows } = parsed;
  const years = yearsFromHeaders(headers);
  const idx = Object.fromEntries(years.map(y => [y, headers.indexOf(String(y))]));
  const byUf = {};

  for(const cols of rows){
    const raw = (cols[0]||"").replace(/"/g,"").trim(); // "51 Mato Grosso"
    const m = raw.match(/^(\d{2})\s+/);
    if(!m) continue;
    const uf = m[1];
    if(!UF_IBGE[uf]) continue;
    if(raw.toLowerCase().includes("ign")) continue;

    byUf[uf] = years.map(y => ({ ano:y, casos: safeNum(cols[idx[y]]) }));
  }
  return { years, byUf };
}

function buildMunicipios(parsed){
  const { headers, rows } = parsed;
  const years = yearsFromHeaders(headers);
  const idx = Object.fromEntries(years.map(y => [y, headers.indexOf(String(y))]));
  const byUf = {};

  for(const cols of rows){
    const raw = (cols[0]||"").replace(/"/g,"").trim(); // "110001 ALTA FLORESTA D'OESTE"
    if(raw.toLowerCase().includes("ign")) continue;

    const m = raw.match(/^(\d{6})\s+(.*)$/);
    if(!m) continue;

    const ibge6 = m[1];
    const uf = ibge6.slice(0,2);
    const nome = m[2].trim();
    if(!UF_IBGE[uf]) continue;

    if(!byUf[uf]) byUf[uf] = { municipios: [], seriesByName: {} };

    const series = years.map(y => ({ ano:y, casos: safeNum(cols[idx[y]]) }));
    byUf[uf].municipios.push(nome);
    byUf[uf].seriesByName[nome] = series;
  }

  for(const uf in byUf){
    byUf[uf].municipios.sort((a,b)=>a.localeCompare(b));
  }
  return { years, byUf };
}

function fillSelect(sel, items, placeholder){
  sel.innerHTML = "";
  sel.append(new Option(placeholder, ""));
  for(const it of items) sel.append(new Option(it.label, it.value));
}

function setupYears(years){
  $("y0").innerHTML = "";
  $("y1").innerHTML = "";
  years.forEach(y=>{
    $("y0").add(new Option(String(y), String(y)));
    $("y1").add(new Option(String(y), String(y)));
  });
  $("y0").value = String(years[0]);
  $("y1").value = String(years[years.length-1]);
}

function updateUFOptions(){
  const layer = $("layer").value;
  let ufs = [];
  if(layer === "uf") ufs = Object.keys(DB.uf.byUf);
  if(layer === "mun") ufs = Object.keys(DB.mun.byUf);

  ufs.sort((a,b)=>UF_IBGE[a].localeCompare(UF_IBGE[b]));
  fillSelect($("uf"), ufs.map(code=>({value:code,label:UF_IBGE[code]})), "Selecione a UF");
}

function updateMunOptions(){
  const uf = $("uf").value;
  const box = DB.mun.byUf[uf];
  if(!uf || !box){
    fillSelect($("mun"), [], "Selecione o município");
    return;
  }
  fillSelect($("mun"), box.municipios.map(n=>({value:n,label:n})), "Selecione o município");
}

function renderSeries(title, series){
  const anos = series.map(d=>d.ano);
  const vals = series.map(d=>d.casos);

  const total = vals.reduce((a,b)=>a+b,0);
  const mean = vals.length ? total/vals.length : 0;
  const peak = vals.length ? Math.max(...vals) : 0;

  $("kTotal").textContent = fmt(total);
  $("kMean").textContent  = fmt(mean);
  $("kPeak").textContent  = fmt(peak);

  $("table").innerHTML =
    `<tr><th>Ano</th><th>Casos</th></tr>` +
    series.map(r=>`<tr><td>${r.ano}</td><td>${fmt(r.casos)}</td></tr>`).join("");

  if(chart) chart.destroy();
  chart = new Chart($("chart"),{
    type:"line",
    data:{
      labels: anos,
      datasets:[{
        label:title,
        data: vals,
        borderColor:"#ec4899",
        backgroundColor:"rgba(236,72,153,0.14)",
        tension:0.25,
        pointRadius:3
      }]
    },
    options:{ responsive:true }
  });
}

function run(){
  const layer = $("layer").value;
  const y0 = Number($("y0").value);
  const y1 = Number($("y1").value);

  if(layer === "br"){
    const s = DB.br.series.filter(d=>d.ano>=y0 && d.ano<=y1);
    return renderSeries("Casos (Brasil)", s);
  }

  if(layer === "uf"){
    const uf = $("uf").value;
    if(!uf) return alert("Selecione a UF.");
    const s = (DB.uf.byUf[uf]||[]).filter(d=>d.ano>=y0 && d.ano<=y1);
    return renderSeries(`Casos (${UF_IBGE[uf]})`, s);
  }

  if(layer === "mun"){
    const uf = $("uf").value;
    const mun = $("mun").value;
    if(!uf) return alert("Selecione a UF.");
    if(!mun) return alert("Selecione o município.");
    const s = (DB.mun.byUf[uf]?.seriesByName?.[mun]||[]).filter(d=>d.ano>=y0 && d.ano<=y1);
    return renderSeries(`Casos (${mun} - ${UF_IBGE[uf]})`, s);
  }
}

function onLayerChange(){
  const layer = $("layer").value;

  if(layer === "br"){
    $("uf").disabled = true;
    $("mun").disabled = true;
    setupYears(DB.br.years);
    run();
  }

  if(layer === "uf"){
    $("uf").disabled = false;
    $("mun").disabled = true;
    setupYears(DB.uf.years);
    updateUFOptions();
  }

  if(layer === "mun"){
    $("uf").disabled = false;
    $("mun").disabled = false;
    setupYears(DB.mun.years);
    updateUFOptions();
    updateMunOptions();
  }
}

async function init(){
  try{
    // checagem simples: se der 404 aqui, é caminho/Pages
    const [tBr,tUf,tMun] = await Promise.all([
      fetchLatin1(FILES.br),
      fetchLatin1(FILES.uf),
      fetchLatin1(FILES.mun),
    ]);

    DB.br  = buildBrasil(parseTabnet(tBr));
    DB.uf  = buildEstados(parseTabnet(tUf));
    DB.mun = buildMunicipios(parseTabnet(tMun));

    $("layer").addEventListener("change", onLayerChange);
    $("uf").addEventListener("change", ()=> $("layer").value==="mun" && updateMunOptions());
    $("run").addEventListener("click", run);

    onLayerChange();
  }catch(e){
    console.error(e);
    alert("Erro ao carregar dados. Abra o Console (F12) e copie o erro.");
  }
}

document.addEventListener("DOMContentLoaded", init);
