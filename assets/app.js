/* =========================================================
   Painel Dengue — V1 (TABNET wide)
   Brasil / Estados / Municípios — com UF e municípios reais
   ========================================================= */

const CACHE = `?v=${Date.now()}`; // evita cache do GitHub Pages

const FILES = {
  br:  `assets/data/dados-dengue.csv${CACHE}`,
  uf:  `assets/data/dados-dengue-estados.csv${CACHE}`,
  mun: `assets/data/dados-dengue-municipios.csv${CACHE}`
};

const START_YEAR = 2014;

const UF_IBGE = {
  "11": { sigla:"RO", nome:"Rondônia" },
  "12": { sigla:"AC", nome:"Acre" },
  "13": { sigla:"AM", nome:"Amazonas" },
  "14": { sigla:"RR", nome:"Roraima" },
  "15": { sigla:"PA", nome:"Pará" },
  "16": { sigla:"AP", nome:"Amapá" },
  "17": { sigla:"TO", nome:"Tocantins" },
  "21": { sigla:"MA", nome:"Maranhão" },
  "22": { sigla:"PI", nome:"Piauí" },
  "23": { sigla:"CE", nome:"Ceará" },
  "24": { sigla:"RN", nome:"Rio Grande do Norte" },
  "25": { sigla:"PB", nome:"Paraíba" },
  "26": { sigla:"PE", nome:"Pernambuco" },
  "27": { sigla:"AL", nome:"Alagoas" },
  "28": { sigla:"SE", nome:"Sergipe" },
  "29": { sigla:"BA", nome:"Bahia" },
  "31": { sigla:"MG", nome:"Minas Gerais" },
  "32": { sigla:"ES", nome:"Espírito Santo" },
  "33": { sigla:"RJ", nome:"Rio de Janeiro" },
  "35": { sigla:"SP", nome:"São Paulo" },
  "41": { sigla:"PR", nome:"Paraná" },
  "42": { sigla:"SC", nome:"Santa Catarina" },
  "43": { sigla:"RS", nome:"Rio Grande do Sul" },
  "50": { sigla:"MS", nome:"Mato Grosso do Sul" },
  "51": { sigla:"MT", nome:"Mato Grosso" },
  "52": { sigla:"GO", nome:"Goiás" },
  "53": { sigla:"DF", nome:"Distrito Federal" }
};

let DB = { br:null, uf:null, mun:null };
let chart = null;

const $ = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat("pt-BR").format(Math.round(n || 0));

