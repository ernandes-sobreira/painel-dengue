/* =========================================================
   Painel Dengue — BASICÃO FUNCIONAL (TABNET real)
   Brasil / Estados / Municípios com nomes (2014+)
   ========================================================= */

const CACHE = `?v=${Date.now()}`;
const FILES = {
  br:  `assets/data/dados-dengue.csv${CACHE}`,
  uf:  `assets/data/dados-dengue-estados.csv${CACHE}`,
  mun: `assets/data/dados-dengue-municipios.csv${CACHE}`,
};

const START_YEAR = 2014;

const UF_IBGE = {
  "11":"RO","12":"AC","13":"AM","14":"RR","15":"PA","16":"AP","17":"TO",
  "21":"MA","22":"PI","23":"CE","24":"RN","25":"PB","26":"PE","27":"AL","28":"SE","29":"BA",
  "31":"MG","32":"ES","33":"RJ","35":"SP",
  "41":"PR","42":"SC","43":"RS",
  "50":"MS","51":"MT","52":"GO","53":"DF"
};

let DB = { br:null, uf:null, mun:null };
let chart = null;

const $ = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat("pt-BR").format(Math.round(n || 0));

function safeNum(v){
  const s = String(v ?? "").trim();
  if (!s || s === "-") return 0;
  const n = Number(s.replace(/\./g,"").replace(",","."));
  return Number.isFinite(n) ? n : 0;
}

function findHeaderLineIndex(lines){
  for(let i=0;i<lines.length;i++){
    const l = lines[i] || "";
    if (l.includes(";") && (l.includes(";2014;") || l.includes(";2015;") || l.includes(";2016;"))) return i;
  }
  return -1;
}

