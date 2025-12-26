const FILES = {
  br: "data/dados-dengue.csv",
  uf: "data/dados-dengue-estados.csv",
  mun: "data/dados-dengue-municipios.csv"
};

const START_YEAR = 2014;

let DB = {};
let chart;

const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat("pt-BR").format(n || 0);

async function loadCSV(url){
  const t = await fetch(url).then(r => r.text());
  return Papa.parse(t, { header:true, skipEmptyLines:true }).data;
}

function parseBrasil(rows){
  return rows
    .filter(r => +r.Ano >= START_YEAR)
    .map(r => ({ ano:+r.Ano, casos:+r.Total }));
}

function parseEstados(rows){
  return rows
    .filter(r => +r.Ano >= START_YEAR)
    .map(r => ({
      ano:+r.Ano,
      uf:r.UF,
      casos:+r.Casos
    }));
}

function parseMunicipios(rows){
  return rows
    .filter(r => +r.Ano >= START_YEAR)
    .map(r => {
      const txt = r.MUNICIPIO.trim();
      const parts = txt.split(" ");
      const ibge = parts[0];
      const nome = parts.slice(1).join(" ");
      return {
        ano:+r.Ano,
        uf:ibge.slice(0,2),
        municipio:nome,
        casos:+r.Casos
      };
    });
}

async function init(){
  DB.br = parseBrasil(await loadCSV(FILES.br));
  DB.uf = parseEstados(await loadCSV(FILES.uf));
  DB.mun = parseMunicipios(await loadCSV(FILES.mun));

  setupYears();
  setupUFs();
}

function setupYears(){
  const years = [...new Set(DB.br.map(d=>d.ano))];
  years.forEach(y=>{
    $("y0").add(new Option(y,y));
    $("y1").add(new Option(y,y));
  });
  $("y0").value = years[0];
  $("y1").value = years.at(-1);
}

function setupUFs(){
  const ufs = [...new Set(DB.uf.map(d=>d.uf))];
  $("uf").innerHTML = `<option value="">—</option>`;
  ufs.forEach(u => $("uf").add(new Option(u,u)));

  $("uf").onchange = ()=>{
    const sel = $("uf").value;
    const muns = [...new Set(DB.mun.filter(d=>d.uf===sel).map(d=>d.municipio))];
    $("mun").innerHTML = `<option value="">—</option>`;
    muns.forEach(m => $("mun").add(new Option(m,m)));
  };
}

function run(){
  const layer = $("layer").value;
  const y0 = +$("y0").value;
  const y1 = +$("y1").value;

  let rows = [];

  if(layer==="br") rows = DB.br;
  if(layer==="uf") rows = DB.uf.filter(d=>d.uf===$("uf").value);
  if(layer==="mun") rows = DB.mun.filter(d=>d.municipio===$("mun").value);

  rows = rows.filter(d=>d.ano>=y0 && d.ano<=y1);

  const anos = rows.map(d=>d.ano);
  const vals = rows.map(d=>d.casos);

  $("kTotal").textContent = fmt(vals.reduce((a,b)=>a+b,0));
  $("kMean").textContent = fmt(vals.reduce((a,b)=>a+b,0)/vals.length);
  $("kPeak").textContent = fmt(Math.max(...vals));

  if(chart) chart.destroy();
  chart = new Chart($("chart"),{
    type:"line",
    data:{
      labels:anos,
      datasets:[{
        label:"Casos",
        data:vals,
        borderColor:"#ec4899",
        backgroundColor:"rgba(236,72,153,0.25)",
        tension:0.3
      }]
    }
  });

  $("table").innerHTML =
    "<tr><th>Ano</th><th>Casos</th></tr>" +
    rows.map(r=>`<tr><td>${r.ano}</td><td>${fmt(r.casos)}</td></tr>`).join("");
}

$("run").onclick = run;

init();