function safeNum(v){
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s || s === "-") return 0;
  const cleaned = s.replace(/\./g,"").replace(",",".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

async function fetchTextISO(url){
  const res = await fetch(url, { cache:"no-store" });
  if(!res.ok) throw new Error(`Falha ao carregar: ${url} (${res.status})`);
  const buf = await res.arrayBuffer();
  return new TextDecoder("iso-8859-1").decode(buf);
}

function tabnetParse(text){
  const lines = text.replace(/\r/g,"").split("\n");
  const idx = lines.findIndex(l => l.trim().startsWith("\""));
  const core = (idx >= 0) ? lines.slice(idx).join("\n") : text;

  const parsed = Papa.parse(core, {
    header: true,
    skipEmptyLines: true,
    delimiter: ";",
    quoteChar: "\""
  });

  return parsed.data;
}

function detectYearColumns(obj){
  return Object.keys(obj)
    .filter(k => /^\d{4}$/.test(k))
    .map(Number)
    .filter(y => y >= START_YEAR)
    .sort((a,b)=>a-b);
}

/* ---------------- BUILDERS ---------------- */

function buildBrasil(rows){
  const firstCol = Object.keys(rows[0])[0];
  const series = [];

  for(const r of rows){
    const rawYear = String(r[firstCol] ?? "").replace(/"/g,"").trim();
    if(!/^\d{4}$/.test(rawYear)) continue;
    const ano = Number(rawYear);
    if(ano < START_YEAR) continue;

    const total = safeNum(r["Total"]);
    series.push({ ano, casos: total });
  }

  const years = series.map(d=>d.ano);
  return { series, years };
}

function buildEstados(rows){
  const firstCol = Object.keys(rows[0])[0];
  const yearCols = detectYearColumns(rows[0]);
  const byUf = {};

  for(const r of rows){
    const raw = String(r[firstCol] ?? "").replace(/"/g,"").trim();

    // Pega "11 Rondônia" → "11"
    const m = raw.match(/^(\d{2})\s+/);
    if(!m) continue;
    const uf = m[1];

    // ignora ignorados
    const low = raw.toLowerCase();
    if(low.includes("ign") || low.includes("em branco")) continue;

    byUf[uf] = yearCols.map(y => ({ ano:y, casos: safeNum(r[String(y)]) }));
  }

  return { years: yearCols, byUf };
}

function buildMunicipios(rows){
  const firstCol = Object.keys(rows[0])[0];
  const yearCols = detectYearColumns(rows[0]);

  const byUf = {};

  for(const r of rows){
    const raw = String(r[firstCol] ?? "").replace(/"/g,"").trim();

    // "510250 Cáceres" (6 dígitos)
    if(!/^\d{6}\s+/.test(raw)) continue;

    const parts = raw.split(/\s+/);
    const mun_ibge6 = parts[0];
    const uf = mun_ibge6.slice(0,2);
    const nome = parts.slice(1).join(" ").trim();

    if(!nome) continue;
    const low = nome.toLowerCase();
    if(low.includes("ign") || low.includes("em branco")) continue;

    if(!byUf[uf]) byUf[uf] = { municipios: [], byMunNome: {} };

    const series = yearCols.map(y => ({ ano:y, casos: safeNum(r[String(y)]) }));
    byUf[uf].municipios.push(nome);
    byUf[uf].byMunNome[nome] = series;
  }

  for(const uf in byUf){
    byUf[uf].municipios.sort((a,b)=>a.localeCompare(b));
  }

  return { years: yearCols, byUf };
}

/* ---------------- UI ---------------- */

function fillSelect(sel, items, placeholder){
  sel.innerHTML = "";
  sel.append(new Option(placeholder, ""));
  items.forEach(it => sel.append(new Option(it.label, it.value)));
}

function setupYears(years){
  $("y0").innerHTML = "";
  $("y1").innerHTML = "";
  years.forEach(y=>{
    $("y0").append(new Option(String(y), String(y)));
    $("y1").append(new Option(String(y), String(y)));
  });
  $("y0").value = String(years[0]);
  $("y1").value = String(years[years.length-1]);
}

function getUfsFromData(){
  const keysUf = Object.keys(DB.uf?.byUf || {});
  const keysMun = Object.keys(DB.mun?.byUf || {});
  const keys = (keysUf.length ? keysUf : keysMun).filter(k => /^\d{2}$/.test(k));

  keys.sort((a,b)=> (UF_IBGE[a]?.sigla || a).localeCompare(UF_IBGE[b]?.sigla || b));

  return keys.map(uf => {
    const info = UF_IBGE[uf];
    return { value: uf, label: info ? `${info.sigla} — ${info.nome}` : uf };
  });
}

function updateUFOptions(){
  const items = getUfsFromData();
  fillSelect($("uf"), items, "Selecione a UF");
}

function updateMunOptions(){
  const uf = $("uf").value;
  const box = DB.mun?.byUf?.[uf];
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

/* ---------------- RUN ---------------- */

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
    if(!uf){ alert("Selecione a UF."); return; }
    const info = UF_IBGE[uf];
    const sAll = DB.uf.byUf[uf] || [];
    const s = sAll.filter(d => d.ano>=y0 && d.ano<=y1);
    renderSeries(`Casos (${info?.sigla || uf})`, s);
    return;
  }

  if(layer === "mun"){
    const uf = $("uf").value;
    const mun = $("mun").value;
    if(!uf){ alert("Selecione a UF."); return; }
    if(!mun){ alert("Selecione o município."); return; }
    const sAll = DB.mun.byUf[uf]?.byMunNome?.[mun] || [];
    const s = sAll.filter(d => d.ano>=y0 && d.ano<=y1);
    renderSeries(`Casos (${mun})`, s);
    return;
  }
}

function onLayerChange(){
  const layer = $("layer").value;

  if(layer === "br"){
    $("uf").disabled = true;
    $("mun").disabled = true;
    setupYears(DB.br.years);
  }

  if(layer === "uf"){
    $("uf").disabled = false;
    $("mun").disabled = true;
    updateUFOptions();
    setupYears(DB.uf.years);
  }

  if(layer === "mun"){
    $("uf").disabled = false;
    $("mun").disabled = false;
    updateUFOptions();
    setupYears(DB.mun.years);
    updateMunOptions();
  }
}

/* ---------------- BOOT ---------------- */

async function init(){
  try{
    const brRaw  = tabnetParse(await fetchTextISO(FILES.br));
    const ufRaw  = tabnetParse(await fetchTextISO(FILES.uf));
    const munRaw = tabnetParse(await fetchTextISO(FILES.mun));

    DB.br  = buildBrasil(brRaw);
    DB.uf  = buildEstados(ufRaw);
    DB.mun = buildMunicipios(munRaw);

    $("layer").addEventListener("change", onLayerChange);
    $("uf").addEventListener("change", () => {
      if($("layer").value === "mun") updateMunOptions();
    });
    $("run").addEventListener("click", run);

    onLayerChange();
    run();
  }catch(err){
    console.error(err);
    alert("Erro ao carregar dados. Abra o Console (F12) e copie o erro.");
  }
}

init();
