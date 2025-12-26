/* =========================================================
   Painel Dengue — V1 (TABNET Wide → série temporal)
   Base: Brasil / Estados / Municípios
   Fonte: DATASUS/SINAN
   Feito por Ernandes Sobreira
   ========================================================= */

const FILES = {
  br:  "data/dados-dengue.csv",
  uf:  "data/dados-dengue-estados.csv",
  mun: "data/dados-dengue-municipios.csv"
};

const START_YEAR = 2014;

// UF IBGE (2 dígitos) → sigla/nome (para mostrar MT, SP etc.)
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

let DB = {
  br: null,      // { series:[{ano,casos}], years:[...]}
  uf: null,      // { years:[...], byUf:{ "51": [{ano,casos}] }, ufs:[{uf_ibge, sigla, nome}] }
  mun: null      // { years:[...], byUf:{ "11": { municipios:[...], byMunNome:{...} } } }
};

let chart = null;

const $ = (id) => document.getElementById(id);

const fmt = (n) => new Intl.NumberFormat("pt-BR").format(Math.round(n || 0));

function safeNum(v){
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s || s === "-" ) return 0;
  // TABNET pode vir com ; e números sem separador
  const cleaned = s.replace(/\./g,"").replace(",",".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- Leitura robusta (TABNET / ISO-8859-1) ---------- */
async function fetchTextISO(url){
  const res = await fetch(url, { cache:"no-store" });
  if(!res.ok) throw new Error(`Falha ao carregar: ${url}`);
  const buf = await res.arrayBuffer();
  // preserva acentos do DATASUS
  const dec = new TextDecoder("iso-8859-1");
  return dec.decode(buf);
}

function tabnetParse(text){
  // encontra a linha do cabeçalho real (primeira que começa com aspas)
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
    .map(k => Number(k))
    .filter(y => y >= START_YEAR)
    .sort((a,b)=>a-b);
}

/* ---------- Brasil (arquivo mensal com Total) ---------- */
function buildBrasil(rows){
  // primeira coluna tem o "Ano ..." e existe coluna "Total"
  const firstCol = Object.keys(rows[0])[0];
  const years = [];

  const series = [];

  for(const r of rows){
    const rawYear = String(r[firstCol] ?? "").replace(/"/g,"").trim();
    if(!/^\d{4}$/.test(rawYear)) continue;        // pega só 2014..2025
    const ano = Number(rawYear);
    if(ano < START_YEAR) continue;

    const total = safeNum(r["Total"]);
    series.push({ ano, casos: total });
    years.push(ano);
  }

  const ys = [...new Set(years)].sort((a,b)=>a-b);
  return { series, years: ys };
}

/* ---------- Estados (wide: primeira coluna "UF de residência", colunas por ano) ---------- */
function buildEstados(rows){
  const firstCol = Object.keys(rows[0])[0];
  const yearCols = detectYearColumns(rows[0]);

  const byUf = {};
  const ufs = [];

  for(const r of rows){
    const raw = String(r[firstCol] ?? "").replace(/"/g,"").trim();
    // Ex: "11 Rondônia" / "51 Mato Grosso"
    const m = raw.match(/^(\d{2})\s+/);
    if(!m) continue;
    const uf_ibge = m[1];
    const info = UF_IBGE[uf_ibge];
    if(!info) continue;

    // ignora linhas estranhas se houver
    if(raw.toLowerCase().includes("ign") || raw.toLowerCase().includes("em branco")) continue;

    const series = yearCols.map(y => ({ ano:y, casos: safeNum(r[String(y)]) }));
    byUf[uf_ibge] = series;

    ufs.push({ uf_ibge, sigla: info.sigla, nome: info.nome });
  }

  // remove duplicatas e ordena por sigla
  const ufsUniq = [];
  const seen = new Set();
  for(const u of ufs){
    if(seen.has(u.uf_ibge)) continue;
    seen.add(u.uf_ibge);
    ufsUniq.push(u);
  }
  ufsUniq.sort((a,b)=>a.sigla.localeCompare(b.sigla));

  return { years: yearCols, byUf, ufs: ufsUniq };
}

/* ---------- Municípios (wide: primeira coluna "Município...", colunas por ano) ---------- */
function buildMunicipios(rows){
  const firstCol = Object.keys(rows[0])[0];
  const yearCols = detectYearColumns(rows[0]);

  const byUf = {}; // { "11": { municipios:[{nome, ibge6}], byMunNome:{ nome: series } } }

  for(const r of rows){
    const raw = String(r[firstCol] ?? "").replace(/"/g,"").trim();

    // ignora linhas tipo " MUNICIPIO IGNORADO - RO"
    if(!/^\d{6}\s+/.test(raw)) continue;

    const parts = raw.split(/\s+/);
    const mun_ibge6 = parts[0];  // TABNET vem com 6 dígitos
    const uf_ibge = mun_ibge6.slice(0,2);
    const mun_nome = parts.slice(1).join(" ").trim();

    // ignora ignorados/vazios
    if(!mun_nome || mun_nome.toLowerCase().includes("ignorado") || mun_nome.toLowerCase().includes("ign")) continue;

    if(!byUf[uf_ibge]){
      byUf[uf_ibge] = { municipios: [], byMunNome: {} };
    }

    const series = yearCols.map(y => ({ ano:y, casos: safeNum(r[String(y)]) }));
    byUf[uf_ibge].municipios.push({ mun_ibge6, nome: mun_nome });
    byUf[uf_ibge].byMunNome[mun_nome] = series;
  }

  // ordenar municípios por nome em cada UF
  for(const uf in byUf){
    byUf[uf].municipios.sort((a,b)=>a.nome.localeCompare(b.nome));
  }

  return { years: yearCols, byUf };
}

/* ---------- UI ---------- */
function fillSelect(sel, items, placeholder="—"){
  sel.innerHTML = "";
  sel.append(new Option(placeholder, ""));
  for(const it of items){
    if(typeof it === "string"){
      sel.append(new Option(it, it));
    }else{
      sel.append(new Option(it.label, it.value));
    }
  }
}

function setupYears(years){
  const y0 = $("y0");
  const y1 = $("y1");
  y0.innerHTML = "";
  y1.innerHTML = "";

  years.forEach(y => {
    y0.append(new Option(String(y), String(y)));
    y1.append(new Option(String(y), String(y)));
  });

  y0.value = String(years[0]);
  y1.value = String(years[years.length-1]);
}

function setGeoEnabled(isUF, isMun){
  $("uf").disabled = !isUF;
  $("mun").disabled = !isMun;
  if(!isUF) $("uf").value = "";
  if(!isMun) $("mun").value = "";
}

function updateUFOptions(){
  // mostra UF como "MT — Mato Grosso"
  const items = DB.uf.ufs.map(u => ({
    value: u.uf_ibge,
    label: `${u.sigla} — ${u.nome}`
  }));
  fillSelect($("uf"), items, "Selecione a UF");
}

function updateMunOptions(){
  const uf = $("uf").value;
  if(!uf || !DB.mun.byUf[uf]){
    fillSelect($("mun"), [], "Selecione o município");
    return;
  }
  const muns = DB.mun.byUf[uf].municipios.map(m => ({ value: m.nome, label: m.nome }));
  fillSelect($("mun"), muns, "Selecione o município");
}

/* ---------- Render ---------- */
function renderSeries(title, series){
  const anos = series.map(d=>d.ano);
  const vals = series.map(d=>d.casos);

  const total = vals.reduce((a,b)=>a+b,0);
  const media = vals.length ? total/vals.length : 0;
  const pico = vals.length ? Math.max(...vals) : 0;

  $("kTotal").textContent = fmt(total);
  $("kMean").textContent  = fmt(media);
  $("kPeak").textContent  = fmt(pico);

  // tabela
  $("table").innerHTML =
    `<tr><th>Ano</th><th>Casos</th></tr>` +
    series.map(r => `<tr><td>${r.ano}</td><td>${fmt(r.casos)}</td></tr>`).join("");

  // gráfico
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
    options:{
      responsive:true,
      plugins:{ legend:{ display:true } },
      scales:{
        y:{ ticks:{ callback:(v)=>fmt(v) } }
      }
    }
  });
}

/* ---------- Rodar análise ---------- */
function run(){
  const layer = $("layer").value;
  const y0 = Number($("y0").value);
  const y1 = Number($("y1").value);

  if(!Number.isFinite(y0) || !Number.isFinite(y1)){
    alert("Selecione ano inicial e final.");
    return;
  }

  if(layer === "br"){
    const s = DB.br.series.filter(d => d.ano>=y0 && d.ano<=y1);
    renderSeries("Casos (Brasil)", s);
    return;
  }

  if(layer === "uf"){
    const uf = $("uf").value;
    if(!uf){
      alert("Selecione a UF.");
      return;
    }
    const info = UF_IBGE[uf];
    const sAll = DB.uf.byUf[uf] || [];
    const s = sAll.filter(d => d.ano>=y0 && d.ano<=y1);
    renderSeries(`Casos (${info.sigla})`, s);
    return;
  }

  if(layer === "mun"){
    const uf = $("uf").value;
    const mun = $("mun").value;
    if(!uf) { alert("Selecione a UF."); return; }
    if(!mun) { alert("Selecione o município."); return; }

    const sAll = DB.mun.byUf[uf]?.byMunNome?.[mun] || [];
    const s = sAll.filter(d => d.ano>=y0 && d.ano<=y1);
    renderSeries(`Casos (${mun})`, s);
    return;
  }
}

/* ---------- Eventos ---------- */
function onLayerChange(){
  const layer = $("layer").value;

  if(layer === "br"){
    setGeoEnabled(false, false);
    setupYears(DB.br.years);
  }

  if(layer === "uf"){
    setGeoEnabled(true, false);
    updateUFOptions();
    setupYears(DB.uf.years);
  }

  if(layer === "mun"){
    setGeoEnabled(true, true);
    updateUFOptions();
    setupYears(DB.mun.years);
    updateMunOptions();
  }
}

/* ---------- Boot ---------- */
async function init(){
  try{
    const brRaw  = tabnetParse(await fetchTextISO(FILES.br));
    const ufRaw  = tabnetParse(await fetchTextISO(FILES.uf));
    const munRaw = tabnetParse(await fetchTextISO(FILES.mun));

    DB.br  = buildBrasil(brRaw);
    DB.uf  = buildEstados(ufRaw);
    DB.mun = buildMunicipios(munRaw);

    // eventos
    $("layer").addEventListener("change", onLayerChange);
    $("uf").addEventListener("change", () => {
      if($("layer").value === "mun") updateMunOptions();
    });
    $("run").addEventListener("click", run);

    // inicia em Brasil
    onLayerChange();
    // roda automaticamente no carregamento (Brasil)
    run();

  }catch(err){
    console.error(err);
    alert("Erro ao carregar dados. Abra o Console (F12) e veja o erro.");
  }
}

init();