function parseTabnetWide(text){
  const lines = text.replace(/\r/g,"").split("\n");
  const hi = findHeaderLineIndex(lines);
  if(hi < 0) throw new Error("Não achei o cabeçalho com anos no arquivo.");

  const headers = lines[hi].split(";").map(x => x.replace(/"/g,"").trim());
  const rows = [];

  for(let i=hi+1;i<lines.length;i++){
    const line = lines[i];
    if(!line || !line.trim()) continue;
    const cols = line.split(";").map(x => x.replace(/"/g,"").trim());
    rows.push(cols);
  }

  return { headers, rows };
}

function yearCols(headers){
  return headers
    .filter(h => /^\d{4}$/.test(h))
    .map(Number)
    .filter(y => y >= START_YEAR)
    .sort((a,b)=>a-b);
}

async function fetchText(url){
  const res = await fetch(url, { cache:"no-store" });
  if(!res.ok) throw new Error(`Falha ao carregar ${url} (${res.status})`);
  return await res.text();
}

function buildEstados(parsed){
  const { headers, rows } = parsed;
  const years = yearCols(headers);
  const idxByYear = Object.fromEntries(years.map(y => [y, headers.indexOf(String(y))]));
  const byUf = {};

  for(const cols of rows){
    const raw = cols[0] || "";
    const m = raw.match(/^(\d{2})\s+/); // "51 Mato Grosso"
    if(!m) continue;

    const uf = m[1];
    if(!UF_IBGE[uf]) continue;
    if(raw.toLowerCase().includes("ign")) continue;

    byUf[uf] = years.map(y => ({ ano:y, casos: safeNum(cols[idxByYear[y]]) }));
  }

  return { years, byUf };
}

function buildMunicipios(parsed){
  const { headers, rows } = parsed;
  const years = yearCols(headers);
  const idxByYear = Object.fromEntries(years.map(y => [y, headers.indexOf(String(y))]));
  const byUf = {};

  for(const cols of rows){
    const raw = cols[0] || "";
    if(raw.toLowerCase().includes("ign")) continue;

    const m = raw.match(/^(\d{6})\s+(.*)$/);
    if(!m) continue;

    const ibge6 = m[1];
    const uf = ibge6.slice(0,2);
    const nome = m[2].trim();
    if(!UF_IBGE[uf]) continue;

    if(!byUf[uf]) byUf[uf] = { municipios: [], byMunNome: {} };

    const series = years.map(y => ({ ano:y, casos: safeNum(cols[idxByYear[y]]) }));
    byUf[uf].municipios.push(nome);
    byUf[uf].byMunNome[nome] = series;
  }

  for(const uf in byUf){
    byUf[uf].municipios.sort((a,b)=>a.localeCompare(b));
  }

  return { years, byUf };
}

function buildBrasil(parsed){
  const { headers, rows } = parsed;
  const totalIdx = headers.findIndex(h => h.toLowerCase() === "total");
  if(totalIdx < 0) throw new Error("Não achei a coluna Total no arquivo do Brasil.");

  const series = [];
  for(const cols of rows){
    const y = String(cols[0]||"").trim();
    if(!/^\d{4}$/.test(y)) continue;
    const ano = Number(y);
    if(ano < START_YEAR) continue;
    series.push({ ano, casos: safeNum(cols[totalIdx]) });
  }

  series.sort((a,b)=>a.ano-b.ano);
  const years = series.map(d=>d.ano);
  return { years, series };
}

function fillSelect(sel, items, placeholder){
  sel.innerHTML = "";
  sel.append(new Option(placeholder, ""));
  for(const it of items){
    sel.append(new Option(it.label, it.value));
  }
}

function setupYears(years){
  $("y0").innerHTML = "";
  $("y1").innerHTML = "";
  years.forEach(y => {
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
  const items = ufs.map(code => ({ value: code, label: UF_IBGE[code] }));
  fillSelect($("uf"), items, "Selecione a UF");
}

function updateMunOptions(){
  const uf = $("uf").value;
  const box = DB.mun.byUf[uf];
  if(!uf || !box){
    fillSelect($("mun"), [], "Selecione o município");
    return;
  }
  const items = box.municipios.map(n => ({ value:n, label:n }));
  fillSelect($("mun"), items, "Selecione o município");
}

function renderSeries(title, series){
  const anos = series.map(d=>d.ano);
  const vals = series.map(d=>d.casos);

  const total = vals.reduce((a,b)=>a+b,0);
  const media = vals.length ? total/vals.length : 0;
  const pico  = vals.length ? Math.max(...vals) : 0;

  $("kTotal").textContent = fmt(total);
  $("kMean").textContent  = fmt(media);
  $("kPeak").textContent  = fmt(pico);

  $("table").innerHTML =
    `<tr><th>Ano</th><th>Casos</th></tr>` +
    series.map(r => `<tr><td>${r.ano}</td><td>${fmt(r.casos)}</td></tr>`).join("");

  if(chart) chart.destroy();
  chart = new Chart($("chart"),{
    type:"line",
    data:{
      labels: anos,
      datasets:[{
        label: title,
        data: vals,
        borderColor:"#ec4899",
        backgroundColor:"rgba(236,72,153,0.18)",
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
    const s = DB.br.series.filter(d => d.ano>=y0 && d.ano<=y1);
    renderSeries("Casos (Brasil)", s);
    return;
  }

  if(layer === "uf"){
    const uf = $("uf").value;
    if(!uf) return alert("Selecione a UF.");
    const s = (DB.uf.byUf[uf] || []).filter(d => d.ano>=y0 && d.ano<=y1);
    renderSeries(`Casos (${UF_IBGE[uf]})`, s);
    return;
  }

  if(layer === "mun"){
    const uf = $("uf").value;
    const mun = $("mun").value;
    if(!uf) return alert("Selecione a UF.");
    if(!mun) return alert("Selecione o município.");
    const s = (DB.mun.byUf[uf]?.byMunNome?.[mun] || []).filter(d => d.ano>=y0 && d.ano<=y1);
    renderSeries(`Casos (${mun} - ${UF_IBGE[uf]})`, s);
    return;
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
    const br = parseTabnetWide(await fetchText(FILES.br));
    const uf = parseTabnetWide(await fetchText(FILES.uf));
    const mun = parseTabnetWide(await fetchText(FILES.mun));

    DB.br  = buildBrasil(br);
    DB.uf  = buildEstados(uf);
    DB.mun = buildMunicipios(mun);

    $("layer").addEventListener("change", onLayerChange);
    $("uf").addEventListener("change", () => {
      if($("layer").value === "mun") updateMunOptions();
    });
    $("run").addEventListener("click", run);

    onLayerChange();
  }catch(e){
    console.error(e);
    alert("Erro ao carregar dados. Abra o Console (F12) e copie o erro.");
  }
}

init();
