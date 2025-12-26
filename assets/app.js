/* =========================================================
   PAINEL DENGUE — APP.JS
   Autor: Ernandes Sobreira
   Fonte: DATASUS / SINAN
   Período: 2014+
   ========================================================= */

/* ===================== CONFIG ===================== */

const DATA_FILES = {
  br: "data/dados-dengue.csv",
  uf: "data/dados-dengue-estados.csv",
  mun: "data/dados-dengue-municipios.csv",
  sexo: "data/dados-dengue-sexo.csv",
  raca: "data/dados-dengue-raca.csv",
  esc: "data/dados-dengue-escolaridade.csv"
};

const START_YEAR = 2014;

/* ===================== UTIL ===================== */

const $ = id => document.getElementById(id);

function safeNum(v){
  if (v === null || v === undefined) return 0;
  const s = String(v).replace(/\./g,"").replace(",",".").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function uniq(arr){
  return [...new Set(arr)];
}

function mean(arr){
  return arr.reduce((a,b)=>a+b,0)/arr.length;
}

function sum(arr){
  return arr.reduce((a,b)=>a+b,0);
}

function fmt(n){
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

/* ===================== FETCH ===================== */

async function fetchCSV(url){
  const r = await fetch(url, { cache:"no-store" });
  if(!r.ok) throw new Error(`Erro ao carregar ${url}`);
  const t = await r.text();
  return Papa.parse(t, { header:true, skipEmptyLines:true }).data;
}

/* ===================== ESTATÍSTICA ===================== */

/* Regressão linear + p-valor */
function linearRegression(x, y){
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);

  let num = 0, den = 0;
  for(let i=0;i<n;i++){
    num += (x[i]-mx)*(y[i]-my);
    den += (x[i]-mx)*(x[i]-mx);
  }

  const slope = num/den;
  const intercept = my - slope*mx;

  let ssTot = 0, ssRes = 0;
  for(let i=0;i<n;i++){
    const yi = intercept + slope*x[i];
    ssTot += (y[i]-my)**2;
    ssRes += (y[i]-yi)**2;
  }

  const r2 = 1 - ssRes/ssTot;

  const se = Math.sqrt(ssRes/(n-2)) / Math.sqrt(den);
  const t = slope/se;
  const p = 2 * (1 - normalCDF(Math.abs(t)));

  return { slope, intercept, r2, p };
}

/* Aproximação normal */
function normalCDF(x){
  return (1 + erf(x/Math.sqrt(2)))/2;
}

function erf(x){
  const s = Math.sign(x);
  x = Math.abs(x);
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429;
  const p=0.3275911;
  const t=1/(1+p*x);
  const y=1-((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return s*y;
}

/* Mann–Kendall simples */
function mannKendall(y){
  let s = 0;
  for(let i=0;i<y.length;i++){
    for(let j=i+1;j<y.length;j++){
      if(y[j]>y[i]) s++;
      else if(y[j]<y[i]) s--;
    }
  }
  const n = y.length;
  const varS = (n*(n-1)*(2*n+5))/18;
  const z = s/Math.sqrt(varS);
  const p = 2*(1-normalCDF(Math.abs(z)));

  let trend = "sem tendência";
  if(p < 0.05){
    trend = z>0 ? "crescente" : "decrescente";
  }

  return { trend, z, p };
}

/* ===================== GLOBAL ===================== */

let DB = {};
let chart = null;

/* ===================== LOAD ===================== */

async function loadAll(){
  DB.br = await fetchCSV(DATA_FILES.br);
  DB.uf = await fetchCSV(DATA_FILES.uf);
  DB.mun = await fetchCSV(DATA_FILES.mun);
  DB.sexo = await fetchCSV(DATA_FILES.sexo);
  DB.raca = await fetchCSV(DATA_FILES.raca);
  DB.esc = await fetchCSV(DATA_FILES.esc);

  setupYears();
  setupLayer();
}

function setupYears(){
  const years = [];
  for(let y=START_YEAR;y<=2025;y++) years.push(y);

  years.forEach(y=>{
    $("y0").append(new Option(y,y));
    $("y1").append(new Option(y,y));
  });

  $("y0").value = START_YEAR;
  $("y1").value = years[years.length-1];
}

/* ===================== UI ===================== */

function setupLayer(){
  $("layer").addEventListener("change", ()=>{
    const l = $("layer").value;
    $("geo").style.display = (l==="uf"||l==="mun") ? "block" : "none";
    populateQuestions(l);
    populateGeo(l);
  });

  $("run").addEventListener("click", runAnalysis);
  $("export").addEventListener("click", exportCSV);

  populateQuestions("br");
}

function populateQuestions(layer){
  const q = $("question");
  q.innerHTML = "";
  const qs = [
    {id:"trend", label:"A tendência está aumentando ou diminuindo?"},
    {id:"total", label:"Qual o total no período?"},
    {id:"peak", label:"Quando ocorreu o pico?"}
  ];
  qs.forEach(o=>q.append(new Option(o.label,o.id)));
}

function populateGeo(layer){
  $("uf").innerHTML="";
  $("mun").innerHTML="";

  if(layer==="uf"){
    uniq(DB.uf.map(r=>r.UF)).forEach(u=>$("uf").append(new Option(u,u)));
  }
  if(layer==="mun"){
    uniq(DB.mun.map(r=>r.UF)).forEach(u=>$("uf").append(new Option(u,u)));
    $("uf").addEventListener("change", ()=>{
      $("mun").innerHTML="";
      uniq(DB.mun.filter(r=>r.UF===$("uf").value).map(r=>r.MUNICIPIO))
        .forEach(m=>$("mun").append(new Option(m,m)));
    });
  }
}

/* ===================== CORE ===================== */

function filterByPeriod(rows){
  const y0 = +$("y0").value;
  const y1 = +$("y1").value;
  return rows.filter(r=>{
    const y = +r.Ano;
    return y>=y0 && y<=y1;
  });
}

function runAnalysis(){
  const layer = $("layer").value;
  let rows = [];

  if(layer==="br") rows = DB.br;
  if(layer==="uf") rows = DB.uf.filter(r=>r.UF===$("uf").value);
  if(layer==="mun") rows = DB.mun.filter(r=>r.MUNICIPIO===$("mun").value);
  if(layer==="sexo") rows = DB.sexo;
  if(layer==="raca") rows = DB.raca;
  if(layer==="esc") rows = DB.esc;

  rows = filterByPeriod(rows);

  const years = rows.map(r=>+r.Ano);
  const values = rows.map(r=>safeNum(r.Casos));

  if(values.length<4){
    $("answer").innerHTML="Dados insuficientes para análise estatística.";
    return;
  }

  const lr = linearRegression(years, values);
  const mk = mannKendall(values);

  renderChart(years, values, lr);
  renderKPIs(values, lr, mk);
  renderAnswer(lr, mk);
  renderTable(years, values);
}

function renderKPIs(values, lr, mk){
  $("kTotal").textContent = fmt(sum(values));
  $("kMean").textContent = fmt(mean(values));
  $("kTrend").textContent = mk.trend;
  $("kSig").textContent = mk.p<0.05 ? "significativa" : "não significativa";
}

function renderAnswer(lr, mk){
  $("answer").innerHTML = `
    <p><b>Tendência:</b> ${mk.trend}.</p>
    <p><b>Inclinação:</b> ${lr.slope.toFixed(1)} casos/ano.</p>
    <p><b>R²:</b> ${lr.r2.toFixed(2)}.</p>
    <p><b>p-valor:</b> ${lr.p.toExponential(2)}.</p>
  `;
}

function renderChart(x, y, lr){
  if(chart) chart.destroy();

  chart = new Chart($("chart"), {
    type:"line",
    data:{
      labels:x,
      datasets:[
        {
          label:"Casos",
          data:y,
          borderColor:"#ec4899",
          backgroundColor:"rgba(236,72,153,0.25)",
          tension:0.3
        },
        {
          label:"Tendência",
          data:x.map(v=>lr.intercept+lr.slope*v),
          borderColor:"#f9a8d4",
          borderDash:[5,5],
          pointRadius:0
        }
      ]
    },
    options:{
      responsive:true,
      plugins:{
        zoom:{
          zoom:{ wheel:{enabled:true}, pinch:{enabled:true}, mode:"x" },
          pan:{enabled:true, mode:"x"}
        }
      }
    }
  });
}

function renderTable(years, values){
  const t = $("table");
  t.innerHTML="<tr><th>Ano</th><th>Casos</th></tr>";
  years.forEach((y,i)=>{
    t.innerHTML+=`<tr><td>${y}</td><td>${fmt(values[i])}</td></tr>`;
  });
}

function exportCSV(){
  const rows = [...$("table").querySelectorAll("tr")]
    .map(r=>[...r.children].map(c=>c.innerText).join(","));
  const blob = new Blob([rows.join("\n")],{type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download="painel_dengue_visao.csv";
  a.click();
}

/* ===================== START ===================== */

loadAll();
